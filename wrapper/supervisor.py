#!/usr/bin/env python3
"""Supervisor for wrapper-lite.

Runs inside the wrapper container and does two things:

1. Keeps `wrapper-lite-rootless` serving on port 12340 whenever an Apple Music
   session exists, restarting it with a backoff if it exits.
2. Serves a small control API on port 12341 (Compose network only) so the
   Calavera app can report the wrapper's state and run the Apple ID sign-in.

Credentials: the password arrives in the body of `POST /login`, is handed to
wrapper-lite as a command-line argument (the only interface it offers) and is
dropped as soon as that process has been started. It is never written to disk,
never logged, and never returned by the API.

Every request must carry `Authorization: Bearer <token>`. The token is created
on first start in a volume shared with the app container.

Standard library only, so the image needs nothing beyond `python3`.

    python3 supervisor.py            run the supervisor (container entrypoint)
    python3 supervisor.py login      sign in from a terminal instead of the UI
"""
from __future__ import annotations

import collections
import getpass
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIN = os.environ.get("WRAPPER_BIN", "/app/wrapper-lite-rootless")
APP_DIR = os.environ.get("WRAPPER_APP_DIR", "/app")
# wrapper-lite sees this directory as /data from inside its chroot.
DATA_DIR = os.environ.get("WRAPPER_DATA_DIR", "/app/rootfs/data")
BASE_DIR_IN_CHROOT = "/data"
TOKEN_FILE = os.environ.get("CONTROL_TOKEN_FILE", "/control/token")
API_PORT = int(os.environ.get("WRAPPER_PORT", "12340"))
CONTROL_PORT = int(os.environ.get("CONTROL_PORT", "12341"))
TWOFA_WINDOW_S = 60  # wrapper-lite waits this long for 2fa.txt
LOG_LINES = 200

SESSION_FILE = os.path.join(DATA_DIR, "MUSIC_TOKEN")
TWOFA_FILE = os.path.join(DATA_DIR, "2fa.txt")
CODE_RE = re.compile(r"^\d{6}$")
# wrapper-lite logs the first characters of its tokens ("dev=eyJra... music=ApA...").
TOKEN_RE = re.compile(r"\b(dev|music)=[^\s)]+")


def log(msg: str) -> None:
    print(f"[supervisor] {msg}", flush=True)


class Supervisor:
    """Owns the wrapper-lite processes and the state reported by the API."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._server: subprocess.Popen | None = None
        self._listening = False
        self._login_proc: subprocess.Popen | None = None
        self._login = {"state": "idle", "message": "", "twofa_deadline": None}
        self._logs: collections.deque[str] = collections.deque(maxlen=LOG_LINES)
        self._redact: str | None = None
        self._stopping = False
        self._restarts = 0

    # -- state ---------------------------------------------------------------
    @staticmethod
    def has_session() -> bool:
        try:
            return os.path.getsize(SESSION_FILE) > 0
        except OSError:
            return False

    def snapshot(self) -> dict:
        with self._lock:
            if self._login["state"] in ("running", "awaiting_2fa"):
                phase = self._login["state"] if self._login["state"] == "awaiting_2fa" else "logging_in"
            elif self._server and self._server.poll() is None:
                phase = "running" if self._listening else "starting"
            elif self.has_session():
                phase = "starting"
            else:
                phase = "no_session"
            return {
                "phase": phase,
                "session": self.has_session(),
                "login": dict(self._login),
                "log_tail": list(self._logs)[-40:],
            }

    def _record(self, line: str) -> None:
        line = line.rstrip()
        if not line:
            return
        with self._lock:
            if self._redact:
                line = line.replace(self._redact, "********")
            line = TOKEN_RE.sub(r"\1=…", line)
            self._logs.append(line)
        print(f"[wrapper] {line}", flush=True)

    # -- serving process -----------------------------------------------------
    def serve_forever(self) -> None:
        """Keep the serving process alive while a session exists."""
        while not self._stopping:
            with self._lock:
                busy = self._login["state"] in ("running", "awaiting_2fa")
                alive = self._server is not None and self._server.poll() is None
            if busy or alive or not self.has_session():
                time.sleep(1)
                continue
            if self._restarts:
                delay = min(60, 2 ** min(self._restarts, 6))
                log(f"wrapper-lite exited, restarting in {delay}s")
                time.sleep(delay)
                if self._stopping:
                    return
            self._start_server()

    def _start_server(self) -> None:
        with self._lock:
            if self._login["state"] in ("running", "awaiting_2fa"):
                return
            self._listening = False
            started = time.monotonic()
            proc = subprocess.Popen(
                [BIN, "--base-dir", BASE_DIR_IN_CHROOT, "--host", "0.0.0.0", "--port", str(API_PORT)],
                cwd=APP_DIR,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                start_new_session=True,
            )
            self._server = proc
        log("wrapper-lite started")

        def pump() -> None:
            assert proc.stdout is not None
            for line in proc.stdout:
                if "listening on" in line:
                    with self._lock:
                        self._listening = True
                self._record(line)
            proc.wait()
            with self._lock:
                self._listening = False
                # A run that lasted a while counts as healthy: reset the backoff.
                self._restarts = 0 if time.monotonic() - started > 120 else self._restarts + 1

        threading.Thread(target=pump, daemon=True).start()

    def _stop_proc(self, proc: subprocess.Popen | None) -> None:
        """Stop a launcher and the child it forked into its own PID namespace.

        The launcher's signal handler kills that child, so it must get the
        chance to run: SIGTERM first, SIGKILL only as a last resort.
        """
        if proc is None or proc.poll() is not None:
            return
        for sig, wait in ((signal.SIGTERM, 8), (signal.SIGINT, 4), (signal.SIGKILL, 4)):
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                return
            try:
                proc.wait(timeout=wait)
                return
            except subprocess.TimeoutExpired:
                continue

    # -- login -----------------------------------------------------------------
    def start_login(self, email: str, password: str) -> tuple[int, dict]:
        email = email.strip()
        if not email or not password:
            return 400, {"error": "Apple ID and password are required."}
        with self._lock:
            if self._login["state"] in ("running", "awaiting_2fa"):
                return 409, {"error": "A sign-in is already in progress."}
            self._login = {"state": "running", "message": "Contacting Apple…", "twofa_deadline": None}
            self._redact = password
            server = self._server
        self._stop_proc(server)
        try:
            os.remove(TWOFA_FILE)
        except OSError:
            pass

        try:
            proc = subprocess.Popen(
                [BIN, "--login", f"{email}:{password}", "--code-from-file", "--base-dir", BASE_DIR_IN_CHROOT],
                cwd=APP_DIR,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                start_new_session=True,
            )
        except OSError as e:
            with self._lock:
                self._login = {"state": "failed", "message": f"Could not start wrapper-lite: {e}", "twofa_deadline": None}
                self._redact = None
            return 500, {"error": self._login["message"]}
        del password
        with self._lock:
            self._login_proc = proc
        log(f"sign-in started for {email}")
        threading.Thread(target=self._watch_login, args=(proc,), daemon=True).start()
        return 202, {"ok": True}

    def _watch_login(self, proc: subprocess.Popen) -> None:
        last_problem = ""
        assert proc.stdout is not None
        for line in proc.stdout:
            self._record(line)
            if "2FA: true" in line:
                with self._lock:
                    self._login.update(
                        state="awaiting_2fa",
                        message="Enter the 6-digit code Apple sent to your devices.",
                        twofa_deadline=time.time() + TWOFA_WINDOW_S,
                    )
            if "[WARN" in line or "[ERROR" in line or "failed" in line.lower():
                last_problem = re.sub(r"^\S+ \S+ \[\w+\s*\]\s*", "", line.strip())
        rc = proc.wait()
        try:
            os.remove(TWOFA_FILE)
        except OSError:
            pass
        with self._lock:
            if self._redact:
                last_problem = last_problem.replace(self._redact, "********")
            self._redact = None
            self._login_proc = None
            if rc == 0 and self.has_session():
                self._login = {"state": "succeeded", "message": "Signed in.", "twofa_deadline": None}
                self._restarts = 0
                log("sign-in succeeded")
            else:
                detail = f" ({last_problem})" if last_problem else ""
                self._login = {
                    "state": "failed",
                    "message": f"Sign-in failed{detail}. Check the Apple ID, password and code, then try again.",
                    "twofa_deadline": None,
                }
                log(f"sign-in failed (exit code {rc})")
        # serve_forever() notices the idle state and starts the server again.

    def submit_code(self, code: str) -> tuple[int, dict]:
        code = code.strip()
        if not CODE_RE.match(code):
            return 400, {"error": "The code must be exactly 6 digits."}
        with self._lock:
            if self._login["state"] != "awaiting_2fa":
                return 409, {"error": "No sign-in is waiting for a code."}
            self._login.update(state="running", message="Verifying the code…", twofa_deadline=None)
        tmp = TWOFA_FILE + ".tmp"
        with open(tmp, "w") as f:
            f.write(code)
        os.replace(tmp, TWOFA_FILE)
        return 200, {"ok": True}

    def shutdown(self) -> None:
        self._stopping = True
        with self._lock:
            procs = [self._login_proc, self._server]
        for p in procs:
            self._stop_proc(p)


def load_token() -> str:
    try:
        with open(TOKEN_FILE) as f:
            token = f.read().strip()
        if token:
            return token
    except OSError:
        pass
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    token = secrets.token_hex(32)
    tmp = TOKEN_FILE + ".tmp"
    with open(tmp, "w") as f:
        f.write(token + "\n")
    # Readable by the app container, which runs as an unprivileged user. The
    # volume holding it is mounted into these two containers only.
    os.chmod(tmp, 0o644)
    os.replace(tmp, TOKEN_FILE)
    return token


def make_handler(sup: Supervisor, token: str):
    class Handler(BaseHTTPRequestHandler):
        server_version = "calavera-supervisor"

        def log_message(self, *_args) -> None:  # request logging is noise here
            pass

        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorised(self) -> bool:
            supplied = self.headers.get("Authorization", "")
            if secrets.compare_digest(supplied, f"Bearer {token}"):
                return True
            self._send(401, {"error": "missing or invalid control token"})
            return False

        def _body(self) -> dict:
            length = min(int(self.headers.get("Content-Length") or 0), 8192)
            try:
                parsed = json.loads(self.rfile.read(length) or b"{}")
                return parsed if isinstance(parsed, dict) else {}
            except ValueError:
                return {}

        def do_GET(self) -> None:
            if not self._authorised():
                return
            if self.path == "/health":
                self._send(200, sup.snapshot())
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            if not self._authorised():
                return
            body = self._body()
            if self.path == "/login":
                self._send(*sup.start_login(str(body.get("email", "")), str(body.get("password", ""))))
            elif self.path == "/login/2fa":
                self._send(*sup.submit_code(str(body.get("code", ""))))
            else:
                self._send(404, {"error": "not found"})

    return Handler


def run() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    token = load_token()
    sup = Supervisor()
    httpd = ThreadingHTTPServer(("0.0.0.0", CONTROL_PORT), make_handler(sup, token))

    def stop(_signum, _frame) -> None:
        log("stopping")
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=sup.serve_forever, daemon=True).start()
    log(f"control API on :{CONTROL_PORT}; session {'found' if sup.has_session() else 'missing: sign in from the Calavera UI'}")
    try:
        httpd.serve_forever()
    finally:
        sup.shutdown()


def cli_login() -> int:
    """Terminal sign-in: `docker compose exec wrapper python3 /app/supervisor.py login`."""
    token = load_token()

    def call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(
            f"http://127.0.0.1:{CONTROL_PORT}{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    email = input("Apple ID (email): ")
    status, body = call("POST", "/login", {"email": email, "password": getpass.getpass("Password (input hidden): ")})
    if status != 202:
        print(body.get("error", f"sign-in could not be started (HTTP {status})"), file=sys.stderr)
        return 1
    asked = False
    while True:
        time.sleep(1)
        login = call("GET", "/health")[1].get("login", {})
        if login.get("state") == "awaiting_2fa" and not asked:
            asked = True
            status, body = call("POST", "/login/2fa", {"code": input("2FA code: ")})
            if status != 200:
                print(body.get("error", "code rejected"), file=sys.stderr)
                asked = False
        elif login.get("state") == "succeeded":
            print("Signed in.")
            return 0
        elif login.get("state") == "failed":
            print(login.get("message", "Sign-in failed."), file=sys.stderr)
            return 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        sys.exit(cli_login())
    run()

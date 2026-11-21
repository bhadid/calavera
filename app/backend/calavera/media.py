"""Telling a media server about new music: a library scan through the
Subsonic API (Navidrome, gonic and others), started after each import.

Media servers notice new files by watching the file system, which does not
work across a network share: a server on another machine never hears of
files Calavera writes over NFS or SMB. So Calavera asks it to scan.

Scans are coalesced: albums imported while a scan runs are covered by one
more scan after it, never by several. A failing media server never fails a
job; the job's log says what happened.
"""
from __future__ import annotations

import asyncio
import hashlib
import secrets
import time
from typing import Any, Callable

import httpx

CLIENT = "calavera"
API_VERSION = "1.16.1"
POLL_SECONDS = 2.0
# A scan that has not finished by then is left alone; Calavera stops waiting.
SCAN_TIMEOUT = 30 * 60
# A scan Calavera never saw running and whose lastScan did not change: after
# this long, assume it was too quick to see.
UNSEEN_GRACE = 20.0

Notify = Callable[[str], None]


class MediaServerError(Exception):
    """A failure with a message meant for the user."""


class MediaServer:
    def __init__(self, url: str, user: str, password: str, http: httpx.AsyncClient | None = None) -> None:
        self.url = url.rstrip("/")
        self.user = user
        self._password = password
        self._http = http or httpx.AsyncClient(timeout=15.0)
        self._wake = asyncio.Event()
        self._waiting: list[Notify] = []
        self._task: asyncio.Task | None = None
        self.name = "the media server"  # until it says what it is
        # The latest scan's outcome, for the Settings page.
        self.last: dict[str, Any] | None = None

    @property
    def configured(self) -> bool:
        return bool(self.url and self.user and self._password)

    # -- lifecycle -----------------------------------------------------------------
    def start(self) -> None:
        if self.configured:
            self._task = asyncio.create_task(self._scan_forever(), name="media-server-scans")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        await self._http.aclose()

    # -- Subsonic ------------------------------------------------------------------
    async def _call(self, method: str, **params: str) -> dict[str, Any]:
        # Token authentication: the password itself never goes over the wire.
        salt = secrets.token_hex(8)
        token = hashlib.md5((self._password + salt).encode()).hexdigest()
        query = {"u": self.user, "t": token, "s": salt, "v": API_VERSION, "c": CLIENT, "f": "json", **params}
        try:
            resp = await self._http.get(f"{self.url}/rest/{method}.view", params=query)
        except httpx.HTTPError as e:
            raise MediaServerError(f"Cannot reach {self.url}: {e.__class__.__name__}.") from e
        if resp.status_code != 200:
            raise MediaServerError(f"{self.url} answered with HTTP {resp.status_code}. Is this the server's address?")
        try:
            body = resp.json()["subsonic-response"]
        except (ValueError, KeyError, TypeError) as e:
            raise MediaServerError(f"{self.url} does not speak the Subsonic API. Is this the server's address?") from e
        if body.get("type"):
            self.name = str(body["type"]).capitalize()
        if body.get("status") != "ok":
            err = body.get("error") or {}
            code, message = err.get("code"), err.get("message") or "unknown error"
            if code == 40:
                raise MediaServerError(f"{self.name} refused the user name or password.")
            if code == 50:
                raise MediaServerError(f"The user {self.user} may not start scans on {self.name}; it needs to be an admin.")
            raise MediaServerError(f"{self.name}: {message}")
        return body

    async def test(self) -> dict[str, Any]:
        """Whether Calavera can start scans: reachable, signed in, allowed."""
        body = await self._call("ping")
        version = body.get("serverVersion") or body.get("version") or ""
        user = (await self._call("getUser", username=self.user)).get("user") or {}
        # Navidrome lets admins scan; the Subsonic API calls that adminRole.
        if not (user.get("adminRole") or user.get("scanningRole")):
            raise MediaServerError(f"Signed in to {self.name}, but {self.user} may not start scans; it needs to be an admin.")
        return {"server": self.name, "version": version}

    async def _scan_status(self) -> dict[str, Any]:
        return (await self._call("getScanStatus")).get("scanStatus") or {}

    # -- scans ---------------------------------------------------------------------
    def request_scan(self, notify: Notify | None = None) -> bool:
        """Ask for a scan soon. `notify` receives lines for the job's log.
        False when no media server is set up."""
        if not self._task:
            return False
        if notify:
            self._waiting.append(notify)
        self._wake.set()
        return True

    async def _scan_forever(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            waiting, self._waiting = self._waiting, []
            started = time.time()
            try:
                await self._wait_while_scanning()  # a running scan may have missed the new files
                await self.scan_once(waiting)
                message = f"{self.name} has scanned the library ({time.time() - started:.0f} s)."
                self.last = {"ok": True, "message": message, "at": time.time()}
            except MediaServerError as e:
                message = f"Could not have the library scanned: {e}"
                self.last = {"ok": False, "message": str(e), "at": time.time()}
            except asyncio.CancelledError:
                raise
            except Exception as e:  # a bug: keep the loop alive
                message = f"Could not have the library scanned: unexpected error {e!r}"
                self.last = {"ok": False, "message": message, "at": time.time()}
            for notify in waiting:
                notify(("✔ " if self.last and self.last["ok"] else "⚠ ") + message)

    async def _wait_while_scanning(self) -> None:
        deadline = time.monotonic() + SCAN_TIMEOUT
        while (await self._scan_status()).get("scanning"):
            if time.monotonic() > deadline:
                raise MediaServerError(f"{self.name} has been scanning for over {SCAN_TIMEOUT // 60} minutes.")
            await asyncio.sleep(POLL_SECONDS)

    async def scan_once(self, waiting: list[Notify] = ()) -> None:
        """Start a scan and return once it has finished."""
        before = (await self._scan_status()).get("lastScan")
        await self._call("startScan")
        for notify in waiting:
            notify(f"Asked {self.name} to scan the library.")
        seen_running, start = False, time.monotonic()
        while True:
            await asyncio.sleep(POLL_SECONDS)
            status = await self._scan_status()
            if status.get("scanning"):
                seen_running = True
            elif seen_running or status.get("lastScan") != before:
                return
            elif time.monotonic() - start > UNSEEN_GRACE:
                return  # finished between two looks, on a server that keeps no lastScan
            if time.monotonic() - start > SCAN_TIMEOUT:
                raise MediaServerError(f"{self.name} has been scanning for over {SCAN_TIMEOUT // 60} minutes.")

import asyncio
import hashlib

import httpx
import pytest

from calavera import media
from calavera.media import MediaServer, MediaServerError


class FakeSubsonic:
    """Navidrome as far as Calavera uses it: a scan runs for `scan_polls`
    status requests after startScan."""

    def __init__(self, password="secret", admin=True, scan_polls=2, scanning=0):
        self.password, self.admin, self.scan_polls = password, admin, scan_polls
        self.scanning = scanning  # status requests left until the current scan ends
        self.last_scan = "2026-11-20T10:00:00Z"
        self.calls: list[str] = []
        self.scans = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        q = request.url.params
        method = request.url.path.rsplit("/", 1)[1].removesuffix(".view")
        self.calls.append(method)
        assert "p" not in q, "the password must not be sent"
        if hashlib.md5((self.password + q["s"]).encode()).hexdigest() != q["t"]:
            return self.answer(status="failed", error={"code": 40, "message": "Wrong username or password"})
        if method == "ping":
            return self.answer()
        if method == "getUser":
            return self.answer(user={"username": q["username"], "adminRole": self.admin, "scanningRole": False})
        if method == "startScan":
            if not self.admin:
                return self.answer(status="failed", error={"code": 50, "message": "not authorized"})
            self.scans += 1
            self.scanning = self.scan_polls
            return self.answer(scanStatus={"scanning": True})
        if method == "getScanStatus":
            running = self.scanning > 0
            if running:
                self.scanning -= 1
                if self.scanning == 0:
                    self.last_scan = f"2026-11-20T10:00:{self.scans:02d}Z"
            return self.answer(scanStatus={"scanning": running, "lastScan": self.last_scan})
        return httpx.Response(404)

    @staticmethod
    def answer(status="ok", **fields):
        body = {"status": status, "version": "1.16.1", "type": "navidrome", "serverVersion": "0.58.0", **fields}
        return httpx.Response(200, json={"subsonic-response": body})


def server(fake, password="secret") -> MediaServer:
    return MediaServer("http://navidrome:4533/", "calavera", password, httpx.AsyncClient(transport=httpx.MockTransport(fake)))


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(media, "POLL_SECONDS", 0.001)


def test_not_configured_without_all_three_values():
    assert not MediaServer("", "u", "p").configured
    assert not MediaServer("http://x", "u", "").configured
    assert MediaServer("http://x", "u", "p").configured


def test_a_working_server_passes_the_test():
    assert asyncio.run(server(FakeSubsonic()).test()) == {"server": "Navidrome", "version": "0.58.0"}


def test_a_wrong_password_is_named():
    with pytest.raises(MediaServerError, match="refused the user name or password"):
        asyncio.run(server(FakeSubsonic(), password="wrong").test())


def test_a_user_who_may_not_scan_is_named():
    with pytest.raises(MediaServerError, match="needs to be an admin"):
        asyncio.run(server(FakeSubsonic(admin=False)).test())


def test_an_address_that_is_not_a_subsonic_server_is_named():
    def html(_request):
        return httpx.Response(200, text="<html>router login</html>")
    s = MediaServer("http://192.168.0.1", "u", "p", httpx.AsyncClient(transport=httpx.MockTransport(html)))
    with pytest.raises(MediaServerError, match="does not speak the Subsonic API"):
        asyncio.run(s.test())


def test_an_unreachable_server_is_named():
    def down(request):
        raise httpx.ConnectError("refused", request=request)
    s = MediaServer("http://navidrome:4533", "u", "p", httpx.AsyncClient(transport=httpx.MockTransport(down)))
    with pytest.raises(MediaServerError, match="Cannot reach http://navidrome:4533"):
        asyncio.run(s.test())


def run_requests(s: MediaServer, batches: list[int], settle: float = 0.2) -> list[list[str]]:
    """Request scans in batches (each a number of jobs, a pause between
    batches) and collect what each job's log receives."""
    logs: list[list[str]] = []

    async def go():
        s.start()
        for n in batches:
            for _ in range(n):
                lines: list[str] = []
                logs.append(lines)
                assert s.request_scan(lines.append)
            await asyncio.sleep(0.02)
        await asyncio.sleep(settle)
        await s.stop()

    asyncio.run(go())
    return logs


def test_an_import_is_followed_by_one_finished_scan():
    fake = FakeSubsonic()
    [log] = run_requests(server(fake), [1])
    assert fake.scans == 1
    assert log[0] == "Asked Navidrome to scan the library."
    assert log[1].startswith("✔ Navidrome has scanned the library")


def test_imports_during_a_scan_are_covered_by_one_more_scan():
    fake = FakeSubsonic(scan_polls=40)  # long enough for the next imports to arrive meanwhile
    logs = run_requests(server(fake), [1, 3], settle=0.5)
    assert fake.scans == 2
    assert all(log[-1].startswith("✔ ") for log in logs)


def test_a_scan_already_running_is_waited_for():
    # A scan that started before the import may have missed the new folder.
    fake = FakeSubsonic(scanning=3)
    [log] = run_requests(server(fake), [1])
    assert fake.scans == 1
    assert fake.calls.index("startScan") > 3
    assert log[-1].startswith("✔ ")


def test_a_failing_server_is_reported_in_the_log_and_nothing_raises():
    [log] = run_requests(server(FakeSubsonic(admin=False)), [1])
    assert log == ["⚠ Could not have the library scanned: The user calavera may not start scans on Navidrome; it needs to be an admin."]


def test_no_scan_is_requested_without_a_server():
    s = MediaServer("", "", "")
    s.start()
    assert not s.request_scan(lambda _line: None)

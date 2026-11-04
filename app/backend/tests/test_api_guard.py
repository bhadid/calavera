"""The request guard: Host allowlist (DNS rebinding), Origin check, API docs."""
import pytest
from fastapi.testclient import TestClient

from calavera import api
from calavera import config as config_module
from calavera.config import Config


def make(tmp_path, **extra):
    for name in ("data", "staging", "library/Someone"):
        (tmp_path / name).mkdir(parents=True, exist_ok=True)
    config = Config(
        data_dir=tmp_path / "data", staging_dir=tmp_path / "staging", library_dir=tmp_path / "library",
        static_dir=tmp_path / "none", wrapper_url="http://127.0.0.1:9", supervisor_url="http://127.0.0.1:9",
        control_token_file=tmp_path / "token", amdl_bin="amdl", ffmpeg_bin="ffmpeg", **extra,
    )
    return TestClient(api.create_app(config), base_url="http://localhost")


@pytest.mark.parametrize("header,host", [
    ("192.168.0.4:8080", "192.168.0.4"),
    ("Calavera.Home.LAN", "calavera.home.lan"),
    ("[::1]:8080", "::1"),
    ("::1", "::1"),
    ("", ""),
    ("http://Calavera.lan:8443/", "calavera.lan"),
    ("https://[fd00::4]:8443", "fd00::4"),
])
def test_host_name(header, host):
    assert config_module.host_name(header) == host


def test_allowed_hosts_entries_with_port_or_scheme_match(tmp_path, monkeypatch):
    monkeypatch.setenv("CALAVERA_ALLOWED_HOSTS", "127.0.0.1, proxy.lan:8443,http://Calavera.lan/,,")
    assert config_module.load().allowed_hosts == ("127.0.0.1", "proxy.lan", "calavera.lan")
    http = make(tmp_path, allowed_hosts=("proxy.lan:8443",))
    assert http.get("/api/health", headers={"host": "proxy.lan:8443"}).status_code == 200


def test_local_and_configured_hosts_are_accepted(tmp_path):
    http = make(tmp_path, allowed_hosts=("192.168.0.4", "calavera.home.lan"))
    for host in ("localhost:8080", "127.0.0.1:8080", "[::1]:8080", "192.168.0.4:8080", "calavera.home.lan"):
        assert http.get("/api/health", headers={"host": host}).status_code == 200, host


def test_a_rebound_domain_is_refused_also_for_reads(tmp_path):
    http = make(tmp_path, allowed_hosts=("192.168.0.4",))
    evil = {"host": "evil.example:8080", "origin": "http://evil.example:8080"}
    assert http.get("/api/status", headers=evil).status_code == 421
    r = http.put("/api/settings", json={"storefront": "us"}, headers=evil)
    assert r.status_code == 421
    assert "ALLOWED_HOSTS" in r.text


def test_cross_site_writes_are_still_refused(tmp_path):
    http = make(tmp_path, allowed_hosts=("192.168.0.4",))
    r = http.put("/api/settings", json={"storefront": "us"},
                 headers={"host": "192.168.0.4:8080", "origin": "http://evil.example"})
    assert r.status_code == 403


def test_api_docs_are_off_by_default(tmp_path):
    http = make(tmp_path)
    assert http.get("/api/docs").status_code == 404
    assert http.get("/api/openapi.json").status_code == 404


def test_api_docs_can_be_switched_on(tmp_path):
    http = make(tmp_path, api_docs=True)
    r = http.get("/api/docs")
    assert r.status_code == 200 and "Content-Security-Policy" not in r.headers
    assert "Content-Security-Policy" in http.get("/api/health").headers

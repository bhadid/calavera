"""Process configuration, read once from the environment.

These are deployment facts (paths, service addresses) that cannot change while
the app runs. Everything a user may change at runtime lives in `settings.py`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Always accepted as Host: requests from this machine or container (the
# health check uses 127.0.0.1). A DNS-rebinding page cannot send these, as
# its requests carry its own domain.
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


def host_name(value: str) -> str:
    """The bare host name in a Host header or an ALLOWED_HOSTS entry: lower
    case, without scheme, path, port and IPv6 brackets. Both sides of the Host
    check go through this, so `calavera.lan:8443` or `http://calavera.lan/`
    in ALLOWED_HOSTS match requests for calavera.lan."""
    value = value.strip().lower()
    if "://" in value:
        value = value.split("://", 1)[1]
    value = value.split("/", 1)[0]
    if value.startswith("["):
        return value[1:].split("]", 1)[0]
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


@dataclass(frozen=True)
class Config:
    data_dir: Path          # database and generated amdl configs
    staging_dir: Path       # downloads in progress, one folder per job
    library_dir: Path       # the music library (import destination)
    static_dir: Path        # built frontend
    wrapper_url: str        # wrapper-lite API
    supervisor_url: str     # wrapper supervisor control API
    control_token_file: Path
    amdl_bin: str
    ffmpeg_bin: str
    # Host names the UI may be reached by, besides LOCAL_HOSTS. Requests with
    # any other Host header are refused (DNS rebinding).
    allowed_hosts: tuple[str, ...] = ()
    api_docs: bool = False      # serve /api/docs, which loads assets from a CDN

    @property
    def db_path(self) -> Path:
        return self.data_dir / "calavera.db"


def load() -> Config:
    env = os.environ.get
    return Config(
        data_dir=Path(env("CALAVERA_DATA_DIR", "/data")),
        staging_dir=Path(env("CALAVERA_STAGING_DIR", "/staging")),
        library_dir=Path(env("CALAVERA_LIBRARY_DIR", "/library")),
        static_dir=Path(env("CALAVERA_STATIC_DIR", "/app/static")),
        wrapper_url=env("CALAVERA_WRAPPER_URL", "http://wrapper:12340").rstrip("/"),
        supervisor_url=env("CALAVERA_SUPERVISOR_URL", "http://wrapper:12341").rstrip("/"),
        control_token_file=Path(env("CALAVERA_CONTROL_TOKEN_FILE", "/control/token")),
        amdl_bin=env("CALAVERA_AMDL_BIN", "amdl"),
        ffmpeg_bin=env("CALAVERA_FFMPEG_BIN", "ffmpeg"),
        allowed_hosts=tuple(h for h in map(host_name, env("CALAVERA_ALLOWED_HOSTS", "").split(",")) if h),
        api_docs=env("CALAVERA_API_DOCS", "") == "1",
    )

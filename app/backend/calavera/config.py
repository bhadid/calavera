"""Process configuration, read once from the environment.

These are deployment facts (paths, service addresses) that cannot change while
the app runs. Everything a user may change at runtime lives in `settings.py`.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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
    )

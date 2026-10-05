"""Running the amdl downloader and reading its output.

amdl is a command-line program. Each job gets its own config file and its own
output folder, so nothing is shared between jobs and "which files belong to
this job" never has to be guessed.
"""
from __future__ import annotations

import asyncio
import os
import re
import signal
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import yaml

from .settings import Settings

_TRACK_RE = re.compile(r"^Track (\d+) of (\d+)")
_PERCENT_RE = re.compile(r"^(Downloading|Decrypting)\.\.\.\s+(\d+)%")
_QUALITY_RE = re.compile(r"^(\d+)-bit / (\d+) Hz")
_SUMMARY_RE = re.compile(r"Completed:\s*(\d+)\s*/\s*(\d+).*?Warnings:\s*(\d+).*?Errors:\s*(\d+)")


def build_config(settings: Settings, wrapper_url: str, storefront: str, music_dir: Path) -> dict:
    """amdl's config.yaml for one job. Conversion is left off: Calavera converts
    itself so that it can verify the result before deleting the original."""
    cover = f"{settings.cover_size}x{settings.cover_size}"
    return {
        "general": {
            "lite-server": wrapper_url,
            "media-user-token": "",
            "language": settings.language,
            "max-memory-limit": 256,
            "proxy": "",
            "storefront": storefront,
            "authorization-token": "",
            "exit-on-error": True,
        },
        "media": {
            "get-m3u8-mode": "hires",
            "alac-max": settings.max_sample_rate,
            "atmos-max": 2768,
            "aac-type": "aac-lc",
            "alac-fix": True,
            "mv": {"audio-type": "atmos", "max": 2160},
        },
        "paths": {
            "alac": str(music_dir),
            "atmos": str(music_dir.parent / "atmos"),
            "aac": str(music_dir.parent / "aac"),
            "mv": str(music_dir.parent / "mv"),
            "album-folder": "{AlbumName}",
            "playlist-folder": "{PlaylistName}",
            "artist-folder": "{UrlArtistName}",
            "song-file": "{SongNumer}. {SongName}",
            "limit-max": 200,
            "explicit": "[E]",
            "clean": "[C]",
            "apple-master": "[M]",
        },
        "metadata": {
            "lyrics": {
                "save-file": False,
                "embed": settings.lyrics,
                "type": "lyrics",
                "format": "lrc",
                "extra": "",
            },
            "artwork": {
                "embed": True,
                "size": cover,
                "format": "jpg",
                "save-artist": False,
                "save-animated": False,
                "emby-animated": False,
                "dl-for-playlist": False,
            },
            "tags": {"sort-order": True, "itunes-id": True, "use-songinfo-for-playlist": False},
        },
        "convert": {
            "after-download": False,
            "format": "flac",
            "keep-original": True,
            "skip-if-source-matches": True,
            "ffmpeg-path": "ffmpeg",
            "extra-args": "",
            "with-metadata": True,
            "warn-lossy-to-lossless": True,
            "skip-lossy-to-lossless": True,
            "check-bad-alac": False,
            "delete-bad-alac": False,
        },
    }


@dataclass
class Summary:
    completed: int
    total: int
    warnings: int
    errors: int

    @property
    def clean(self) -> bool:
        return self.total > 0 and self.completed == self.total and self.errors == 0


@dataclass
class Progress:
    """Where the download is, derived line by line from amdl's output."""
    track: int = 0
    total: int = 0
    phase: str = ""       # "Downloading" | "Decrypting" | ""
    percent: int = 0
    quality: str = ""     # e.g. "24-bit / 96 kHz"
    summaries: list[Summary] = field(default_factory=list)

    @property
    def fraction(self) -> float:
        if not self.total:
            return 0.0
        within = {"Downloading": self.percent / 200, "Decrypting": 0.5 + self.percent / 200}.get(self.phase, 0.0)
        return min(1.0, (max(self.track - 1, 0) + within) / self.total)

    @property
    def summary(self) -> Summary | None:
        """All of amdl's summary lines combined (one per URL it processed)."""
        if not self.summaries:
            return None
        return Summary(*(sum(getattr(s, f) for s in self.summaries) for f in ("completed", "total", "warnings", "errors")))

    def feed(self, line: str) -> bool:
        """Update from one output line. Returns True if the line is progress
        noise that should not be kept in the job log."""
        if m := _PERCENT_RE.match(line):
            self.phase, self.percent = m[1], int(m[2])
            return True
        if m := _TRACK_RE.match(line):
            self.track, self.total = int(m[1]), int(m[2])
            self.phase, self.percent = "", 0
        elif m := _QUALITY_RE.match(line):
            rate = int(m[2])
            self.quality = f"{m[1]}-bit / {rate / 1000:g} kHz"
        elif m := _SUMMARY_RE.search(line):
            self.summaries.append(Summary(*(int(g) for g in m.groups())))
        return False


@dataclass
class RunResult:
    exit_code: int
    progress: Progress


class Runner:
    """One amdl invocation that can be cancelled."""

    def __init__(self, amdl_bin: str) -> None:
        self._bin = amdl_bin
        self._proc: asyncio.subprocess.Process | None = None

    async def run(
        self,
        url: str,
        job_dir: Path,
        config: dict,
        on_line: Callable[[str], None],
        on_progress: Callable[[Progress], None],
    ) -> RunResult:
        config_path = job_dir / "amdl.yaml"
        config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
        os.chmod(config_path, 0o600)
        self._proc = await asyncio.create_subprocess_exec(
            self._bin, "--config", str(config_path), url,
            cwd=job_dir,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,  # own process group, so cancel() reaches children
        )
        progress = Progress()
        assert self._proc.stdout is not None
        buffer = b""
        while chunk := await self._proc.stdout.read(4096):
            # Progress bars are redrawn with carriage returns: treat \r like \n.
            *lines, buffer = re.split(rb"[\r\n]", buffer + chunk)
            for raw in lines:
                self._handle(raw, progress, on_line, on_progress)
        self._handle(buffer, progress, on_line, on_progress)
        return RunResult(await self._proc.wait(), progress)

    @staticmethod
    def _handle(raw: bytes, progress: Progress, on_line, on_progress) -> None:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            return
        if not progress.feed(line):
            on_line(line)
        on_progress(progress)

    def cancel(self) -> None:
        proc = self._proc
        if proc is None or proc.returncode is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def make_track():
    """Create a short, tagged audio file with ffmpeg."""
    def make(path: Path, title: str | None = "Song", codec: str = "alac", bits: int = 24, rate: int = 44100) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration=2:sample_rate={rate}"]
        if codec == "alac":
            cmd += ["-c:a", "alac", "-sample_fmt", "s32p" if bits == 24 else "s16p"]
        else:
            cmd += ["-c:a", codec]
        if title:
            cmd += ["-metadata", f"title={title}", "-metadata", "artist=Artist", "-metadata", "lyrics=[00:01.00]la la"]
        subprocess.run(cmd + [str(path)], check=True)
        return path
    return make

"""Files a finished job hands to the browser: a ZIP built while it is sent.

The ZIP is "stored" (not compressed): FLAC and ALAC are compressed already, so
deflating them would cost CPU for nothing. Nothing is written to disk; the
archive is produced in pieces as the response goes out, and only one chunk of
one file is in memory at a time.

`zip_size` gives the exact length of the archive before it is made, so the
response can carry a Content-Length and the browser can show progress. It
mirrors what `zipfile` writes to a stream it cannot seek (local header, data,
data descriptor, central directory, end records, with ZIP64 parts where sizes
or offsets need them); the tests check it against real archives.
"""
from __future__ import annotations

import os
import time
import zipfile
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

CHUNK = 1 << 20


@dataclass(frozen=True)
class Entry:
    name: str   # path inside the archive, "/"-separated
    path: Path  # the file on disk
    size: int


def entries_for(folders: Iterable[tuple[str, Path]]) -> list[Entry]:
    """Every file of each (archive folder name, folder on disk), sorted."""
    found = []
    for root, folder in folders:
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            rel = path.relative_to(folder).as_posix()
            found.append(Entry(f"{root}/{rel}", path, path.stat().st_size))
    return found


def _name_bytes(name: str) -> int:
    try:
        return len(name.encode("ascii"))
    except UnicodeEncodeError:
        return len(name.encode("utf-8"))


def zip_size(entries: list[Entry]) -> int:
    limit = zipfile.ZIP64_LIMIT
    offset = 0
    central = 0
    for e in entries:
        n = _name_bytes(e.name)
        zip64 = e.size * 1.05 > limit
        header_offset = offset
        offset += 30 + n + (20 if zip64 else 0) + e.size + (24 if zip64 else 16)
        extra = (2 if e.size > limit else 0) + (1 if header_offset > limit else 0)
        central += 46 + n + (4 + 8 * extra if extra else 0)
    end = 22
    if len(entries) > zipfile.ZIP_FILECOUNT_LIMIT or offset > limit or central > limit:
        end += 56 + 20
    return offset + central + end


class _Sink:
    """A write-only stream that hands back what was written to it."""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._parts.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        data = b"".join(self._parts)
        self._parts.clear()
        return data


def _date_time(path: Path) -> tuple[int, int, int, int, int, int]:
    t = time.localtime(max(os.stat(path).st_mtime, 315532800 + 86400))  # ZIP dates start in 1980
    return t[:6]


def zip_stream(entries: list[Entry], chunk: int = CHUNK) -> Iterator[bytes]:
    sink = _Sink()
    with zipfile.ZipFile(sink, "w", zipfile.ZIP_STORED) as archive:  # type: ignore[arg-type]
        for e in entries:
            info = zipfile.ZipInfo(e.name, date_time=_date_time(e.path))
            info.file_size = e.size
            info.external_attr = 0o644 << 16
            with open(e.path, "rb") as src, archive.open(info, "w") as dst:
                while block := src.read(chunk):
                    dst.write(block)
                    if data := sink.take():
                        yield data
            if data := sink.take():
                yield data
    if data := sink.take():
        yield data

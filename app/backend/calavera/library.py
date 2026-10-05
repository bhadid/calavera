"""Importing finished albums into the music library.

The library is the user's whole collection, so the rules are strict:

* Nothing in the library is ever overwritten, renamed or deleted. The only
  operations performed there are: create a directory, create a new file inside
  a directory this module created, and rename that directory once.
* If the artist folder exists (compared case-insensitively) the album goes
  inside it; otherwise the artist folder is created.
* If the album folder exists under that artist, the whole album is skipped.
* If the library looks unmounted (missing, empty or read-only) nothing is
  written.
* The album is copied into a hidden temporary folder, every file is read back
  and its SHA-256 compared, and only then is the folder renamed into place.

Everything here blocks; call it via asyncio.to_thread.
"""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

TMP_PREFIX = ".calavera-importing-"
# Characters the downloader replaces with "_" when it builds folder names.
_FORBIDDEN = re.compile(r'[\\/<>:"|?*]')


@dataclass(frozen=True)
class ImportResult:
    status: str   # "imported" | "exists" | "failed"
    message: str
    path: str = ""  # album folder inside the library, relative to its root


def folder_name(name: str) -> str:
    """The folder name the downloader derives from an artist or album name."""
    return _FORBIDDEN.sub("_", name).strip()


def _norm(name: str) -> str:
    return unicodedata.normalize("NFC", name).strip().casefold()


def find_entry(parent: Path, name: str) -> str | None:
    """Name of the entry in `parent` matching `name` case-insensitively.
    An exact match wins."""
    try:
        entries = os.listdir(parent)
    except OSError:
        return None
    if name in entries:
        return name
    wanted = _norm(name)
    return next((e for e in sorted(entries) if _norm(e) == wanted), None)


def find_album(library: Path, artist: str, album: str) -> str | None:
    """Relative path of an existing album folder, or None."""
    artist_entry = find_entry(library, folder_name(artist))
    if artist_entry is None:
        return None
    album_entry = find_entry(library / artist_entry, folder_name(album))
    return f"{artist_entry}/{album_entry}" if album_entry else None


def library_problem(library: Path) -> str | None:
    """Why the library must not be written to right now, or None if it is fine."""
    if not library.is_dir():
        return f"The library folder {library} does not exist."
    try:
        visible = [e for e in os.listdir(library) if not e.startswith(".")]
    except OSError as e:
        return f"The library folder is not readable ({e.strerror})."
    if not visible:
        return "The library folder is empty, so it is probably not mounted."
    if not os.access(library, os.W_OK):
        return "The library folder is not writable."
    return None


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _copy_new(src: Path, dst: Path, mode: int) -> str:
    """Copy src to dst, failing if dst exists. Returns the SHA-256 of src."""
    h = hashlib.sha256()
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "wb") as out, open(src, "rb") as inp:
        for chunk in iter(lambda: inp.read(1 << 20), b""):
            h.update(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    return h.hexdigest()


def import_album(src_dir: Path, library: Path, artist: str, album: str) -> ImportResult:
    """Copy the album in `src_dir` to `<library>/<artist>/<album>/`.

    `artist` and `album` are folder names. `src_dir` is not modified; the
    caller removes it after a successful import.
    """
    files = sorted(p for p in src_dir.iterdir() if p.is_file())
    if not files:
        return ImportResult("failed", "There is nothing to import.")
    problem = library_problem(library)
    if problem:
        return ImportResult("failed", problem)

    try:
        artist_entry = find_entry(library, artist)
        if artist_entry is None:
            artist_dir = library / artist
            artist_dir.mkdir(mode=library.stat().st_mode & 0o777)
        else:
            artist_dir = library / artist_entry
            if not artist_dir.is_dir():
                return ImportResult("failed", f"'{artist_entry}' in the library is not a folder.")

        existing = find_entry(artist_dir, album)
        if existing is not None:
            return ImportResult(
                "exists",
                f"The library already has '{artist_dir.name}/{existing}'. Nothing in the library was touched.",
                f"{artist_dir.name}/{existing}",
            )

        dir_mode = artist_dir.stat().st_mode & 0o777
        tmp_dir = artist_dir / f"{TMP_PREFIX}{uuid.uuid4().hex[:8]}"
        final_dir = artist_dir / album
        tmp_dir.mkdir(mode=dir_mode)
        sums = {f.name: _copy_new(f, tmp_dir / f.name, dir_mode & 0o666) for f in files}
        for name, digest in sums.items():
            if _sha256(tmp_dir / name) != digest:
                raise OSError(f"checksum mismatch after copying {name}")
        if os.path.lexists(final_dir):
            raise OSError("the album folder appeared in the library during the copy")
        tmp_dir.rename(final_dir)
    except OSError as e:
        return ImportResult(
            "failed",
            f"Copying to the library failed ({e}). If a folder starting with '{TMP_PREFIX}' was left "
            f"in the artist folder, it was created by this import and can be removed by hand.",
        )
    return ImportResult("imported", f"Copied {len(files)} files and verified them.", f"{artist_dir.name}/{album}")

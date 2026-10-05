"""Audio file inspection and ALAC to FLAC conversion.

Inspection uses mutagen (pure Python). Conversion and the decoded-audio
checksum use ffmpeg. Everything here blocks; call it via asyncio.to_thread.
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4

AUDIO_EXTS = (".m4a", ".flac")


class AudioError(Exception):
    pass


@dataclass(frozen=True)
class AudioInfo:
    codec: str
    sample_rate: int
    bit_depth: int
    duration: float
    title: str


def probe(path: Path) -> AudioInfo:
    try:
        if path.suffix.lower() == ".flac":
            f = FLAC(path)
            title = (f.get("title") or [""])[0]
            return AudioInfo("flac", f.info.sample_rate, f.info.bits_per_sample, f.info.length, title)
        m = MP4(path)
        title = ((m.tags or {}).get("\xa9nam") or [""])[0]
        return AudioInfo(m.info.codec, m.info.sample_rate, m.info.bits_per_sample, m.info.length, title)
    except Exception as e:  # mutagen raises many unrelated error types
        raise AudioError(f"{path.name}: unreadable audio file ({e})") from e


def check_finished(path: Path, codec: str) -> AudioInfo:
    """Raise AudioError unless `path` is a complete, tagged track in `codec`."""
    info = probe(path)
    if info.codec != codec:
        raise AudioError(f"{path.name}: codec is {info.codec}, expected {codec}")
    if info.duration < 1:
        raise AudioError(f"{path.name}: has no duration")
    if not info.title:
        raise AudioError(f"{path.name}: has no title tag, so the track was not finalised")
    return info


def check_decodes(ffmpeg: str, path: Path) -> None:
    """Raise AudioError unless the whole file decodes without errors.

    A download that was cut off can leave a file whose header (duration,
    tags) looks complete while audio data is missing; only decoding it shows
    that.
    """
    proc = subprocess.run(
        [ffmpeg, "-v", "error", "-xerror", "-i", str(path), "-map", "0:a:0", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or proc.stderr.strip():
        raise AudioError(f"{path.name}: audio data is incomplete or damaged")


def decoded_md5(ffmpeg: str, path: Path) -> str:
    """MD5 of the audio decoded to 32-bit PCM: equal for two files exactly when
    they hold the same audio, whatever the codec."""
    proc = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-map", "0:a:0", "-c:a", "pcm_s32le", "-f", "md5", "-"],
        capture_output=True, text=True,
    )
    digest = proc.stdout.strip()
    if proc.returncode != 0 or not digest.startswith("MD5="):
        raise AudioError(f"{path.name}: could not decode ({proc.stderr.strip()[:300]})")
    return digest


# ffmpeg copies MP4 metadata into the FLAC file under its own generic names.
# Container details are dropped and the sort tags renamed to the Vorbis
# comment names media servers (Navidrome, Jellyfin, Picard) read.
_DROP_TAGS = ("major_brand", "minor_version", "compatible_brands", "creation_time", "encoder")
_RENAME_TAGS = {
    "sort_name": "TITLESORT",
    "sort_artist": "ARTISTSORT",
    "sort_album": "ALBUMSORT",
    "sort_album_artist": "ALBUMARTISTSORT",
    "sort_composer": "COMPOSERSORT",
    "album_artist": "ALBUMARTIST",
}
_NUMBER_TAGS = {"tracknumber": "TRACKTOTAL", "discnumber": "DISCTOTAL"}


def normalise_flac_tags(path: Path) -> None:
    """Rewrite the tags ffmpeg produced into conventional FLAC tags."""
    f = FLAC(path)
    tags = {key.lower(): list(values) for key, values in (f.tags.as_dict() if f.tags else {}).items()}
    for key in _DROP_TAGS:
        tags.pop(key, None)
    for old, new in _RENAME_TAGS.items():
        if old in tags:
            tags[new.lower()] = tags.pop(old)
    for key, total_key in _NUMBER_TAGS.items():
        # "3/13" becomes TRACKNUMBER=3 and TRACKTOTAL=13.
        number, _, total = (tags.get(key) or [""])[0].partition("/")
        if number:
            tags[key] = [number]
        if total:
            tags[total_key.lower()] = [total]
    f.delete()
    for key, values in tags.items():
        f[key.upper()] = values
    pictures = list(f.pictures)
    f.clear_pictures()
    for old in pictures:
        picture = Picture()
        picture.data, picture.mime = old.data, old.mime
        picture.width, picture.height, picture.depth = old.width, old.height, old.depth
        picture.type = 3  # front cover; ffmpeg writes "other"
        f.add_picture(picture)
    f.save()


def convert_to_flac(ffmpeg: str, src: Path) -> Path:
    """Convert one ALAC .m4a to .flac next to it, verify it, delete the source.

    The FLAC must decode to the same audio as the ALAC file and keep its sample
    rate, bit depth and title. Only then is the ALAC file removed. On any
    failure the partial FLAC is removed and the ALAC file is left in place.
    """
    dst = src.with_suffix(".flac")
    source = check_finished(src, "alac")
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", "-v", "error", "-i", str(src),
             "-map_metadata", "0", "-map", "0",
             "-c:a", "flac", "-c:v", "copy", "-disposition:v", "attached_pic",
             str(dst)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise AudioError(f"{src.name}: ffmpeg failed ({proc.stderr.strip()[:300]})")
        normalise_flac_tags(dst)
        converted = check_finished(dst, "flac")
        if (converted.sample_rate, converted.bit_depth) != (source.sample_rate, source.bit_depth):
            raise AudioError(
                f"{src.name}: FLAC is {converted.bit_depth}-bit/{converted.sample_rate} Hz, "
                f"source is {source.bit_depth}-bit/{source.sample_rate} Hz"
            )
        if decoded_md5(ffmpeg, dst) != decoded_md5(ffmpeg, src):
            raise AudioError(f"{src.name}: FLAC does not decode to the same audio as the source")
    except BaseException:
        dst.unlink(missing_ok=True)
        raise
    os.chmod(dst, 0o644)
    src.unlink()
    return dst

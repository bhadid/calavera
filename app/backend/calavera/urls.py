"""Apple Music URL parsing."""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

_PATH_RE = re.compile(
    r"^/(?P<storefront>[a-z]{2})/(?P<kind>album|song|playlist|artist|music-video|station)"
    r"(?:/[^/]+)?/(?P<id>[A-Za-z0-9.\-]+)/?$"
)

# What the download pipeline can turn into an Artist/Album folder today.
SUPPORTED_KINDS = ("album", "song")


class UnsupportedUrl(ValueError):
    pass


@dataclass(frozen=True)
class AppleUrl:
    kind: str        # "album" or "song"
    storefront: str  # two-letter store code from the URL, e.g. "de"
    apple_id: str    # catalogue id of the album or song
    url: str         # normalised URL handed to the downloader


def parse(raw: str) -> AppleUrl:
    """Validate an Apple Music link and normalise it.

    Raises UnsupportedUrl with a message suitable for showing to the user.
    """
    raw = (raw or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("music.apple.com", "beta.music.apple.com"):
        raise UnsupportedUrl("That is not an Apple Music link (expected https://music.apple.com/…).")
    m = _PATH_RE.match(parsed.path)
    if not m:
        raise UnsupportedUrl("That Apple Music link could not be understood.")
    kind, storefront, apple_id = m["kind"], m["storefront"], m["id"]
    track = (parse_qs(parsed.query).get("i") or [""])[0]
    if kind == "album" and track:
        # An album link with ?i=<id> points at one song of that album.
        kind, apple_id = "song", track
    if kind not in SUPPORTED_KINDS:
        raise UnsupportedUrl(f"{kind.replace('-', ' ').capitalize()} links are not supported yet; use an album or song link.")
    if not apple_id.isdigit():
        raise UnsupportedUrl("That Apple Music link has no numeric album or song id.")
    return AppleUrl(kind, storefront, apple_id, f"https://music.apple.com/{storefront}/{kind}/{apple_id}")

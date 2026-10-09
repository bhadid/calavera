"""Read-only access to Apple Music's catalogue: search and album/song lookup.

The catalogue API needs a bearer token. The Apple Music web player ships an
anonymous one in its JavaScript bundle; this module fetches it the same way
the downloader does. No Apple account is involved. If Apple changes the web
player, `_fetch_token` is the one place that needs updating.
"""
from __future__ import annotations

import base64
import json
import re
import time

import httpx

_WEB = "https://music.apple.com"
_API = "https://amp-api.music.apple.com/v1/catalog"
_BUNDLE_RE = re.compile(r"/assets/index~[^\"'/]+\.js")
_JWT_RE = re.compile(r"eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+")
_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


# An artist page shows at most this many releases.
ARTIST_ALBUMS = 300
# How long to leave Apple alone after it asks for a pause, in seconds: its
# own figure (Retry-After) within these bounds, the first one without it.
_PAUSE = (60, 900)


class CatalogError(Exception):
    pass


def _artwork(attrs: dict, size: int = 600) -> str:
    url = (attrs.get("artwork") or {}).get("url") or ""
    return url.replace("{w}", str(size)).replace("{h}", str(size))


def _artists(item: dict) -> list[dict]:
    """Who made an album or song, for linking to artist pages. Apple sends
    this only when asked (`include`); `artistName` is the text to display."""
    related = ((item.get("relationships") or {}).get("artists") or {}).get("data") or []
    named = [{"id": r.get("id", ""), "name": (r.get("attributes") or {}).get("name", "")} for r in related]
    return [artist for artist in named if artist["id"] and artist["name"]]


def _album(item: dict) -> dict:
    a = item.get("attributes") or {}
    return {
        "id": item.get("id", ""),
        "name": a.get("name", ""),
        "artist": a.get("artistName", ""),
        "artists": _artists(item),
        "artwork": _artwork(a),
        "url": a.get("url", ""),
        "track_count": a.get("trackCount", 0),
        "release_date": a.get("releaseDate", ""),
        "traits": a.get("audioTraits") or [],
        "explicit": a.get("contentRating") == "explicit",
        "single": bool(a.get("isSingle")),
    }


def _song(item: dict) -> dict:
    a = item.get("attributes") or {}
    return {
        "id": item.get("id", ""),
        "name": a.get("name", ""),
        "artist": a.get("artistName", ""),
        "artists": _artists(item),
        "album": a.get("albumName", ""),
        "artwork": _artwork(a),
        "url": a.get("url", ""),
        "duration_ms": a.get("durationInMillis", 0),
        "traits": a.get("audioTraits") or [],
        "explicit": a.get("contentRating") == "explicit",
        "track_number": a.get("trackNumber", 0),
        "disc_number": a.get("discNumber", 1),
        # Apple lists songs it does not offer for streaming (greyed out in
        # its own apps). They carry no play parameters and cannot be downloaded.
        "available": "playParams" in a,
    }


def _artist(item: dict) -> dict:
    a = item.get("attributes") or {}
    return {"id": item.get("id", ""), "name": a.get("name", ""), "artwork": _artwork(a), "url": a.get("url", "")}


def _wait_text(seconds: float) -> str:
    minutes = round(seconds / 60)
    return "a minute" if minutes <= 1 else f"{minutes} minutes"


class Catalog:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=10.0, headers={"User-Agent": _UA}, follow_redirects=True)
        self._token = ""
        self._token_expires = 0.0
        self._paused_until = 0.0

    async def close(self) -> None:
        await self._http.aclose()

    async def _fetch_token(self) -> str:
        page = await self._http.get(_WEB)
        bundle = _BUNDLE_RE.search(page.text)
        if not bundle:
            raise CatalogError("Apple's web player changed: its script bundle was not found.")
        script = await self._http.get(_WEB + bundle.group(0))
        token = _JWT_RE.search(script.text)
        if not token:
            raise CatalogError("Apple's web player changed: no catalogue token was found.")
        return token.group(0)

    async def _get_token(self, force: bool = False) -> str:
        if force or not self._token or time.time() > self._token_expires:
            self._token = await self._fetch_token()
            try:
                payload = self._token.split(".")[1]
                exp = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("exp", 0)
            except (ValueError, IndexError):
                exp = 0
            # Refresh a day before expiry; without a readable expiry, hourly.
            self._token_expires = (exp - 86400) if exp else time.time() + 3600
        return self._token

    def _pause(self, retry_after: str | None) -> None:
        try:
            wanted = float(retry_after or _PAUSE[0])
        except ValueError:  # a date instead of seconds
            wanted = _PAUSE[0]
        self._paused_until = time.monotonic() + min(max(wanted, _PAUSE[0]), _PAUSE[1])

    async def _get(self, path: str, params: dict) -> dict:
        # After Apple asked for a pause nothing is sent until it is over, so
        # that impatient clicking cannot turn a pause into a block.
        wait = self._paused_until - time.monotonic()
        if wait > 0:
            raise CatalogError(f"Apple Music asked for a pause. Try again in {_wait_text(wait)}.")
        try:
            for attempt in (0, 1):
                token = await self._get_token(force=bool(attempt))
                resp = await self._http.get(
                    f"{_API}/{path}",
                    params={k: v for k, v in params.items() if v not in ("", None)},
                    headers={"Authorization": f"Bearer {token}", "Origin": _WEB},
                )
                if resp.status_code == 401 and attempt == 0:
                    continue  # token rejected: fetch a new one once
                if resp.status_code == 429:
                    self._pause(resp.headers.get("Retry-After"))
                    wait = self._paused_until - time.monotonic()
                    raise CatalogError(f"Apple Music asked for a pause: too many requests. Try again in {_wait_text(wait)}.")
                if resp.status_code == 404:
                    raise CatalogError("Not found in the Apple Music catalogue.")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            raise CatalogError(f"The Apple Music catalogue could not be reached ({type(e).__name__}).") from e
        raise CatalogError("The Apple Music catalogue rejected the request.")

    async def album(self, storefront: str, album_id: str, language: str = "") -> dict:
        data = await self._get(f"{storefront}/albums/{album_id}", {"l": language, "include": "artists", "include[songs]": "artists"})
        items = data.get("data") or []
        if not items:
            raise CatalogError("Album not found.")
        album = _album(items[0])
        tracks = ((items[0].get("relationships") or {}).get("tracks") or {}).get("data") or []
        album["tracks"] = [_song(t) for t in tracks if t.get("type") == "songs"]
        return album

    async def song(self, storefront: str, song_id: str, language: str = "") -> dict:
        data = await self._get(f"{storefront}/songs/{song_id}", {"l": language, "include": "artists"})
        items = data.get("data") or []
        if not items:
            raise CatalogError("Song not found.")
        return _song(items[0])

    async def artist_albums(self, storefront: str, artist_id: str, language: str = "") -> dict:
        info = await self._get(f"{storefront}/artists/{artist_id}", {"l": language})
        items = info.get("data") or []
        if not items:
            raise CatalogError("Artist not found.")
        albums: list[dict] = []
        offset = 0
        more = False
        while True:
            page = await self._get(
                f"{storefront}/artists/{artist_id}/albums",
                {"l": language, "limit": 100, "offset": offset, "include": "artists"},
            )
            batch = page.get("data") or []
            albums += [_album(a) for a in batch]
            if not page.get("next") or not batch:
                break
            if len(albums) >= ARTIST_ALBUMS:
                more = True  # Apple has further pages; they are not fetched
                break
            offset += len(batch)
        albums.sort(key=lambda a: a["release_date"], reverse=True)
        return {**_artist(items[0]), "albums": albums, "more": more}

    async def search(self, storefront: str, term: str, language: str = "", limit: int = 20) -> dict:
        data = await self._get(
            f"{storefront}/search",
            {
                "term": term,
                "types": "albums,songs,artists",
                "limit": limit,
                "l": language,
                "include[albums]": "artists",
                "include[songs]": "artists",
            },
        )
        results = data.get("results") or {}
        pick = lambda key: (results.get(key) or {}).get("data") or []  # noqa: E731
        return {
            "albums": [_album(i) for i in pick("albums")],
            "songs": [_song(i) for i in pick("songs")],
            "artists": [_artist(i) for i in pick("artists")],
        }

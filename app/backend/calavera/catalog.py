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
# Apple's own grouping of an artist's releases, in the order its Music app
# shows them: Apple's name for each group, and Calavera's.
GROUPS = {
    "full-albums": "albums",
    "singles": "singles",
    "live-albums": "live",
    "compilation-albums": "compilations",
    "appears-on-albums": "appears_on",
}
# Releases in one page of a group.
GROUP_PAGE = 100
# How long to leave Apple alone after it asks for a pause, in seconds: its
# own figure (Retry-After) within these bounds, the first one without it.
_PAUSE = (60, 900)
# The lossless variants in a song's stream description: sample rate, bit depth.
_ALAC_RE = re.compile(r"audio-alac-stereo-(\d+)-(\d+)")
# Apple's "lossless" ends at this sample rate. "Hi-res lossless" is 24-bit
# at one of 88.2, 96, 176.4 or 192 kHz: the lowest and the highest.
_LOSSLESS_MAX = 48000
_HIRES = (88200, 192000)
# For how many albums the address of a stream description is remembered.
_STREAMS_KEPT = 300


class CatalogError(Exception):
    pass


class NotInCatalog(CatalogError):
    """Apple answered, and what was asked for does not exist."""


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
        "label": a.get("recordLabel", ""),
    }


def _group_by_title(album: dict) -> str:
    """A release's group when Apple's grouping does not have it. Apple marks
    only one-song releases as singles, but names singles and EPs by a suffix."""
    if album["single"] or album["name"].endswith((" - Single", " - EP")):
        return "singles"
    return "albums"


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


def _stream_url(album: dict, tracks: list[dict]) -> str:
    """The address of one song's stream description (an HLS playlist on
    Apple's download servers), which lists the qualities on offer. The song is
    the first one with the album's best quality, so that a lossless-only
    bonus track does not speak for a hi-res album."""
    best = next((t for t in ("hi-res-lossless", "lossless") if t in album["traits"]), "")
    urls = [
        (best in ((t.get("attributes") or {}).get("audioTraits") or []), url)
        for t in tracks
        if (url := ((t.get("attributes") or {}).get("extendedAssetUrls") or {}).get("enhancedHls"))
    ]
    return next((url for fits, url in urls if fits), urls[0][1] if urls else "")


def _best_lossless(playlist: str) -> dict | None:
    found = [(int(rate), int(depth)) for rate, depth in _ALAC_RE.findall(playlist)]
    if not found:
        return None
    rate, depth = max(found)
    return {"sample_rate": rate, "bit_depth": depth}


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
        self._streams: dict[tuple[str, str], tuple[str, bool]] = {}
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
                    raise NotInCatalog("Not found in the Apple Music catalogue.")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            raise CatalogError(f"The Apple Music catalogue could not be reached ({type(e).__name__}).") from e
        raise CatalogError("The Apple Music catalogue rejected the request.")

    async def album(self, storefront: str, album_id: str, language: str = "") -> dict:
        data = await self._get(
            f"{storefront}/albums/{album_id}",
            {"l": language, "include": "artists", "include[songs]": "artists", "extend[songs]": "extendedAssetUrls"},
        )
        items = data.get("data") or []
        if not items:
            raise NotInCatalog("Album not found.")
        album = _album(items[0])
        tracks = ((items[0].get("relationships") or {}).get("tracks") or {}).get("data") or []
        album["tracks"] = [_song(t) for t in tracks if t.get("type") == "songs"]
        # Kept for album_quality, so that it needs no second catalogue request.
        self._streams.pop((storefront, album_id), None)
        self._streams[(storefront, album_id)] = (_stream_url(album, tracks), "hi-res-lossless" in album["traits"])
        while len(self._streams) > _STREAMS_KEPT:
            del self._streams[next(iter(self._streams))]
        return album

    async def album_quality(self, storefront: str, album_id: str) -> dict | None:
        """The lossless quality an album is offered in: `bit_depth` and the
        sample rate as a range, `sample_rate_min` to `sample_rate_max`, which
        are equal when the rate is known. None if nothing can be told.

        The numbers come from one song's public stream description: one small
        download, no catalogue request if the album was just looked up. That
        file is right for lossless albums but can leave out the hi-res
        versions, which only the description given to a signed-in device
        lists in full. Calavera does not ask for that one, so that browsing
        stays anonymous. A hi-res album's rate is therefore a range: from
        the hi-res rate the file names, or else the lowest one there is, up
        to the highest Apple offers."""
        if (storefront, album_id) not in self._streams:
            await self.album(storefront, album_id)
        url, hires = self._streams[(storefront, album_id)]
        listed = await self._listed_quality(url)
        if not hires:
            if not listed:
                return None
            return {"bit_depth": listed["bit_depth"], "sample_rate_min": listed["sample_rate"], "sample_rate_max": listed["sample_rate"]}
        lowest = listed["sample_rate"] if listed and listed["sample_rate"] > _LOSSLESS_MAX else _HIRES[0]
        return {"bit_depth": 24, "sample_rate_min": lowest, "sample_rate_max": _HIRES[1]}

    async def _listed_quality(self, stream_url: str) -> dict | None:
        url = httpx.URL(stream_url)
        if url.scheme != "https" or not url.host.endswith(".apple.com"):
            return None
        if self._paused_until > time.monotonic():
            return None
        try:
            resp = await self._http.get(url)
            resp.raise_for_status()
        except httpx.HTTPError:
            return None
        return _best_lossless(resp.text)

    async def song(self, storefront: str, song_id: str, language: str = "") -> dict:
        data = await self._get(f"{storefront}/songs/{song_id}", {"l": language, "include": "artists"})
        items = data.get("data") or []
        if not items:
            raise NotInCatalog("Song not found.")
        return _song(items[0])

    async def artist_albums(self, storefront: str, artist_id: str, language: str = "") -> dict:
        """An artist with every release Apple lists for them, each in a
        `group` (see `GROUPS`).

        The releases come from the full list; the groups from Apple's own
        grouping. That grouping leaves out releases it counts as the same as
        another, which can be a different version (a radio edit under the
        same title), so it only sorts and never hides anything. A release
        outside it (`grouped` false) joins the group of the release with the
        same title and is marked as `other_release`; without one it is sorted
        by its title."""
        info = await self._get(f"{storefront}/artists/{artist_id}", {"l": language, "views": ",".join(GROUPS)})
        items = info.get("data") or []
        if not items:
            raise NotInCatalog("Artist not found.")
        groups = await self._artist_groups(storefront, artist_id, language, items[0].get("views") or {})
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
        namesakes = {a["name"].casefold(): groups[a["id"]] for a in albums if a["id"] in groups}
        for album in albums:
            album["grouped"] = album["id"] in groups
            namesake = None if album["grouped"] else namesakes.get(album["name"].casefold())
            album["group"] = groups.get(album["id"]) or namesake or _group_by_title(album)
            album["other_release"] = namesake is not None
        albums.sort(key=lambda a: a["release_date"], reverse=True)
        return {**_artist(items[0]), "albums": albums, "more": more}

    async def artist(self, storefront: str, artist_id: str, language: str = "") -> dict:
        """An artist with the first few releases of each group in Apple's
        grouping (`shelves`), all in one request. `more`: the group has
        further releases (see `artist_group`)."""
        info = await self._get(
            f"{storefront}/artists/{artist_id}",
            {"l": language, "views": ",".join(GROUPS), "include[albums]": "artists"},
        )
        items = info.get("data") or []
        if not items:
            raise NotInCatalog("Artist not found.")
        views = items[0].get("views") or {}
        shelves = []
        for view, group in GROUPS.items():
            answer = views.get(view) or {}
            batch = answer.get("data") or []
            if batch:
                shelves.append({"group": group, "items": [_album(a) for a in batch], "more": bool(answer.get("next"))})
        return {**_artist(items[0]), "shelves": shelves}

    async def artist_group(self, storefront: str, artist_id: str, group: str, offset: int = 0, language: str = "") -> dict:
        """One page of a group in Apple's grouping. `next`: the offset of the
        following page, or None."""
        view = next(v for v, g in GROUPS.items() if g == group)
        try:
            page = await self._get(
                f"{storefront}/artists/{artist_id}/view/{view}",
                {"l": language, "limit": GROUP_PAGE, "offset": offset, "include[albums]": "artists"},
            )
        except NotInCatalog:
            # Apple answers an empty group with "not found".
            return {"items": [], "next": None}
        batch = page.get("data") or []
        return {"items": [_album(a) for a in batch], "next": offset + len(batch) if page.get("next") and batch else None}

    async def _artist_groups(self, storefront: str, artist_id: str, language: str, views: dict) -> dict[str, str]:
        """Release ID -> group, from Apple's grouping. Apple sends the first
        few of each group with the artist; the rest are fetched page by page.
        If that fails, the releases not yet seen are sorted by their title."""
        groups: dict[str, str] = {}
        for view, group in GROUPS.items():
            answer = views.get(view) or {}
            offset = 0
            while True:
                batch = answer.get("data") or []
                groups.update((a.get("id", ""), group) for a in batch)
                offset += len(batch)
                if not answer.get("next") or not batch or offset >= ARTIST_ALBUMS:
                    break
                try:
                    answer = await self._get(
                        f"{storefront}/artists/{artist_id}/view/{view}", {"l": language, "limit": 100, "offset": offset}
                    )
                except CatalogError:
                    break
        return groups

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

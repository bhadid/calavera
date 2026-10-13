import asyncio
import time

import httpx
import pytest

from calavera import catalog as catalog_module
from calavera.catalog import Catalog, CatalogError, _album, _artists, _song


def related(*artists):
    return {"artists": {"data": [{"id": i, "type": "artists", **({"attributes": {"name": n}} if n else {})} for i, n in artists]}}


def test_artists_come_from_the_relationship():
    item = {"id": "1", "attributes": {"artistName": "A & B"}, "relationships": related(("10", "A"), ("11", "B"))}
    assert _artists(item) == [{"id": "10", "name": "A"}, {"id": "11", "name": "B"}]
    assert _album(item)["artists"] == _artists(item)
    assert _album(item)["artist"] == "A & B"
    assert _song(item)["artists"] == _artists(item)


def test_no_relationship_means_no_artists():
    assert _artists({"id": "1", "attributes": {"artistName": "Various Artists"}}) == []
    assert _album({"id": "1"})["artists"] == []
    assert _song({"id": "1", "relationships": {"artists": {"data": []}}})["artists"] == []


def test_artists_without_a_name_are_left_out():
    # Apple sends bare references when the relationship was not asked for.
    assert _artists({"relationships": related(("10", None), ("11", "B"))}) == [{"id": "11", "name": "B"}]


def catalog_answering(handler) -> Catalog:
    """A catalogue whose requests go to `handler` instead of Apple."""
    catalog = Catalog()
    catalog._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    catalog._token, catalog._token_expires = "token", time.time() + 3600
    return catalog


def test_a_pause_asked_for_by_apple_is_kept():
    sent = []

    def handler(request):
        sent.append(request.url.path)
        return httpx.Response(429, headers={"Retry-After": "120"})

    catalog = catalog_answering(handler)
    with pytest.raises(CatalogError, match="asked for a pause.*2 minutes"):
        asyncio.run(catalog.song("de", "1"))
    assert len(sent) == 1
    # The next request is refused here, without asking Apple again.
    with pytest.raises(CatalogError, match="asked for a pause"):
        asyncio.run(catalog.album("de", "2"))
    assert len(sent) == 1
    # Once the pause is over, requests go out again.
    catalog._paused_until = time.monotonic() - 1
    with pytest.raises(CatalogError):
        asyncio.run(catalog.album("de", "2"))
    assert len(sent) == 2


@pytest.mark.parametrize("header, low, high", [(None, 55, 60), ("5", 55, 60), ("Wed, 21 Oct 2026 07:28:00 GMT", 55, 60), ("99999", 895, 900)])
def test_the_pause_has_sensible_bounds(header, low, high):
    catalog = Catalog()
    catalog._pause(header)
    assert low <= catalog._paused_until - time.monotonic() <= high


def artist_pages(total: int):
    """Apple's answers for an artist with `total` albums, 100 to a page."""
    def handler(request):
        if not request.url.path.endswith("/albums"):
            return httpx.Response(200, json={"data": [{"id": "9", "attributes": {"name": "Somebody"}}]})
        offset = int(request.url.params.get("offset", 0))
        ids = range(offset, min(offset + 100, total))
        page = {"data": [{"id": str(i), "attributes": {"name": f"Album {i}", "releaseDate": "2020-01-01"}} for i in ids]}
        if offset + 100 < total:
            page["next"] = "more"
        return httpx.Response(200, json=page)
    return handler


@pytest.mark.parametrize("total, shown, more", [(128, 128, False), (300, 300, False), (301, 300, True), (1000, 300, True)])
def test_an_artists_albums_stop_at_the_limit_and_say_so(total, shown, more):
    assert catalog_module.ARTIST_ALBUMS == 300
    artist = asyncio.run(catalog_answering(artist_pages(total)).artist_albums("de", "9"))
    assert (len(artist["albums"]), artist["more"]) == (shown, more)


def album_answer(*tracks: tuple[list[str], str]) -> dict:
    songs = [
        {"type": "songs", "id": str(n), "attributes": {"audioTraits": traits, "extendedAssetUrls": {"enhancedHls": url} if url else {}}}
        for n, (traits, url) in enumerate(tracks)
    ]
    best = sorted({t for traits, _ in tracks for t in traits})
    return {"data": [{"id": "1", "attributes": {"audioTraits": best}, "relationships": {"tracks": {"data": songs}}}]}


PLAYLIST = "audio-alac-stereo-48000-24\naudio-alac-stereo-192000-24\naudio-atmos-2768\naudio-alac-stereo-48000-24"


def quality_of(tracks: list[tuple[list[str], str]], playlist: str = PLAYLIST, status: int = 200):
    """What album_quality says, and which addresses were asked for it."""
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.host + request.url.path)
        if request.url.host == "amp-api.music.apple.com":
            return httpx.Response(200, json=album_answer(*tracks))
        assert request.url.host.endswith(".apple.com") and request.url.scheme == "https"
        return httpx.Response(status, text=playlist)

    catalog = catalog_answering(handler)
    asyncio.run(catalog.album("de", "1"))
    return asyncio.run(catalog.album_quality("de", "1")), asked


HIRES, LOSSLESS = ["lossless", "hi-res-lossless"], ["lossless"]
APPLE = "https://aod.itunes.apple.com"


def test_a_lossless_albums_quality_is_read_exactly():
    quality, asked = quality_of([(LOSSLESS, f"{APPLE}/a.m3u8")], "audio-alac-stereo-44100-16\naudio-alac-stereo-44100-24")
    assert quality == {"sample_rate": 44100, "bit_depth": 24, "rate": "exact"}
    # One catalogue request for the album and its quality, and one download.
    assert asked == ["amp-api.music.apple.com/v1/catalog/de/albums/1", "aod.itunes.apple.com/a.m3u8"]


def test_a_hires_album_is_at_least_the_hires_rate_its_public_playlist_names():
    # The song asked about is one with the album's best trait, not the bonus track.
    tracks = [(LOSSLESS, f"{APPLE}/bonus.m3u8"), (HIRES, f"{APPLE}/hires.m3u8")]
    quality, asked = quality_of(tracks, "audio-alac-stereo-48000-24\naudio-alac-stereo-96000-24")
    assert quality == {"sample_rate": 96000, "bit_depth": 24, "rate": "at_least"}
    assert asked[-1] == "aod.itunes.apple.com/hires.m3u8"


def test_the_highest_rate_apple_offers_is_exact():
    quality, _ = quality_of([(HIRES, f"{APPLE}/hires.m3u8")])
    assert quality == {"sample_rate": 192000, "bit_depth": 24, "rate": "exact"}


@pytest.mark.parametrize(
    "url, playlist, status",
    [
        (f"{APPLE}/a.m3u8", "audio-alac-stereo-48000-24", 200),  # the public playlist leaves the hi-res versions out
        (f"{APPLE}/a.m3u8", PLAYLIST, 503),
        ("", PLAYLIST, 200),
    ],
)
def test_a_hires_album_is_never_reported_below_what_its_tag_guarantees(url, playlist, status):
    quality, _ = quality_of([(HIRES, url)], playlist, status)
    assert quality == {"sample_rate": 48000, "bit_depth": 24, "rate": "above"}


@pytest.mark.parametrize(
    "url, playlist, status",
    [
        ("", PLAYLIST, 200),  # Apple names no playlist
        ("https://example.com/x.m3u8", PLAYLIST, 200),  # not Apple's server: not fetched
        ("http://aod.itunes.apple.com/x.m3u8", PLAYLIST, 200),
        (f"{APPLE}/x.m3u8", "audio-atmos-2768", 200),  # no lossless variant
        (f"{APPLE}/x.m3u8", PLAYLIST, 503),
    ],
)
def test_a_lossless_albums_quality_is_unknown_rather_than_wrong(url, playlist, status):
    quality, asked = quality_of([(LOSSLESS, url)], playlist, status)
    assert quality is None
    assert all(a.startswith(("amp-api.music.apple.com", "aod.itunes.apple.com")) for a in asked)

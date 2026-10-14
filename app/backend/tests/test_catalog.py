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


def release(id: str, name: str, **attrs) -> dict:
    return {"id": id, "attributes": {"name": name, "releaseDate": "2020-01-01", **attrs}}


def grouped_artist(views: dict, releases: list[dict], failing_view: str = ""):
    """Apple's answers for an artist whose grouping is `views` (view name ->
    list of releases, sent five at a time) and whose full list is `releases`."""
    asked: list[str] = []

    def page(items: list[dict], offset: int, size: int, view: str) -> dict:
        answer = {"data": items[offset:offset + size]}
        if offset + size < len(items):
            answer["next"] = f"/v1/catalog/de/artists/9/view/{view}?offset={offset + size}"
        return answer

    def handler(request):
        path = request.url.path
        asked.append(path)
        if path.endswith("/albums"):
            if request.url.params.get("sort") == "-releaseDate":
                newest = sorted(releases, key=lambda r: r["attributes"]["releaseDate"], reverse=True)
                return httpx.Response(200, json=page(newest, int(request.url.params["offset"]), 100, "all"))
            return httpx.Response(200, json={"data": releases})
        if "/view/" in path:
            view = path.rsplit("/", 1)[1]
            if view == failing_view:
                return httpx.Response(500)
            return httpx.Response(200, json=page(views[view], int(request.url.params["offset"]), 100, view))
        assert request.url.params["views"] == ",".join(catalog_module.GROUPS)
        first = {view: page(items, 0, 5, view) for view, items in views.items()}
        return httpx.Response(200, json={"data": [{"id": "9", "attributes": {"name": "Somebody"}, "views": first}]})

    return handler, asked


def test_releases_are_grouped_as_apple_groups_them_and_none_is_hidden():
    radio_edit = release("1", "Kill Me - Single", isSingle=True)
    full_version = release("2", "Kill Me - Single", isSingle=True, recordLabel="BEAT Music Fund")
    two_songs = release("3", "Ready To Roll - Single")
    mix = release("4", "Supremacy (DJ Mix)")
    album = release("5", "Through My Veins")
    guest = release("6", "LET IT RAIN (feat. Dsturb) - Single", isSingle=True)
    unknown_ep = release("7", "Merge - EP")
    views = {"full-albums": [album], "singles": [radio_edit, two_songs], "compilation-albums": [mix], "appears-on-albums": [guest]}
    handler, _ = grouped_artist(views, [radio_edit, full_version, two_songs, mix, album, guest, unknown_ep])
    albums = asyncio.run(catalog_answering(handler).artist_albums("de", "9"))["albums"]
    got = {a["id"]: (a["group"], a["other_release"]) for a in albums}
    assert got == {
        "1": ("singles", False),
        "2": ("singles", True),  # left out by Apple's grouping, still listed
        "3": ("singles", False),
        "4": ("compilations", False),
        "5": ("albums", False),
        "6": ("appears_on", False),
        "7": ("singles", False),  # not grouped by Apple: sorted by its title
    }
    assert next(a for a in albums if a["id"] == "2")["label"] == "BEAT Music Fund"
    assert [a["id"] for a in albums if not a["grouped"]] == ["2", "7"]


def test_a_release_outside_apples_grouping_joins_the_group_of_its_namesake():
    live = release("1", "Live at Somewhere")
    copy = release("2", "Live at Somewhere")
    handler, _ = grouped_artist({"live-albums": [live]}, [live, copy])
    albums = asyncio.run(catalog_answering(handler).artist_albums("de", "9"))["albums"]
    assert {a["id"]: (a["group"], a["other_release"]) for a in albums} == {"1": ("live", False), "2": ("live", True)}


def test_an_artist_comes_with_a_shelf_per_group_in_apples_order():
    singles = [release(str(i), f"Song {i} - Single") for i in range(12)]
    album = release("50", "Album")
    handler, asked = grouped_artist({"singles": singles, "full-albums": [album], "live-albums": []}, [])
    artist = asyncio.run(catalog_answering(handler).artist("de", "9"))
    assert [(s["group"], len(s["items"]), s["more"]) for s in artist["shelves"]] == [("albums", 1, False), ("singles", 5, True)]
    assert artist["name"] == "Somebody" and len(asked) == 1


def test_a_group_is_read_page_by_page():
    singles = [release(str(i), f"Song {i} - Single") for i in range(130)]
    handler, _ = grouped_artist({"singles": singles}, [])
    catalog = catalog_answering(handler)
    first = asyncio.run(catalog.artist_group("de", "9", "singles"))
    assert (len(first["items"]), first["next"]) == (100, 100)
    rest = asyncio.run(catalog.artist_group("de", "9", "singles", first["next"]))
    assert (len(rest["items"]), rest["next"]) == (30, None)


def test_a_long_group_is_fetched_page_by_page():
    singles = [release(str(i), f"Song {i} - Single") for i in range(130)]
    handler, asked = grouped_artist({"singles": singles}, singles)
    albums = asyncio.run(catalog_answering(handler).artist_albums("de", "9"))["albums"]
    assert {a["group"] for a in albums} == {"singles"} and not any(a["other_release"] for a in albums)
    assert asked.count("/v1/catalog/de/artists/9/view/singles") == 2  # 5 with the artist, then 100 and 25


def test_without_apples_grouping_releases_are_sorted_by_title():
    album = release("1", "Ready To Roll - Single")
    others = [release(str(i), f"Album {i}") for i in range(2, 9)]
    handler, _ = grouped_artist({"full-albums": others}, [album, *others], failing_view="full-albums")
    albums = asyncio.run(catalog_answering(handler).artist_albums("de", "9"))["albums"]
    got = {a["id"]: a["group"] for a in albums}
    assert got["1"] == "singles" and set(got.values()) == {"singles", "albums"}
    # The two Apple sent with the artist before the failing page are not other releases.
    assert not any(a["other_release"] for a in albums)


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
    assert quality == {"bit_depth": 24, "sample_rate_min": 44100, "sample_rate_max": 44100}
    # One catalogue request for the album and its quality, and one download.
    assert asked == ["amp-api.music.apple.com/v1/catalog/de/albums/1", "aod.itunes.apple.com/a.m3u8"]


def test_a_hires_albums_rate_starts_at_the_hires_rate_its_public_playlist_names():
    # The song asked about is one with the album's best trait, not the bonus track.
    tracks = [(LOSSLESS, f"{APPLE}/bonus.m3u8"), (HIRES, f"{APPLE}/hires.m3u8")]
    quality, asked = quality_of(tracks, "audio-alac-stereo-48000-24\naudio-alac-stereo-96000-24")
    assert quality == {"bit_depth": 24, "sample_rate_min": 96000, "sample_rate_max": 192000}
    assert asked[-1] == "aod.itunes.apple.com/hires.m3u8"


def test_the_highest_rate_apple_offers_is_no_range():
    quality, _ = quality_of([(HIRES, f"{APPLE}/hires.m3u8")])
    assert quality == {"bit_depth": 24, "sample_rate_min": 192000, "sample_rate_max": 192000}


@pytest.mark.parametrize(
    "url, playlist, status",
    [
        (f"{APPLE}/a.m3u8", "audio-alac-stereo-48000-24", 200),  # the public playlist leaves the hi-res versions out
        (f"{APPLE}/a.m3u8", PLAYLIST, 503),
        ("", PLAYLIST, 200),
    ],
)
def test_a_hires_album_of_unknown_rate_spans_all_hires_rates(url, playlist, status):
    quality, _ = quality_of([(HIRES, url)], playlist, status)
    assert quality == {"bit_depth": 24, "sample_rate_min": 88200, "sample_rate_max": 192000}


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


def test_all_releases_come_newest_first_page_by_page():
    releases = [release(str(i), f"Release {i}", releaseDate=f"{2000 + i % 30}-01-01") for i in range(150)]
    handler, _ = grouped_artist({}, releases)
    catalog = catalog_answering(handler)
    first = asyncio.run(catalog.artist_group("de", "9", "all"))
    rest = asyncio.run(catalog.artist_group("de", "9", "all", first["next"]))
    assert (len(first["items"]), first["next"], len(rest["items"]), rest["next"]) == (100, 100, 50, None)
    dates = [a["release_date"] for a in first["items"] + rest["items"]]
    assert dates == sorted(dates, reverse=True)

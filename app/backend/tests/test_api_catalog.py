"""The catalogue routes with their memory, against a stand-in for Apple."""
import pytest
from fastapi.testclient import TestClient

from calavera import api
from calavera.catalog import Catalog, CatalogError
from calavera.config import Config


@pytest.fixture
def apple(monkeypatch):
    """Counts what is asked of Apple; set `down` to make it unreachable."""
    state = {"asked": 0, "down": False}

    async def artist(self, storefront, artist_id, language=""):
        state["asked"] += 1
        if state["down"]:
            raise CatalogError("Apple Music asked for a pause.")
        album = {"id": "1", "name": "Album", "artist": "Artist", "artists": [], "single": False, "release_date": "2020"}
        shelf = {"group": "albums", "items": [album], "more": False}
        return {"id": artist_id, "name": "Artist", "artwork": "", "url": "", "shelves": [shelf]}

    async def artist_albums(self, storefront, artist_id, language=""):
        state["asked"] += 1
        grouped = {"id": "1", "name": "Album", "artist": "Artist", "grouped": True}
        other = {"id": "2", "name": "Album", "artist": "Artist", "grouped": False, "group": "albums", "other_release": True}
        return {"id": artist_id, "name": "Artist", "albums": [grouped, other], "more": False}

    monkeypatch.setattr(Catalog, "artist", artist)
    monkeypatch.setattr(Catalog, "artist_albums", artist_albums)
    return state


@pytest.fixture
def client(tmp_path):
    for name in ("data", "staging", "library/Someone"):
        (tmp_path / name).mkdir(parents=True)
    config = Config(
        data_dir=tmp_path / "data", staging_dir=tmp_path / "staging", library_dir=tmp_path / "library",
        static_dir=tmp_path / "none", wrapper_url="http://127.0.0.1:9", supervisor_url="http://127.0.0.1:9",
        control_token_file=tmp_path / "token", amdl_bin="amdl", ffmpeg_bin="ffmpeg",
    )
    client = TestClient(api.create_app(config))
    assert client.put("/api/settings", json={"storefront": "de"}).status_code == 200
    return client, tmp_path / "library"


def test_an_artist_page_is_asked_of_apple_once_and_again_when_fresh(apple, client):
    http, _ = client
    first = http.get("/api/catalog/artists/7").json()
    assert first["stale_since"] is None and apple["asked"] == 1
    assert http.get("/api/catalog/artists/7").json() == first and apple["asked"] == 1
    http.get("/api/catalog/artists/7?fresh=1")
    assert apple["asked"] == 2


def test_in_library_is_worked_out_anew_for_a_remembered_answer(apple, client):
    http, library = client
    assert http.get("/api/catalog/artists/7").json()["shelves"][0]["items"][0]["in_library"] is None
    (library / "Artist" / "Album").mkdir(parents=True)
    assert http.get("/api/catalog/artists/7").json()["shelves"][0]["items"][0]["in_library"] == "Artist/Album"
    assert apple["asked"] == 1


def test_when_apple_cannot_be_reached_the_old_answer_comes_with_its_time(apple, client):
    http, _ = client
    http.get("/api/catalog/artists/7")
    apple["down"] = True
    again = http.get("/api/catalog/artists/7?fresh=1")
    assert again.status_code == 200 and again.json()["stale_since"] > 0 and again.json()["name"] == "Artist"
    # Nothing remembered for this one: the error is shown.
    other = http.get("/api/catalog/artists/8")
    assert other.status_code == 502 and "pause" in other.json()["error"]


def test_others_are_only_the_releases_outside_apples_grouping(apple, client):
    http, _ = client
    answer = http.get("/api/catalog/artists/7/others").json()
    assert [a["id"] for a in answer["items"]] == ["2"] and answer["more"] is False


def test_an_unknown_group_is_not_asked_of_apple(apple, client):
    http, _ = client
    assert http.get("/api/catalog/artists/7/groups/bootlegs").status_code == 404
    assert http.get("/api/catalog/artists/7/groups/all?offset=20000").status_code == 404
    assert http.get("/api/catalog/artists/7/groups/singles?offset=-1").status_code == 404
    assert apple["asked"] == 0

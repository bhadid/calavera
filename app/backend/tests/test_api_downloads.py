"""Downloads to the user's device: a ready job's file, ZIP and file list."""
import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from calavera import api
from calavera.config import Config
from calavera.db import Database
from calavera.jobs import expired

TRACK = b"fLaC" + bytes(range(256)) * 40


def job(job_id, status="ready", **extra):
    return {
        "id": job_id, "url": "https://music.apple.com/de/album/x/1", "kind": "album", "storefront": "de",
        "apple_id": "1", "status": status, "options": {"destination": "device"}, "created_at": time.time(),
        "finished_at": time.time(), "title": "The Album", **extra,
    }


@pytest.fixture
def setup(tmp_path):
    for name in ("data", "staging", "library"):
        (tmp_path / name).mkdir()
    db = Database(tmp_path / "data" / "calavera.db")
    for j in (job("album"), job("song", kind="song"), job("gone"), job("busy", status="running")):
        db.insert_job(j)
    db.close()
    album = tmp_path / "staging" / "album" / "music" / "The Artist" / "The Album"
    album.mkdir(parents=True)
    (album / "01 First.flac").write_bytes(TRACK)
    (album / "02 Second.flac").write_bytes(TRACK[::-1])
    (album / "cover.jpg").write_bytes(b"jpeg")
    song = tmp_path / "staging" / "song" / "music" / "The Artist" / "Single"
    song.mkdir(parents=True)
    (song / "01 Only Song.flac").write_bytes(TRACK)
    config = Config(
        data_dir=tmp_path / "data", staging_dir=tmp_path / "staging", library_dir=tmp_path / "library",
        static_dir=tmp_path / "none", wrapper_url="http://127.0.0.1:9", supervisor_url="http://127.0.0.1:9",
        control_token_file=tmp_path / "token", amdl_bin="amdl", ffmpeg_bin="ffmpeg",
    )
    return TestClient(api.create_app(config), base_url="http://localhost")


def test_an_album_comes_as_a_zip(setup):
    r = setup.get("/api/jobs/album/download")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert "filename*=UTF-8''The%20Artist%20-%20The%20Album.zip" in r.headers["content-disposition"]
    assert int(r.headers["content-length"]) == len(r.content)
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert z.namelist() == [
            "The Artist - The Album/01 First.flac", "The Artist - The Album/02 Second.flac",
            "The Artist - The Album/cover.jpg",
        ]
        assert z.read("The Artist - The Album/01 First.flac") == TRACK


def test_a_single_track_comes_as_the_file(setup):
    r = setup.get("/api/jobs/song/download")
    assert r.status_code == 200
    assert r.content == TRACK
    assert r.headers["content-type"] == "audio/flac"
    assert "filename*=UTF-8''The%20Artist%20-%20Only%20Song.flac" in r.headers["content-disposition"]
    part = setup.get("/api/jobs/song/download", headers={"range": "bytes=4-9"})
    assert part.status_code == 206
    assert part.content == TRACK[4:10]


def test_files_one_by_one(setup):
    files = setup.get("/api/jobs/album/files").json()["files"]
    assert [(f["index"], f["name"], f["size"]) for f in files] == [
        (0, "The Artist - The Album/01 First.flac", len(TRACK)),
        (1, "The Artist - The Album/02 Second.flac", len(TRACK)),
        (2, "The Artist - The Album/cover.jpg", 4),
    ]
    r = setup.get("/api/jobs/album/files/1")
    assert r.content == TRACK[::-1]
    assert "filename*=UTF-8''02%20Second.flac" in r.headers["content-disposition"]
    resumed = setup.get("/api/jobs/album/files/1", headers={"range": "bytes=100-"})
    assert resumed.status_code == 206 and resumed.content == TRACK[::-1][100:]
    assert setup.get("/api/jobs/album/files/3").status_code == 404
    assert setup.get("/api/jobs/album/files/-1").status_code == 404
    assert setup.get("/api/jobs/album/files/..%2F..%2Fdata").status_code in (404, 422)


def test_what_cannot_be_downloaded(setup):
    assert setup.get("/api/jobs/nope/download").status_code == 404
    assert setup.get("/api/jobs/busy/download").status_code == 409
    gone = setup.get("/api/jobs/gone/download")
    assert gone.status_code == 410
    assert "Retry" in gone.json()["error"]


def test_expired_picks_ready_jobs_kept_too_long():
    now = 1_000_000.0
    jobs = [
        {"id": "old", "status": "ready", "finished_at": now - 25 * 3600},
        {"id": "edge", "status": "ready", "finished_at": now - 24 * 3600},
        {"id": "fresh", "status": "ready", "finished_at": now - 3600},
        {"id": "done", "status": "done", "finished_at": now - 100 * 3600},
        {"id": "unfinished", "status": "ready", "finished_at": None},
    ]
    assert expired(jobs, now, 24) == ["old", "edge"]

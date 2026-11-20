"""Job messages and the log across retries."""
import time

from fastapi.testclient import TestClient

from calavera import api
from calavera.config import Config
from calavera.db import Database
from calavera.jobs import failure_reason

KEY_FAILURE = 'Failed to run v4: lite-server /key returned 500 Internal Server Error: {"error":"Invalid CKC error."}'


def test_no_failure_lines_give_no_reason():
    assert failure_reason([]) == ""


def test_the_first_failure_is_the_reason():
    reason = failure_reason(["Failed to rip album: no tracks.", "Failed to rip song: other"])
    assert reason == "amdl: Failed to rip album: no tracks."


def test_a_refused_key_points_to_signing_in_again():
    reason = failure_reason([KEY_FAILURE])
    assert reason.startswith("amdl: Failed to run v4: lite-server /key returned 500")
    assert "sign in again on Account" in reason


def test_a_long_reason_is_cut():
    assert len(failure_reason(["Failed to rip song: " + "x" * 1000])) < 320


def test_retry_keeps_the_log_of_the_earlier_run(tmp_path):
    for name in ("data", "staging", "library"):
        (tmp_path / name).mkdir()
    db = Database(tmp_path / "data" / "calavera.db")
    db.insert_job({
        "id": "song", "url": "https://music.apple.com/de/song/1", "kind": "song", "storefront": "de",
        "apple_id": "1", "status": "failed", "options": {"merge": True}, "created_at": time.time(),
        "finished_at": time.time(), "error": "0 of 1 tracks downloaded, 1 failed.",
    })
    db.append_log("song", KEY_FAILURE)
    db.close()
    config = Config(
        data_dir=tmp_path / "data", staging_dir=tmp_path / "staging", library_dir=tmp_path / "library",
        static_dir=tmp_path / "none", wrapper_url="http://127.0.0.1:9", supervisor_url="http://127.0.0.1:9",
        control_token_file=tmp_path / "token", amdl_bin="amdl", ffmpeg_bin="ffmpeg",
    )
    # Without `with`, the worker does not start: the job stays queued.
    client = TestClient(api.create_app(config), base_url="http://localhost")
    assert client.post("/api/jobs/song/retry").status_code < 300
    r = client.get("/api/jobs/song").json()
    assert r["job"]["status"] == "queued"
    assert r["job"]["error"] == ""
    lines = [entry["line"] for entry in r["log"]]
    assert lines[0] == KEY_FAILURE
    assert lines[1].startswith("── Retried, ") and lines[1].endswith("Earlier runs are above. ──")

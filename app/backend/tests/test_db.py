import sqlite3
import time

from calavera.db import Database


def job(job_id: str, **extra):
    return {
        "id": job_id, "url": "https://music.apple.com/de/album/x/1", "kind": "album", "storefront": "de",
        "apple_id": "1", "status": "queued", "options": {}, "created_at": time.time(), **extra,
    }


def test_artists_are_stored_with_a_job(tmp_path):
    db = Database(tmp_path / "calavera.db")
    db.insert_job(job("a"))
    assert db.get_job("a")["artists"] == []
    db.update_job("a", artist="A & B", artists=[{"id": "10", "name": "A"}, {"id": "11", "name": "B"}])
    assert db.get_job("a")["artists"] == [{"id": "10", "name": "A"}, {"id": "11", "name": "B"}]
    db.close()


def test_a_database_from_before_the_artists_column_is_upgraded(tmp_path):
    path = tmp_path / "calavera.db"
    db = Database(path)
    db.insert_job(job("old", title="Album", artist="Somebody"))
    db.close()
    conn = sqlite3.connect(path)
    conn.execute("ALTER TABLE jobs DROP COLUMN artists")
    conn.commit()
    conn.close()

    db = Database(path)
    old = db.get_job("old")
    assert (old["title"], old["artist"], old["artists"]) == ("Album", "Somebody", [])
    db.insert_job(job("new", artists=[{"id": "10", "name": "A"}]))
    assert {j["id"]: j["artists"] for j in db.list_jobs()} == {"old": [], "new": [{"id": "10", "name": "A"}]}
    db.close()


def test_cover_colours_are_stored_with_a_job_and_added_to_old_databases(tmp_path):
    path = tmp_path / "calavera.db"
    db = Database(path)
    db.insert_job(job("old"))
    db.close()
    conn = sqlite3.connect(path)
    conn.execute("ALTER TABLE jobs DROP COLUMN artwork_colors")
    conn.commit()
    conn.close()

    db = Database(path)
    assert db.get_job("old")["artwork_colors"] is None
    colors = {"bg": "#000000", "text": ["#ffffff"] * 4}
    db.update_job("old", artwork_colors=colors)
    assert db.get_job("old")["artwork_colors"] == colors
    db.close()

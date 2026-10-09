"""SQLite persistence: jobs, their log lines, and the settings document.

One connection guarded by a lock. Every call is a short, local operation, so
it is safe to call from the event loop without a thread hop.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    kind        TEXT NOT NULL,
    storefront  TEXT NOT NULL,
    apple_id    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    artist      TEXT NOT NULL DEFAULT '',
    artists     TEXT NOT NULL DEFAULT '[]',
    artwork_url TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    stage       TEXT NOT NULL DEFAULT '',
    progress    REAL NOT NULL DEFAULT 0,
    detail      TEXT NOT NULL DEFAULT '',
    error       TEXT NOT NULL DEFAULT '',
    result      TEXT NOT NULL DEFAULT '[]',
    options     TEXT NOT NULL DEFAULT '{}',
    created_at  REAL NOT NULL,
    started_at  REAL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS jobs_created ON jobs (created_at);
CREATE TABLE IF NOT EXISTS job_logs (
    job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    seq    INTEGER NOT NULL,
    ts     REAL NOT NULL,
    line   TEXT NOT NULL,
    PRIMARY KEY (job_id, seq)
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_JSON_COLUMNS = ("result", "options", "artists")


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(SCHEMA)
            # Columns added since the first release, for databases made before.
            columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(jobs)")}
            if "artists" not in columns:
                self._conn.execute("ALTER TABLE jobs ADD COLUMN artists TEXT NOT NULL DEFAULT '[]'")

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- jobs ------------------------------------------------------------------
    @staticmethod
    def _job(row: sqlite3.Row) -> dict[str, Any]:
        job = dict(row)
        for col in _JSON_COLUMNS:
            job[col] = json.loads(job[col])
        return job

    def insert_job(self, job: dict[str, Any]) -> None:
        row = {**job, **{c: json.dumps(job[c]) for c in _JSON_COLUMNS if c in job}}
        cols = ", ".join(row)
        marks = ", ".join(f":{c}" for c in row)
        with self._lock:
            self._conn.execute(f"INSERT INTO jobs ({cols}) VALUES ({marks})", row)

    def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        for col in _JSON_COLUMNS:
            if col in fields:
                fields[col] = json.dumps(fields[col])
        sets = ", ".join(f"{c} = :{c}" for c in fields)
        with self._lock:
            self._conn.execute(f"UPDATE jobs SET {sets} WHERE id = :id", {**fields, "id": job_id})

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._job(row) if row else None

    def list_jobs(self, statuses: Iterable[str] | None = None) -> list[dict[str, Any]]:
        sql, args = "SELECT * FROM jobs", []
        if statuses is not None:
            args = list(statuses)
            sql += f" WHERE status IN ({', '.join('?' * len(args))})"
        with self._lock:
            rows = self._conn.execute(sql + " ORDER BY created_at DESC", args).fetchall()
        return [self._job(r) for r in rows]

    def delete_job(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))

    # -- logs ------------------------------------------------------------------
    def append_log(self, job_id: str, line: str, keep: int = 1000) -> None:
        with self._lock:
            seq = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM job_logs WHERE job_id = ?", (job_id,)
            ).fetchone()[0]
            self._conn.execute(
                "INSERT INTO job_logs (job_id, seq, ts, line) VALUES (?, ?, ?, ?)",
                (job_id, seq, time.time(), line),
            )
            if seq % 100 == 0:
                self._conn.execute("DELETE FROM job_logs WHERE job_id = ? AND seq <= ?", (job_id, seq - keep))

    def get_logs(self, job_id: str) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT seq, ts, line FROM job_logs WHERE job_id = ? ORDER BY seq", (job_id,)
            ).fetchall()
        return [dict(r) for r in rows]

    def clear_logs(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM job_logs WHERE job_id = ?", (job_id,))

    # -- key/value ---------------------------------------------------------------
    def get_kv(self, key: str) -> Any | None:
        with self._lock:
            row = self._conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def set_kv(self, key: str, value: Any) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

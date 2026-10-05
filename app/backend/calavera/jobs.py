"""The download queue and the pipeline each job runs through.

One job runs at a time:

    download (amdl)  ->  verify  ->  convert to FLAC  ->  import into the library

Each stage is a method on `JobManager`; to add a stage (say, a media-server
scan after import), add a method and call it from `_run`.

Job statuses
    queued       waiting for its turn
    running      in the pipeline (see `stage`)
    done         every album of the job is in the library
    skipped      the library already had it; nothing was changed
    failed       something went wrong (see `error`); files may remain in staging
    canceled     stopped by the user
    interrupted  Calavera restarted while the job was running

Staging: each job owns `<staging>/<job id>/`. It is deleted when the job ends
`done`, and kept otherwise so the files can be inspected, until the job is
retried or removed.
"""
from __future__ import annotations

import asyncio
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from . import amdl, audio, library, urls
from .catalog import Catalog, CatalogError
from .config import Config
from .db import Database
from .settings import Settings
from .wrapper import WrapperClient

ACTIVE = ("queued", "running")
MIN_FREE_BYTES = 1 << 30  # refuse to start a download with less than 1 GiB free in staging


class JobError(Exception):
    """A pipeline failure with a message meant for the user."""


class Canceled(Exception):
    pass


class _Finished(Exception):
    """Raised by a stage that has already put the job into its final state."""


class JobManager:
    def __init__(
        self,
        config: Config,
        db: Database,
        catalog: Catalog,
        wrapper: WrapperClient,
        get_settings: Callable[[], Settings],
    ) -> None:
        self._config = config
        self._db = db
        self._catalog = catalog
        self._wrapper = wrapper
        self._get_settings = get_settings
        self._subscribers: set[asyncio.Queue] = set()
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._current: str | None = None
        self._runner: amdl.Runner | None = None
        self._cancel_requested = False
        self._last_publish = 0.0

    # -- lifecycle -------------------------------------------------------------
    def start(self) -> None:
        for job in self._db.list_jobs(["running"]):
            self._db.update_job(
                job["id"], status="interrupted", stage="", finished_at=time.time(),
                error="Calavera was restarted while this job was running. Retry to run it again.",
            )
        self._task = asyncio.create_task(self._worker(), name="job-worker")

    async def stop(self) -> None:
        if self._runner:
            self._runner.cancel()
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    # -- events ----------------------------------------------------------------
    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def _publish(self, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A client that stopped reading: drop it, its stream ends and
                # the browser reconnects and reloads the job list.
                self._subscribers.discard(queue)

    def _update(self, job_id: str, *, throttle: bool = False, **fields: Any) -> None:
        self._db.update_job(job_id, **fields)
        now = time.monotonic()
        if throttle and now - self._last_publish < 0.3:
            return
        self._last_publish = now
        job = self.get(job_id)
        if job:
            self._publish({"type": "job", "job": job})

    def _log(self, job_id: str, line: str) -> None:
        self._db.append_log(job_id, line)
        self._publish({"type": "log", "id": job_id, "line": line, "ts": time.time()})

    # -- queries -----------------------------------------------------------------
    def _view(self, job: dict[str, Any]) -> dict[str, Any]:
        """A job as the API presents it."""
        job["has_files"] = self.staging_dir(job["id"]).exists()
        return job

    def list(self) -> list[dict[str, Any]]:
        return [self._view(j) for j in self._db.list_jobs()]

    def get(self, job_id: str) -> dict[str, Any] | None:
        job = self._db.get_job(job_id)
        return self._view(job) if job else None

    def logs(self, job_id: str) -> list[dict[str, Any]]:
        return self._db.get_logs(job_id)

    def staging_dir(self, job_id: str) -> Path:
        return self._config.staging_dir / job_id

    # -- commands ----------------------------------------------------------------
    def enqueue(self, raw_url: str) -> dict[str, Any]:
        """Add a job. Raises urls.UnsupportedUrl or JobError (duplicate)."""
        parsed = urls.parse(raw_url)
        for job in self._db.list_jobs(ACTIVE):
            if (job["kind"], job["apple_id"]) == (parsed.kind, parsed.apple_id):
                raise JobError("That link is already in the queue.")
        job = {
            "id": uuid.uuid4().hex[:12],
            "url": parsed.url,
            "kind": parsed.kind,
            "storefront": parsed.storefront,
            "apple_id": parsed.apple_id,
            "status": "queued",
            "created_at": time.time(),
        }
        self._db.insert_job(job)
        stored = self.get(job["id"])
        assert stored is not None
        self._publish({"type": "job", "job": stored})
        asyncio.create_task(self._describe(stored), name=f"describe-{job['id']}")
        self._wake.set()
        return stored

    async def _describe(self, job: dict[str, Any]) -> None:
        """Fill in title, artist and artwork from the catalogue (best effort)."""
        language = self._get_settings().language
        try:
            if job["kind"] == "album":
                item = await self._catalog.album(job["storefront"], job["apple_id"], language)
                fields = {"title": item["name"], "artist": item["artist"], "artwork_url": item["artwork"]}
            else:
                item = await self._catalog.song(job["storefront"], job["apple_id"], language)
                fields = {"title": item["name"], "artist": item["artist"], "artwork_url": item["artwork"]}
        except CatalogError:
            return
        if self._db.get_job(job["id"]):
            self._update(job["id"], **fields)

    def cancel(self, job_id: str) -> None:
        job = self._db.get_job(job_id)
        if not job:
            return
        if job["status"] == "queued":
            self._update(job_id, status="canceled", finished_at=time.time())
        elif job["status"] == "running" and self._current == job_id:
            self._cancel_requested = True
            if self._runner:
                self._runner.cancel()

    def retry(self, job_id: str) -> None:
        job = self._db.get_job(job_id)
        if not job or job["status"] in ACTIVE:
            raise JobError("Only a finished job can be retried.")
        self.discard_files(job_id)
        self._db.clear_logs(job_id)
        self._update(
            job_id, status="queued", stage="", progress=0, detail="", error="", result=[],
            started_at=None, finished_at=None,
        )
        self._wake.set()

    def remove(self, job_id: str) -> None:
        job = self._db.get_job(job_id)
        if not job:
            return
        if job["status"] == "running":
            raise JobError("Cancel the job before removing it.")
        self.discard_files(job_id)
        self._db.delete_job(job_id)
        self._publish({"type": "removed", "id": job_id})

    def discard_files(self, job_id: str) -> None:
        """Delete a job's staging folder. Never touches the library."""
        if job_id == self._current:
            raise JobError("The job is still running.")
        shutil.rmtree(self.staging_dir(job_id), ignore_errors=True)
        if self._db.get_job(job_id):
            self._update(job_id)

    # -- worker ------------------------------------------------------------------
    async def _worker(self) -> None:
        while True:
            queued = self._db.list_jobs(["queued"])
            if not queued:
                self._wake.clear()
                await self._wake.wait()
                continue
            job = queued[-1]  # list is newest first; run the oldest
            self._current, self._cancel_requested = job["id"], False
            try:
                await self._run(job)
            except _Finished:
                pass
            except Canceled:
                shutil.rmtree(self.staging_dir(job["id"]), ignore_errors=True)
                self._log(job["id"], "Canceled.")
                self._finish(job["id"], "canceled", error="", detail="")
            except JobError as e:
                self._log(job["id"], f"✖ {e}")
                self._finish(job["id"], "failed", error=str(e))
            except asyncio.CancelledError:
                raise
            except Exception as e:  # a bug: report it instead of killing the worker
                self._log(job["id"], f"✖ Unexpected error: {e!r}")
                self._finish(job["id"], "failed", error=f"Unexpected error: {e}")
            finally:
                self._current, self._runner = None, None

    def _finish(self, job_id: str, status: str, **fields: Any) -> None:
        fields.setdefault("stage", "")
        self._update(job_id, status=status, finished_at=time.time(), **fields)

    def _check_cancel(self) -> None:
        if self._cancel_requested:
            raise Canceled()

    async def _run(self, job: dict[str, Any]) -> None:
        job_id = job["id"]
        settings = self._get_settings()
        self._update(job_id, status="running", stage="preparing", started_at=time.time(), progress=0, error="")

        await self._preflight(job)
        job_dir = self.staging_dir(job_id)
        shutil.rmtree(job_dir, ignore_errors=True)
        music_dir = job_dir / "music"
        music_dir.mkdir(parents=True)

        await self._download(job, settings, job_dir, music_dir)
        albums = self._collect(music_dir)
        self._check_cancel()

        self._update(job_id, stage="verifying", detail="Checking the downloaded tracks")
        tracks = [t for _, _, d in albums for t in sorted(d.glob("*.m4a"))]
        infos = await asyncio.to_thread(lambda: [audio.check_finished(t, "alac") for t in tracks])
        quality = sorted({(i.bit_depth, i.sample_rate) for i in infos}, reverse=True)

        if settings.flac:
            await self._convert(job_id, tracks)
        await asyncio.to_thread(self._make_readable, music_dir)
        self._check_cancel()

        results = await self._import(job_id, albums, "flac" if settings.flac else "alac", quality)
        statuses = {r["status"] for r in results}
        if statuses == {"imported"}:
            shutil.rmtree(job_dir, ignore_errors=True)
            self._finish(job_id, "done", progress=1, detail="", result=results)
        elif statuses <= {"imported", "exists"}:
            self._finish(
                job_id, "skipped", progress=1, result=results,
                detail="Already in the library. The downloaded files are kept in staging until you discard them.",
            )
        else:
            failed = next(r for r in results if r["status"] == "failed")
            self._finish(job_id, "failed", result=results, error=failed["message"])

    # -- stages ------------------------------------------------------------------
    async def _preflight(self, job: dict[str, Any]) -> None:
        """Fail before downloading anything if the job cannot succeed."""
        if not await self._wrapper.regions():
            raise JobError("Not signed in to Apple Music, or the wrapper is not running. Open Account to sign in.")
        problem = await asyncio.to_thread(library.library_problem, self._config.library_dir)
        if problem:
            raise JobError(problem)
        self._config.staging_dir.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self._config.staging_dir).free < MIN_FREE_BYTES:
            raise JobError("Less than 1 GB is free in the staging folder.")
        # Skip the download entirely when the album is already there. That
        # needs the album's name, which the lookup started at enqueue time may
        # not have delivered yet.
        fresh = self._db.get_job(job["id"]) or job
        if not fresh["title"]:
            try:
                await asyncio.wait_for(self._describe(fresh), timeout=10)
            except asyncio.TimeoutError:
                pass
            fresh = self._db.get_job(job["id"]) or job
        if fresh["kind"] == "album" and fresh["artist"] and fresh["title"]:
            existing = await asyncio.to_thread(
                library.find_album, self._config.library_dir, fresh["artist"], fresh["title"]
            )
            if existing:
                self._log(job["id"], f"⏭ The library already has '{existing}'. Nothing was downloaded.")
                self._finish(
                    job["id"], "skipped", progress=1,
                    detail="Already in the library.",
                    result=[{"status": "exists", "path": existing, "message": "Already in the library."}],
                )
                raise _Finished()

    async def _download(self, job: dict[str, Any], settings: Settings, job_dir: Path, music_dir: Path) -> None:
        job_id = job["id"]
        self._update(job_id, stage="downloading", detail="Starting")
        config = amdl.build_config(settings, self._config.wrapper_url, job["storefront"], music_dir)
        self._runner = amdl.Runner(self._config.amdl_bin)

        def on_progress(p: amdl.Progress) -> None:
            detail = f"Track {p.track} of {p.total}" if p.total else "Starting"
            if p.quality:
                detail += f" · {p.quality}"
            # Downloading is 85% of the bar; conversion and import share the rest.
            self._update(job_id, throttle=True, progress=round(p.fraction * 0.85, 4), detail=detail)

        result = await self._runner.run(job["url"], job_dir, config, lambda line: self._log(job_id, line), on_progress)
        self._check_cancel()
        summary = result.progress.summary
        if summary is None:
            raise JobError(f"The downloader stopped without a result (exit code {result.exit_code}). See the log.")
        if not summary.clean or result.exit_code != 0:
            raise JobError(
                f"{summary.completed} of {summary.total} tracks downloaded, {summary.errors} failed. "
                "Nothing was imported. See the log for the reason."
            )

    @staticmethod
    def _collect(music_dir: Path) -> list[tuple[str, str, Path]]:
        """(artist folder, album folder, path) for every album amdl produced."""
        albums = [
            (artist.name, album.name, album)
            for artist in sorted(music_dir.iterdir()) if artist.is_dir()
            for album in sorted(artist.iterdir()) if album.is_dir() and any(album.glob("*.m4a"))
        ]
        if not albums:
            raise JobError("The downloader reported success but produced no tracks.")
        return albums

    async def _convert(self, job_id: str, tracks: list[Path]) -> None:
        noun = "track" if len(tracks) == 1 else "tracks"
        self._update(job_id, stage="converting", detail=f"Converting {len(tracks)} {noun} to FLAC")
        for n, track in enumerate(tracks, 1):
            self._check_cancel()
            try:
                await asyncio.to_thread(audio.convert_to_flac, self._config.ffmpeg_bin, track)
            except audio.AudioError as e:
                raise JobError(f"FLAC conversion failed: {e}") from e
            self._update(
                job_id, throttle=True, progress=round(0.85 + 0.1 * n / len(tracks), 4),
                detail=f"Converted {n} of {len(tracks)} {noun} to FLAC",
            )
        self._log(job_id, f"✔ Converted {len(tracks)} {noun} to FLAC; each one verified against its ALAC source.")

    @staticmethod
    def _make_readable(music_dir: Path) -> None:
        # amdl writes files readable by their owner only; a media server
        # running as another user could not play them.
        for path in music_dir.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)

    async def _import(
        self, job_id: str, albums: list[tuple[str, str, Path]], fmt: str, quality: list[tuple[int, int]]
    ) -> list[dict[str, Any]]:
        self._update(job_id, stage="importing", progress=0.95, detail="Copying to the library")
        results = []
        for artist, album, path in albums:
            self._check_cancel()
            outcome = await asyncio.to_thread(library.import_album, path, self._config.library_dir, artist, album)
            track_count = len([p for p in path.iterdir() if p.suffix.lower() in audio.AUDIO_EXTS])
            results.append({
                "artist": artist, "album": album, "status": outcome.status, "message": outcome.message,
                "path": outcome.path, "tracks": track_count, "format": fmt,
                "quality": [f"{bits}-bit / {rate / 1000:g} kHz" for bits, rate in quality],
            })
            mark = {"imported": "✔", "exists": "⏭", "failed": "✖"}[outcome.status]
            self._log(job_id, f"{mark} {artist} / {album}: {outcome.message}")
        return results


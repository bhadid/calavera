"""The download queue and the pipeline each job runs through.

One job runs at a time:

    plan  ->  download (amdl)  ->  verify  ->  convert to FLAC  ->  import

Each stage is a method on `JobManager`; to add a stage (say, a media-server
scan after import), add a method and call it from `_run`.

Job statuses
    queued       waiting for its turn
    running      in the pipeline (see `stage`)
    done         what the job set out to get is in the library
    skipped      the library already had it; nothing was changed
    failed       something went wrong (see `error`); files may remain in staging
    canceled     stopped by the user
    interrupted  Calavera restarted while the job was running

Job options (stored with the job)
    track_ids  list of song ids: download only these songs of the album
    merge      add tracks to an album folder that already exists
    resume     skip the download and continue with the files in staging

What a job downloads is decided in `_plan`: songs Apple does not offer are
left out up front (that is expected, not a failure), and so are tracks the
library already has when merging.

Staging: each job owns `<staging>/<job id>/`. It is deleted when the job ends
`done`, and kept otherwise so the files can be inspected or imported after
all, until the job is retried or removed.
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
from .plan import Plan, make_plan
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


def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def _codec(track: Path) -> str:
    return "flac" if track.suffix.lower() == ".flac" else "alac"


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
    def staging_dir(self, job_id: str) -> Path:
        return self._config.staging_dir / job_id

    def _staged_tracks(self, job_id: str) -> list[Path]:
        music = self.staging_dir(job_id) / "music"
        if not music.is_dir():
            return []
        return sorted(p for p in music.rglob("*") if p.is_file() and p.suffix.lower() in audio.AUDIO_EXTS)

    def _view(self, job: dict[str, Any]) -> dict[str, Any]:
        """A job as the API presents it."""
        job["has_files"] = self.staging_dir(job["id"]).exists()
        # Tracks sitting in staging that could still be imported.
        finished = job["status"] not in ACTIVE
        job["staged_tracks"] = len(self._staged_tracks(job["id"])) if job["has_files"] and finished else 0
        return job

    def list(self) -> list[dict[str, Any]]:
        return [self._view(j) for j in self._db.list_jobs()]

    def get(self, job_id: str) -> dict[str, Any] | None:
        job = self._db.get_job(job_id)
        return self._view(job) if job else None

    def logs(self, job_id: str) -> list[dict[str, Any]]:
        return self._db.get_logs(job_id)

    # -- commands ----------------------------------------------------------------
    def enqueue(self, raw_url: str, track_ids: list[str] | None = None) -> dict[str, Any]:
        """Add a job. `track_ids` limits an album job to those songs.
        Raises urls.UnsupportedUrl or JobError (duplicate)."""
        parsed = urls.parse(raw_url)
        options: dict[str, Any] = {}
        if parsed.kind == "album" and track_ids:
            options["track_ids"] = sorted(set(track_ids))
        # Choosing specific songs is an explicit wish to have them, also when
        # the album folder is already there.
        options["merge"] = parsed.kind == "song" or "track_ids" in options
        for job in self._db.list_jobs(ACTIVE):
            same_target = (job["kind"], job["apple_id"]) == (parsed.kind, parsed.apple_id)
            if same_target and job["options"].get("track_ids") == options.get("track_ids"):
                raise JobError("That is already in the queue.")
        job = {
            "id": uuid.uuid4().hex[:12],
            "url": parsed.url,
            "kind": parsed.kind,
            "storefront": parsed.storefront,
            "apple_id": parsed.apple_id,
            "status": "queued",
            "options": options,
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
            else:
                item = await self._catalog.song(job["storefront"], job["apple_id"], language)
        except CatalogError:
            return
        if self._db.get_job(job["id"]):
            self._update(job["id"], title=item["name"], artist=item["artist"], artists=item["artists"], artwork_url=item["artwork"])

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

    def _requeue(self, job_id: str, options: dict[str, Any]) -> None:
        self._db.clear_logs(job_id)
        self._update(
            job_id, status="queued", stage="", progress=0, detail="", error="", result=[],
            options=options, started_at=None, finished_at=None,
        )
        self._wake.set()

    def retry(self, job_id: str) -> None:
        """Run a finished job again from the start."""
        job = self._db.get_job(job_id)
        if not job or job["status"] in ACTIVE:
            raise JobError("Only a finished job can be retried.")
        self.discard_files(job_id)
        self._requeue(job_id, {**job["options"], "resume": False})

    def import_anyway(self, job_id: str) -> None:
        """Import what a finished job has, or can still get, adding to an
        existing album folder where needed.

        With files in staging (a download that failed part-way, or one that
        found the album folder taken) those files are used and nothing is
        downloaded. Without files, the job runs again in merge mode and
        downloads only the tracks the library lacks.
        """
        job = self._db.get_job(job_id)
        if not job or job["status"] in ACTIVE:
            raise JobError("Only a finished job can be imported.")
        resume = bool(self._staged_tracks(job_id))
        if not resume:
            self.discard_files(job_id)
        self._requeue(job_id, {**job["options"], "merge": True, "resume": resume})

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
        options = job["options"]
        settings = self._get_settings()
        self._update(job_id, status="running", stage="preparing", started_at=time.time(), progress=0, error="", detail="")
        job_dir = self.staging_dir(job_id)
        music_dir = job_dir / "music"

        plan: Plan | None = None
        if options.get("resume") and self._staged_tracks(job_id):
            await self._check_library()
            self._log(job_id, "Continuing with the files already downloaded; nothing is downloaded again.")
            await asyncio.to_thread(self._drop_unfinished, job_id)
        else:
            await self._preflight()
            plan = await self._plan(job)
            shutil.rmtree(job_dir, ignore_errors=True)
            music_dir.mkdir(parents=True)
            await self._download(job, settings, job_dir, music_dir, plan)

        albums = self._collect(music_dir)
        self._check_cancel()

        self._update(job_id, stage="verifying", progress=0.85, detail="Checking the downloaded tracks")
        try:
            infos = await asyncio.to_thread(
                lambda: [audio.check_finished(t, _codec(t)) for t in self._staged_tracks(job_id)]
            )
        except audio.AudioError as e:
            raise JobError(f"A downloaded track is not usable: {e}") from e
        quality = sorted({(i.bit_depth, i.sample_rate) for i in infos}, reverse=True)

        if settings.flac:
            await self._convert(job_id, [t for t in self._staged_tracks(job_id) if t.suffix.lower() == ".m4a"])
        await asyncio.to_thread(self._make_readable, music_dir)
        self._check_cancel()

        merge = bool(options.get("merge"))
        results = await self._import(job_id, albums, quality, merge, plan)
        statuses = {r["status"] for r in results}
        if "failed" in statuses:
            failed = next(r for r in results if r["status"] == "failed")
            self._finish(job_id, "failed", result=results, error=failed["message"])
        elif "imported" in statuses:
            shutil.rmtree(job_dir, ignore_errors=True)
            self._finish(job_id, "done", progress=1, result=results, detail=plan.note() if plan else "")
        elif merge:
            # In merge mode "exists" means every one of these tracks is in the
            # library already, so the staged copies have served their purpose.
            shutil.rmtree(job_dir, ignore_errors=True)
            self._finish(job_id, "skipped", progress=1, result=results, detail="Every track is already in the library.")
        else:
            self._finish(
                job_id, "skipped", progress=1, result=results,
                detail="Already in the library. The downloaded files are kept in staging until you add or discard them.",
            )

    # -- stages ------------------------------------------------------------------
    async def _check_library(self) -> None:
        problem = await asyncio.to_thread(library.library_problem, self._config.library_dir)
        if problem:
            raise JobError(problem)

    async def _preflight(self) -> None:
        """Fail before downloading anything if the job cannot succeed."""
        if not await self._wrapper.regions():
            raise JobError("Not signed in to Apple Music, or the wrapper is not running. Open Account to sign in.")
        await self._check_library()
        self._config.staging_dir.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self._config.staging_dir).free < MIN_FREE_BYTES:
            raise JobError("Less than 1 GB is free in the staging folder.")

    async def _plan(self, job: dict[str, Any]) -> Plan | None:
        """Decide which tracks to download. Returns None when the catalogue
        cannot be asked or the job is a single song; the job then simply
        downloads its link.

        Ends the job right here when there is nothing to download.
        """
        job_id, options = job["id"], job["options"]
        if job["kind"] != "album":
            return None
        try:
            album = await asyncio.wait_for(
                self._catalog.album(job["storefront"], job["apple_id"], self._get_settings().language), timeout=15
            )
        except (CatalogError, asyncio.TimeoutError):
            self._log(job_id, "The catalogue could not be asked which songs are available; downloading the whole album.")
            return None
        if not job["title"]:
            self._update(
                job_id, title=album["name"], artist=album["artist"], artists=album["artists"], artwork_url=album["artwork"]
            )

        existing = await asyncio.to_thread(library.find_album, self._config.library_dir, album["artist"], album["name"])
        merge = bool(options.get("merge"))
        if existing and not merge:
            # A plain album download never touches an album folder that exists.
            self._log(job_id, f"⏭ The library already has '{existing}'. Nothing was downloaded.")
            self._finish(
                job_id, "skipped", progress=1, detail="Already in the library.",
                result=[{"status": "exists", "path": existing, "message": "Already in the library."}],
            )
            raise _Finished()

        if existing and album.get("upc"):
            # Adding to a folder that holds another edition would mix the two.
            found = await asyncio.to_thread(library.folder_barcode, self._config.library_dir / existing)
            if found and not library.same_barcode(found, album["upc"]):
                raise JobError(library.other_edition_message(existing).replace("Nothing was added to it.", "Nothing was downloaded."))
        present = await asyncio.to_thread(library.track_keys, self._config.library_dir / existing) if existing else None
        plan = make_plan(album["tracks"], options.get("track_ids"), present)
        for track in plan.unavailable:
            self._log(job_id, f"– Not available on Apple Music: {track['track_number']:02d}. {track['name']}")
        for track in plan.owned:
            self._log(job_id, f"– Already in the library: {track['track_number']:02d}. {track['name']}")
        if plan.wanted:
            self._log(job_id, f"Downloading {_plural(len(plan.wanted), 'song')} of {plan.album_tracks}.")
            return plan
        if plan.owned:
            self._finish(
                job_id, "skipped", progress=1, detail="Every available song is already in the library.",
                result=[{"status": "exists", "path": existing or "", "message": plan.note()}],
            )
            raise _Finished()
        raise JobError(
            "None of these songs is available on Apple Music." if options.get("track_ids")
            else "No song of this album is available on Apple Music."
        )

    async def _download(
        self, job: dict[str, Any], settings: Settings, job_dir: Path, music_dir: Path, plan: Plan | None
    ) -> None:
        job_id = job["id"]
        self._update(job_id, stage="downloading", detail="Starting")
        if plan is None or plan.whole_album:
            links = [job["url"]]
        else:
            # amdl takes any number of links in one run; song links make it
            # fetch exactly the chosen tracks into the album's folder.
            links = [f"https://music.apple.com/{job['storefront']}/song/{t['id']}" for t in plan.wanted]
        expected = len(plan.wanted) if plan else 0
        config = amdl.build_config(settings, self._config.wrapper_url, job["storefront"], music_dir)
        self._runner = amdl.Runner(self._config.amdl_bin)

        def on_progress(p: amdl.Progress) -> None:
            if len(links) > 1:
                # One link per song: amdl counts "track 1 of 1" each time, so
                # count the songs it has started instead.
                started = max(p.songs_started, 1)
                within = {"Downloading": p.percent / 200, "Decrypting": 0.5 + p.percent / 200}.get(p.phase, 0.0)
                fraction = min(1.0, (started - 1 + within) / expected)
                detail = f"Song {min(started, expected)} of {expected}"
            else:
                fraction = p.fraction
                detail = f"Track {p.track} of {p.total}" if p.total else "Starting"
            if p.quality:
                detail += f" · {p.quality}"
            # Downloading is 85% of the bar; conversion and import share the rest.
            self._update(job_id, throttle=True, progress=round(fraction * 0.85, 4), detail=detail)

        result = await self._runner.run(links, job_dir, config, lambda line: self._log(job_id, line), on_progress)
        self._check_cancel()
        summary = result.progress.summary
        if summary is None:
            raise JobError(f"The downloader stopped without a result (exit code {result.exit_code}). See the log.")
        if not summary.clean or result.exit_code != 0 or (expected and summary.completed < expected):
            total = max(summary.total, expected)
            raise JobError(
                f"{summary.completed} of {total} tracks downloaded, {total - summary.completed} failed. "
                "Nothing was imported. You can keep the downloaded tracks, or see the log for the reason."
            )

    def _drop_unfinished(self, job_id: str) -> None:
        """Before continuing from staged files, remove tracks the download
        left incomplete. Staging only; the library is not involved."""
        for track in self._staged_tracks(job_id):
            try:
                audio.check_finished(track, _codec(track))
                audio.check_decodes(self._config.ffmpeg_bin, track)
            except audio.AudioError as e:
                self._log(job_id, f"– Leaving out an unfinished track: {e}")
                track.unlink(missing_ok=True)

    @staticmethod
    def _collect(music_dir: Path) -> list[tuple[str, str, Path]]:
        """(artist folder, album folder, path) for every album in staging."""
        albums = [
            (artist.name, album.name, album)
            for artist in (sorted(music_dir.iterdir()) if music_dir.is_dir() else []) if artist.is_dir()
            for album in sorted(artist.iterdir())
            if album.is_dir() and any(p.suffix.lower() in audio.AUDIO_EXTS for p in album.iterdir())
        ]
        if not albums:
            raise JobError("There are no downloaded tracks to import.")
        return albums

    async def _convert(self, job_id: str, tracks: list[Path]) -> None:
        if not tracks:
            return
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
        self, job_id: str, albums: list[tuple[str, str, Path]], quality: list[tuple[int, int]],
        merge: bool, plan: Plan | None,
    ) -> list[dict[str, Any]]:
        self._update(job_id, stage="importing", progress=0.95, detail="Copying to the library")
        importer = library.merge_album if merge else library.import_album
        results = []
        for artist, album, path in albums:
            self._check_cancel()
            tracks = [p for p in path.iterdir() if p.suffix.lower() in audio.AUDIO_EXTS]
            outcome = await asyncio.to_thread(importer, path, self._config.library_dir, artist, album)
            known = plan is not None and len(albums) == 1
            results.append({
                "artist": artist, "album": album, "status": outcome.status, "message": outcome.message,
                "path": outcome.path,
                "tracks": outcome.added if outcome.status == "imported" else len(tracks),
                "format": "flac" if all(t.suffix.lower() == ".flac" for t in tracks) else "alac",
                "quality": [f"{bits}-bit / {rate / 1000:g} kHz" for bits, rate in quality],
                # For "10 of 16" in the interface: how many tracks the album
                # has and how many Apple does not offer. Known only when the
                # download was planned from the catalogue.
                "album_tracks": plan.album_tracks if known else 0,
                "unavailable": len(plan.unavailable) if known else 0,
            })
            mark = {"imported": "✔", "exists": "⏭", "failed": "✖"}[outcome.status]
            self._log(job_id, f"{mark} {artist} / {album}: {outcome.message}")
        return results

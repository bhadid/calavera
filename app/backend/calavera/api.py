"""HTTP API and static frontend.

All routes live under /api and return JSON. Errors use the shape
`{"error": "<message for the user>"}`. Live updates are pushed over
Server-Sent Events at /api/events.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Receive, Scope, Send
from pydantic import BaseModel, Field, ValidationError

from . import __version__, audio, bundle, library, urls
from .catalog import GROUPS, Catalog, CatalogError, NotInCatalog
from .config import LOCAL_HOSTS, Config, host_name
from .config import load as load_config
from .db import Database
from .jobs import JobError, JobManager, StagedAlbum
from .memory import ALBUM, ARTIST, QUALITY, SEARCH, Memory
from .plan import track_file_stem
from .settings import Settings
from .wrapper import WrapperClient

SETTINGS_KEY = "settings"
# An album page checks at most this many of the album's artists for whether
# Apple leaves the album out of their releases (each costs a few requests).
MAX_ARTISTS_CHECKED = 3

# The page may load its own files and album artwork from Apple's CDN, nothing
# else, and may not be embedded in another site.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "img-src 'self' https://*.mzstatic.com data:",
    "style-src 'self' 'unsafe-inline'",  # React sets inline style attributes
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


class NewJobItem(BaseModel):
    url: str
    # Song ids to download from an album link. Empty or absent: the whole album.
    track_ids: list[str] | None = Field(default=None, max_length=500)
    # "device": keep the files for the browser instead of adding them to the library.
    destination: Literal["library", "device"] = "library"


class NewJobs(BaseModel):
    """Either plain links, or items when specific songs of an album are wanted."""
    urls: list[str] = Field(default_factory=list, max_length=50)
    destination: Literal["library", "device"] = "library"
    items: list[NewJobItem] = Field(default_factory=list, max_length=50)


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class Code(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


def audio_type(suffix: str) -> str:
    return {".flac": "audio/flac", ".m4a": "audio/mp4", ".jpg": "image/jpeg", ".lrc": "text/plain"}.get(
        suffix.lower(), "application/octet-stream")


class WhenSent(Response):
    """A response that calls `done` once it went out to its end, and not if
    the browser left before. (The server cannot tell more: not whether the
    browser saved what it got.)

    Starlette's background tasks run in both cases, so this watches for the
    browser leaving itself, while the response is sent.
    """

    def __init__(self, response: Response, done) -> None:  # noqa: D107 (wraps, so no super().__init__)
        self.response = response
        self.done = done
        self.status_code = response.status_code
        self.raw_headers = response.raw_headers
        self.background = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        state = {"complete": False, "left": False}

        async def watch() -> None:
            while (await receive())["type"] != "http.disconnect":
                pass
            if not state["complete"]:
                state["left"] = True

        async def tracked(message) -> None:
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                await asyncio.sleep(0)  # let `watch` see a disconnect that came first
                state["complete"] = not state["left"]

        watcher = asyncio.create_task(watch())
        try:
            await self.response(scope, receive, tracked)
        finally:
            watcher.cancel()
        if state["complete"] and not state["left"]:
            self.done()


def reaches_end(range_header: str | None, size: int) -> bool:
    """Whether a request for a file of `size` bytes asks for it up to its
    last byte: the whole file, or the rest of it when a download resumes."""
    if not range_header:
        return True
    unit, _, spec = range_header.partition("=")
    if unit.strip().lower() != "bytes":
        return True  # not a range FileResponse honours: the whole file is sent
    for part in spec.split(","):
        start, _, end = part.strip().partition("-")
        if start and (not end or (end.isdigit() and int(end) >= size - 1)):
            return True
    return False


def create_app(config: Config | None = None) -> FastAPI:
    config = config or load_config()
    db = Database(config.db_path)
    catalog = Catalog()
    memory = Memory()
    wrapper = WrapperClient(config.wrapper_url, config.supervisor_url, config.control_token_file)

    def get_settings() -> Settings:
        return Settings(**(db.get_kv(SETTINGS_KEY) or {}))

    jobs = JobManager(config, db, catalog, wrapper, get_settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        jobs.start()
        yield
        await jobs.stop()
        await catalog.close()
        await wrapper.close()
        db.close()

    # The API explorer is off unless asked for: it loads its scripts from a
    # CDN, so its page cannot have the Content-Security-Policy.
    docs = config.api_docs
    app = FastAPI(
        title="Calavera", version=__version__, lifespan=lifespan, redoc_url=None,
        docs_url="/api/docs" if docs else None, openapi_url="/api/openapi.json" if docs else None,
    )
    allowed_hosts = {host_name(h) for h in (*LOCAL_HOSTS, *config.allowed_hosts)}

    # -- errors and request guard ------------------------------------------------
    def error(status: int, message: str) -> JSONResponse:
        return JSONResponse({"error": message}, status_code=status)

    @app.exception_handler(HTTPException)
    async def _http_error(_request: Request, exc: HTTPException):
        return error(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        return error(422, f"Invalid request: {field}: {first.get('msg', 'invalid value')}".replace(": :", ":"))

    @app.middleware("http")
    async def _same_origin_only(request: Request, call_next):
        # The UI has no login. Without these checks any web page open in the
        # user's browser could use it. A page on another site is refused by
        # the Origin check. A page that rebinds its own domain to this
        # address (DNS rebinding) passes that check, as both headers then name
        # its domain; it is refused by the Host check.
        host = host_name(request.headers.get("host", ""))
        if host not in allowed_hosts:
            return PlainTextResponse(
                f"Calavera does not answer to the host name {host!r}. If that is how you reach it, add it to "
                "ALLOWED_HOSTS in .env and run: docker compose up -d", status_code=421)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return error(403, "Cross-site request refused.")
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        if not (docs and request.url.path.startswith("/api/docs")):
            response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        return response

    async def storefront() -> str:
        configured = get_settings().storefront
        if configured:
            return configured
        regions = await wrapper.regions()
        return regions[0] if regions else "us"

    # -- status ------------------------------------------------------------------
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": __version__}

    @app.get("/api/status")
    async def status():
        problem = await asyncio.to_thread(library.library_problem, config.library_dir)
        try:
            staging_free = shutil.disk_usage(config.staging_dir).free
        except OSError:
            staging_free = None
        try:
            library_free = shutil.disk_usage(config.library_dir).free if not problem else None
        except OSError:
            library_free = None
        return {
            "version": __version__,
            "wrapper": await wrapper.status(),
            "library": {"ok": problem is None, "problem": problem, "free_bytes": library_free},
            "staging": {"free_bytes": staging_free},
            "storefront": await storefront(),
        }

    # -- jobs --------------------------------------------------------------------
    @app.get("/api/jobs")
    async def list_jobs():
        return {"jobs": jobs.list()}

    @app.post("/api/jobs")
    async def add_jobs(body: NewJobs):
        plain = dict.fromkeys(u.strip() for u in body.urls if u.strip())
        wanted = [NewJobItem(url=u, destination=body.destination) for u in plain] + body.items
        if not wanted:
            raise HTTPException(422, "No links were given.")
        added, rejected = [], []
        for item in wanted:
            try:
                added.append(jobs.enqueue(item.url, item.track_ids, item.destination))
            except (urls.UnsupportedUrl, JobError) as e:
                rejected.append({"url": item.url, "error": str(e)})
        return JSONResponse({"added": added, "rejected": rejected}, status_code=201 if added else 422)

    def require_job(job_id: str) -> dict:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "No such job.")
        return job

    @app.get("/api/jobs/{job_id}")
    async def get_job(job_id: str):
        return {"job": require_job(job_id), "log": jobs.logs(job_id)}

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str):
        require_job(job_id)
        jobs.cancel(job_id)
        return {"job": jobs.get(job_id)}

    @app.post("/api/jobs/{job_id}/retry")
    async def retry_job(job_id: str):
        require_job(job_id)
        try:
            jobs.retry(job_id)
        except JobError as e:
            raise HTTPException(409, str(e)) from e
        return {"job": jobs.get(job_id)}

    @app.post("/api/jobs/{job_id}/import")
    async def import_job(job_id: str):
        """Import what the job has (or can still get), adding to an existing
        album folder if there is one. Used for "Keep downloaded tracks" and
        "Add missing tracks"."""
        require_job(job_id)
        try:
            jobs.import_anyway(job_id)
        except JobError as e:
            raise HTTPException(409, str(e)) from e
        return {"job": jobs.get(job_id)}

    @app.delete("/api/jobs/{job_id}/files")
    async def discard_job_files(job_id: str):
        require_job(job_id)
        try:
            jobs.discard_files(job_id)
        except JobError as e:
            raise HTTPException(409, str(e)) from e
        return {"job": jobs.get(job_id)}

    # -- downloads to the user's device ------------------------------------------
    def ready_files(job_id: str) -> tuple[dict, list[StagedAlbum], list[bundle.Entry]]:
        job = require_job(job_id)
        if job["status"] != "ready":
            raise HTTPException(409, "This job has nothing to download.")
        albums = jobs.staged_albums(job_id)
        entries = bundle.entries_for((library.folder_name(f"{a.artist} - {a.album}"), a.path) for a in albums)
        if not entries:
            raise HTTPException(410, "The downloaded files were removed. Retry the job to download them again.")
        return job, albums, entries

    def attachment(name: str) -> dict[str, str]:
        return {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}", "Cache-Control": "no-store"}

    def send_file(request: Request, entry: bundle.Entry, name: str, done) -> Response:
        # FileResponse answers Range requests, so an interrupted file resumes.
        response = FileResponse(entry.path, headers=attachment(name), media_type=audio_type(entry.path.suffix))
        return WhenSent(response, done) if reaches_end(request.headers.get("range"), entry.size) else response

    def library_folders(job: dict) -> list[tuple[str, Path]]:
        """The library folders a finished job put its album in (or found it
        in), as (name for the download, folder). Only folders inside the
        library; ones moved or renamed since are left out."""
        root = config.library_dir.resolve()
        found = []
        for r in job["result"]:
            if r.get("status") not in ("imported", "exists") or not r.get("path"):
                continue
            folder = (root / r["path"]).resolve()
            if folder.is_relative_to(root) and folder != root and folder.is_dir():
                found.append((library.folder_name(" - ".join(Path(r["path"]).parts)), folder))
        return found

    async def download_from_library(job: dict) -> Response:
        """A job whose album is in the library, straight from there: Apple
        and staging are not involved, and the library is only read."""
        folders = await asyncio.to_thread(library_folders, job)
        if not folders:
            raise HTTPException(410, "The album's folder is no longer in the library.")
        if job["kind"] == "song":
            try:
                song = await catalog.song(job["storefront"], job["apple_id"], get_settings().language)
            except CatalogError as e:
                raise HTTPException(502, str(e)) from e
            key = library.stem_key(track_file_stem(song))
            for _name, folder in folders:
                for path in sorted(folder.iterdir()):
                    if path.suffix.lower() in audio.AUDIO_EXTS and library.track_key(path.name) == key:
                        name = library.folder_name(f"{song['artist']} - {song['name']}") + path.suffix
                        return FileResponse(path, headers=attachment(name), media_type=audio_type(path.suffix))
            raise HTTPException(410, "The song's file is no longer in the library.")
        entries = await asyncio.to_thread(bundle.entries_for, folders)
        name = folders[0][0] if len(folders) == 1 else library.folder_name(job["title"] or "Calavera")
        return StreamingResponse(
            bundle.zip_stream(entries), media_type="application/zip",
            headers={**attachment(f"{name}.zip"), "Content-Length": str(bundle.zip_size(entries))},
        )

    @app.get("/api/jobs/{job_id}/download")
    async def download_job(job_id: str, request: Request):
        """A job's files: the file itself when there is one track, otherwise
        a ZIP made while it is sent. From staging for a job that is ready,
        from the library for one whose album is there."""
        job = require_job(job_id)
        if job["status"] in ("done", "skipped"):
            return await download_from_library(job)
        job, albums, entries = await asyncio.to_thread(ready_files, job_id)
        tracks = [e for e in entries if e.path.suffix.lower() in audio.AUDIO_EXTS]
        if len(tracks) == 1:
            track = tracks[0]
            title = re.sub(r"^\d+[-. ]*\s*", "", track.path.stem) or track.path.stem
            name = library.folder_name(f"{track.path.parent.parent.name} - {title}") + track.path.suffix
            return send_file(request, track, name, lambda: jobs.fetched(job_id))
        if len(albums) == 1:
            name = library.folder_name(f"{albums[0].artist} - {albums[0].album}")
        else:
            name = library.folder_name(job["title"] or "Calavera")
        return WhenSent(StreamingResponse(
            bundle.zip_stream(entries), media_type="application/zip",
            headers={**attachment(f"{name}.zip"), "Content-Length": str(bundle.zip_size(entries))},
        ), lambda: jobs.fetched(job_id))

    @app.get("/api/jobs/{job_id}/files")
    async def list_job_files(job_id: str):
        """A ready job's files one by one, for when the ZIP will not do."""
        _job, _albums, entries = await asyncio.to_thread(ready_files, job_id)
        return {"files": [{"index": i, "name": e.name, "size": e.size} for i, e in enumerate(entries)]}

    @app.get("/api/jobs/{job_id}/files/{index}")
    async def download_job_file(job_id: str, index: int, request: Request):
        # Files are addressed by their place in the list, never by a path
        # taken from the request.
        _job, _albums, entries = await asyncio.to_thread(ready_files, job_id)
        if not 0 <= index < len(entries):
            raise HTTPException(404, "No such file.")
        entry = entries[index]
        audio_files = {i for i, e in enumerate(entries) if e.path.suffix.lower() in audio.AUDIO_EXTS}
        return send_file(request, entry, entry.path.name, lambda: jobs.file_sent(job_id, index, audio_files))

    @app.delete("/api/jobs/{job_id}")
    async def remove_job(job_id: str):
        require_job(job_id)
        try:
            jobs.remove(job_id)
        except JobError as e:
            raise HTTPException(409, str(e)) from e
        return {"ok": True}

    @app.get("/api/events")
    async def events(request: Request):
        queue = jobs.subscribe()

        async def stream():
            try:
                yield "retry: 3000\n\n"
                while True:
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=20)
                        yield f"data: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
                    if await request.is_disconnected():
                        break
            finally:
                jobs.unsubscribe(queue)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # -- settings ----------------------------------------------------------------
    @app.get("/api/settings")
    async def read_settings():
        return {"settings": get_settings().model_dump(), "defaults": Settings().model_dump()}

    @app.put("/api/settings")
    async def write_settings(request: Request):
        try:
            body = await request.json()
            updated = Settings(**{**get_settings().model_dump(), **(body if isinstance(body, dict) else {})})
        except ValidationError as e:
            first = e.errors()[0]
            raise HTTPException(422, f"{'.'.join(str(p) for p in first['loc'])}: {first['msg']}") from e
        except ValueError as e:
            raise HTTPException(400, "The request body is not valid JSON.") from e
        db.set_kv(SETTINGS_KEY, updated.model_dump())
        return {"settings": updated.model_dump()}

    # -- Apple account -----------------------------------------------------------
    @app.post("/api/account/login")
    async def account_login(body: Login):
        # The password is forwarded to the wrapper container and not kept here.
        status_code, payload = await wrapper.login(body.email, body.password)
        if status_code >= 400:
            raise HTTPException(status_code, payload.get("error", "The sign-in could not be started."))
        return {"ok": True}

    @app.post("/api/account/code")
    async def account_code(body: Code):
        status_code, payload = await wrapper.submit_code(body.code)
        if status_code >= 400:
            raise HTTPException(status_code, payload.get("error", "The code could not be submitted."))
        return {"ok": True}

    # -- catalogue ---------------------------------------------------------------
    def mark_owned(albums: list[dict]) -> None:
        for album in albums:
            album["in_library"] = library.find_album(config.library_dir, album["artist"], album["name"])

    def mark_owned_songs(songs: list[dict]) -> None:
        """`in_library`: the album folder, when it has a file of the song's
        name (the same test the album page makes for each track)."""
        present: dict[str, set[str]] = {}
        for song in songs:
            folder = library.find_album(config.library_dir, song.get("album_artist") or song["artist"], song["album"])
            if folder and folder not in present:
                present[folder] = library.track_keys(config.library_dir / folder)
            owned = folder and library.stem_key(track_file_stem(song)) in present[folder]
            song["in_library"] = folder if owned else None

    async def remembered(key: tuple, lifetime: float, fetch, fresh: bool) -> tuple:
        """A catalogue answer from the memory or from Apple; see memory.py.
        Also returns since when the answer is old, if Apple could not be
        reached, else None."""
        try:
            return await memory.get(key, lifetime, fetch, fresh)
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e

    @app.get("/api/catalog/search")
    async def catalog_search(q: str, fresh: bool = False):
        term = q.strip()
        if len(term) < 2:
            raise HTTPException(422, "Type at least two characters.")
        language = get_settings().language

        async def find() -> dict:
            # A pasted Apple Music link is resolved instead of searched for.
            try:
                parsed = urls.parse(term)
            except urls.UnsupportedUrl:
                return await catalog.search(await storefront(), term, language)
            if parsed.kind == "album":
                return {"albums": [await catalog.album(parsed.storefront, parsed.apple_id, language)], "songs": [], "artists": []}
            return {"albums": [], "songs": [await catalog.song(parsed.storefront, parsed.apple_id, language)], "artists": []}

        results, results["stale_since"] = await remembered(("search", await storefront(), language, term), SEARCH, find, fresh)
        await asyncio.to_thread(mark_owned, results["albums"])
        await asyncio.to_thread(mark_owned_songs, results["songs"])
        return results

    def mark_owned_tracks(album: dict) -> None:
        album["library_path"] = library.album_path(config.library_dir, album["artist"], album["name"])
        folder = album.get("in_library")
        # Whether the folder holds this edition of the album or another one
        # under the same title (explicit and clean, say), by the barcode in
        # its files' tags; None when either side has none.
        album["edition"] = None
        if folder and album.get("upc"):
            found = library.folder_barcode(config.library_dir / folder)
            if found:
                album["edition"] = "same" if library.same_barcode(found, album["upc"]) else "other"
        present = library.track_keys(config.library_dir / folder) if folder else set()
        for track in album["tracks"]:
            track["in_library"] = library.stem_key(track_file_stem(track)) in present

    async def album_answer(album_id: str, sf: str, fresh: bool = False) -> dict:
        """An album from the memory or from Apple, with `stale_since` and
        the `storefront` it was looked up in."""
        if not album_id.isdigit() or (sf and not (len(sf) == 2 and sf.isalpha())):
            raise HTTPException(422, "Not a valid album reference.")
        store, language = sf.lower() or await storefront(), get_settings().language
        album, album["stale_since"] = await remembered(
            ("album", store, language, album_id), ALBUM, lambda: catalog.album(store, album_id, language), fresh
        )
        album["storefront"] = store
        return album

    @app.get("/api/catalog/albums/{album_id}/other-release")
    async def catalog_album_other_release(album_id: str, sf: str = ""):
        """Whether Apple leaves the album out of its grouping of the releases
        of any of the album's artists (`other_release`). Asked for after the
        album page is shown: it takes a few requests per artist, remembered
        like an artist page, and none when that artist's pages were just
        seen. An artist Apple cannot be asked about now is left out."""
        album = await album_answer(album_id, sf)
        for artist in (album.get("artists") or [])[:MAX_ARTISTS_CHECKED]:
            try:
                answer, _ = await outside_grouping(album["storefront"], artist["id"])
            except HTTPException:
                continue
            if any(a.get("id") == album_id for a in answer["items"]):
                return {"other_release": True}
        return {"other_release": False}

    @app.get("/api/catalog/albums/{album_id}")
    async def catalog_album(album_id: str, sf: str = "", fresh: bool = False):
        """An album with its tracks, each marked as available or not and as
        already in the library or not, and the album's folder in the library
        (`library_path`, existing or not), and whether an existing folder
        holds this edition (`edition`). `sf` is the store code of the link."""
        album = await album_answer(album_id, sf, fresh)
        await asyncio.to_thread(mark_owned, [album])
        await asyncio.to_thread(mark_owned_tracks, album)
        return album

    @app.get("/api/catalog/albums/{album_id}/cover/{file_name}")
    async def catalog_album_cover(album_id: str, file_name: str, sf: str = ""):
        """The album's cover at its largest. It comes through Calavera so
        that saving it suggests "Artist - Album.jpg" instead of Apple's
        "3000x3000bb.jpg": the browser takes the name from the end of the
        address (`file_name`, not used here) or from Content-Disposition."""
        album = await album_answer(album_id, sf)
        try:
            image, kind = await catalog.cover(album["artwork"])
        except NotInCatalog as e:
            raise HTTPException(404, str(e)) from e
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e
        name = library.folder_name(f"{album['artist']} - {album['name']}") + ".jpg"
        return Response(image, media_type=kind, headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, max-age=86400",
        })

    @app.get("/api/catalog/albums/{album_id}/quality")
    async def catalog_album_quality(album_id: str, sf: str = "", fresh: bool = False):
        """The lossless quality the album is offered in:
        `{"quality": {"bit_depth", "sample_rate_min", "sample_rate_max"}}`,
        or null if unknown. The two rates differ for a hi-res album whose
        exact rate is not known."""
        if not album_id.isdigit() or (sf and not (len(sf) == 2 and sf.isalpha())):
            raise HTTPException(422, "Not a valid album reference.")
        store = sf.lower() or await storefront()
        quality, _ = await remembered(("quality", store, album_id), QUALITY, lambda: catalog.album_quality(store, album_id), fresh)
        return {"quality": quality}

    @app.get("/api/catalog/artists/{artist_id}")
    async def catalog_artist(artist_id: str, fresh: bool = False):
        """An artist with the first releases of each group (`shelves`)."""
        store, language = await storefront(), get_settings().language
        artist, artist["stale_since"] = await remembered(
            ("artist", store, language, artist_id), ARTIST, lambda: catalog.artist(store, artist_id, language), fresh
        )
        await asyncio.to_thread(mark_owned, [a for shelf in artist["shelves"] for a in shelf["items"]])
        return artist

    @app.get("/api/catalog/artists/{artist_id}/groups/{group}")
    async def catalog_artist_group(artist_id: str, group: str, offset: int = 0, fresh: bool = False):
        """One page of an artist's group, or of all their releases newest
        first (`all`): `items`, and `next`, the offset of the following page
        or null."""
        if (group != "all" and group not in GROUPS.values()) or not 0 <= offset <= 10_000:
            raise HTTPException(404, "No such group.")
        store, language = await storefront(), get_settings().language
        page, page["stale_since"] = await remembered(
            ("artist-group", store, language, artist_id, group, offset), ARTIST,
            lambda: catalog.artist_group(store, artist_id, group, offset, language), fresh,
        )
        await asyncio.to_thread(mark_owned, page["items"])
        return page

    async def outside_grouping(store: str, artist_id: str, fresh: bool = False) -> tuple:
        """The releases Apple lists for an artist outside its own grouping,
        remembered like an artist page; with since when the answer is old."""
        language = get_settings().language

        async def others() -> dict:
            artist = await catalog.artist_albums(store, artist_id, language)
            return {"items": [a for a in artist["albums"] if not a["grouped"]], "more": artist["more"]}

        return await remembered(("artist-others", store, language, artist_id), ARTIST, others, fresh)

    @app.get("/api/catalog/artists/{artist_id}/others")
    async def catalog_artist_others(artist_id: str, fresh: bool = False):
        """The releases Apple lists for the artist outside its own grouping,
        each with the `group` it belongs to. Takes a few requests: every page
        of the full list and of the grouping."""
        answer, answer["stale_since"] = await outside_grouping(await storefront(), artist_id, fresh)
        await asyncio.to_thread(mark_owned, answer["items"])
        return answer

    # -- frontend ----------------------------------------------------------------
    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"], include_in_schema=False)
    async def _unknown_api(rest: str):
        raise HTTPException(404, "No such API endpoint.")

    if config.static_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=config.static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def _frontend(path: str):
            # Single-page app: real files are served as-is, every other path
            # gets index.html and is routed in the browser.
            candidate = (config.static_dir / path).resolve()
            if path and candidate.is_file() and config.static_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(config.static_dir / "index.html", headers={"Cache-Control": "no-cache"})

    return app

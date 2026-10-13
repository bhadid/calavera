"""HTTP API and static frontend.

All routes live under /api and return JSON. Errors use the shape
`{"error": "<message for the user>"}`. Live updates are pushed over
Server-Sent Events at /api/events.
"""
from __future__ import annotations

import asyncio
import json
import shutil
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from . import __version__, library, urls
from .catalog import Catalog, CatalogError
from .config import Config
from .config import load as load_config
from .db import Database
from .jobs import JobError, JobManager
from .plan import track_file_stem
from .settings import Settings
from .wrapper import WrapperClient

SETTINGS_KEY = "settings"

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


class NewJobs(BaseModel):
    """Either plain links, or items when specific songs of an album are wanted."""
    urls: list[str] = Field(default_factory=list, max_length=50)
    items: list[NewJobItem] = Field(default_factory=list, max_length=50)


class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)


class Code(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


def create_app(config: Config | None = None) -> FastAPI:
    config = config or load_config()
    db = Database(config.db_path)
    catalog = Catalog()
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

    app = FastAPI(title="Calavera", version=__version__, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

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
        # The UI has no login. Without this check any web page open in the
        # user's browser could send state-changing requests to it.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return error(403, "Cross-site request refused.")
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        if not request.url.path.startswith("/api/docs"):  # the API explorer loads its assets from a CDN
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
        wanted = [NewJobItem(url=u) for u in dict.fromkeys(u.strip() for u in body.urls if u.strip())] + body.items
        if not wanted:
            raise HTTPException(422, "No links were given.")
        added, rejected = [], []
        for item in wanted:
            try:
                added.append(jobs.enqueue(item.url, item.track_ids))
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

    @app.get("/api/catalog/search")
    async def catalog_search(q: str):
        term = q.strip()
        if len(term) < 2:
            raise HTTPException(422, "Type at least two characters.")
        try:
            # A pasted Apple Music link is resolved instead of searched for.
            try:
                parsed = urls.parse(term)
            except urls.UnsupportedUrl:
                results = await catalog.search(await storefront(), term, get_settings().language)
            else:
                if parsed.kind == "album":
                    album = await catalog.album(parsed.storefront, parsed.apple_id, get_settings().language)
                    results = {"albums": [album], "songs": [], "artists": []}
                else:
                    song = await catalog.song(parsed.storefront, parsed.apple_id, get_settings().language)
                    results = {"albums": [], "songs": [song], "artists": []}
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e
        await asyncio.to_thread(mark_owned, results["albums"])
        return results

    def mark_owned_tracks(album: dict) -> None:
        folder = album.get("in_library")
        present = library.track_keys(config.library_dir / folder) if folder else set()
        for track in album["tracks"]:
            track["in_library"] = library.stem_key(track_file_stem(track)) in present

    @app.get("/api/catalog/albums/{album_id}")
    async def catalog_album(album_id: str, sf: str = ""):
        """An album with its tracks, each marked as available or not and as
        already in the library or not. `sf` is the store code of the link."""
        if not album_id.isdigit() or (sf and not (len(sf) == 2 and sf.isalpha())):
            raise HTTPException(422, "Not a valid album reference.")
        try:
            album = await catalog.album(sf.lower() or await storefront(), album_id, get_settings().language)
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e
        album["storefront"] = sf.lower() or await storefront()
        await asyncio.to_thread(mark_owned, [album])
        await asyncio.to_thread(mark_owned_tracks, album)
        return album

    @app.get("/api/catalog/albums/{album_id}/quality")
    async def catalog_album_quality(album_id: str, sf: str = ""):
        """The lossless quality the album is offered in:
        `{"quality": {"sample_rate", "bit_depth", "rate"}}`, or null if
        unknown. `rate` says how to read the sample rate: "exact",
        "at_least", or "above" (hi-res, the rate itself not known)."""
        if not album_id.isdigit() or (sf and not (len(sf) == 2 and sf.isalpha())):
            raise HTTPException(422, "Not a valid album reference.")
        try:
            return {"quality": await catalog.album_quality(sf.lower() or await storefront(), album_id)}
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e

    @app.get("/api/catalog/artists/{artist_id}")
    async def catalog_artist(artist_id: str):
        try:
            artist = await catalog.artist_albums(await storefront(), artist_id, get_settings().language)
        except CatalogError as e:
            raise HTTPException(502, str(e)) from e
        await asyncio.to_thread(mark_owned, artist["albums"])
        return artist

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

# Development

Everything builds and runs in Docker; the host needs no Python or Node.

## Build and run

```bash
cp .env.example .env            # point LIBRARY_PATH at a scratch folder with at least one entry in it
mkdir -p data/staging
docker compose build
docker compose up -d
docker compose logs -f app
```

Use a scratch library while developing, never a real one.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull
request: the backend tests, a build of the app image (which type-checks and
builds the frontend) and the accent colour check, with the commands given
below. It does not build the wrapper image and does not talk to Apple.

## Backend tests

```bash
docker build --target test \
  --build-arg AMDL_VERSION=v0.1.0 \
  --build-arg AMDL_SHA256=949e287d0fd92d0960ae9b14a0582c1056afaa78a7f66d486648d80673ef8d59 \
  app
```

The build fails if a test fails. The tests cover link parsing, the amdl output
parser, settings validation, FLAC conversion and verification (real ffmpeg on
generated audio), the library import rules, the download plan, the catalogue
client and its memory (against canned answers, never Apple) and the
database upgrade.

Of the API routes only the catalogue ones are tested (with their memory,
against a stand-in for Apple). Not covered by automated tests: the other
routes, the job pipeline as a whole and the supervisor. They were exercised by hand; see "Manual checks" below.

## Browser smoke test

`scripts/browser-smoke.mjs` drives a headless Chrome through a running
Calavera: redirect of unknown paths, navigation clicks, the back button,
search from the URL, an artist page, the account page, and console errors
(which includes Content-Security-Policy violations). It is read-only. Run it
after changing frontend dependencies or routing:

```bash
docker run -d --name chrome --network calavera_default --shm-size=512m zenika/alpine-chrome \
  --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --remote-allow-origins='*' about:blank
docker run --rm --network calavera_default -e BASE=http://app:8080 \
  -v "$PWD/scripts/browser-smoke.mjs":/t.mjs:ro node:22-alpine node /t.mjs
docker rm -f chrome
```

It needs the wrapper to be signed in (it checks search results and the
account status).

## Accent colour check

After changing `app/frontend/src/lib/accentColour.ts` or the accent tokens in
`styles.css`:

```bash
docker run --rm -v "$PWD":/w -w /w node:22-alpine node scripts/check-accent.mjs
```

It fails if any slider position, or monochrome, gives text on an accent fill
less than 4.5:1 contrast, or if the default shades written into `styles.css`
differ from the calculated ones.

### Python dependencies

`requirements.in` lists the packages Calavera uses directly;
`requirements.txt` is generated from it by `pip-compile` and pins those plus
all their sub-dependencies to a set that fits together (`requirements-dev.*`
adds pytest). Never edit the `.txt` files by hand. To change a dependency,
edit the `.in` file and regenerate:

```bash
cd app/backend
docker run --rm -v "$PWD":/w -w /w python:3.12-slim-bookworm sh -c \
  'pip install -q pip-tools && pip-compile -q --strip-extras requirements.in && pip-compile -q --strip-extras requirements-dev.in'
```

Dependabot understands this layout and regenerates the lock files in its
pull requests.

## Frontend

Type-check and build:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/app/frontend":/w -w /w node:22-alpine \
  sh -c 'npm ci && npm run build'
```

Live-reload dev server against a running backend (if you have Node locally):

```bash
cd app/frontend
npm ci
CALAVERA_API=http://<host>:8080 npm run dev      # http://localhost:5173
```

After changing dependencies in `package.json`, run `npm install` (as above,
in the Node container) and commit the updated `package-lock.json`; the image
build uses `npm ci`.

## API

Interactive reference while the app runs: `http://<host>:<port>/api/docs`.

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness. |
| `GET /api/status` | Wrapper, library and staging state. |
| `GET /api/jobs` · `POST /api/jobs` | List jobs · queue links: `{"urls": [...]}`, or `{"items": [{"url": ..., "track_ids": [...]}]}` for chosen songs of an album. |
| `GET /api/jobs/{id}` | One job with its log. |
| `POST /api/jobs/{id}/cancel` · `/retry` | Cancel · run again from the start. |
| `POST /api/jobs/{id}/import` | Import what the job has or can still get, adding to an existing album folder ("Keep N tracks", "Add missing tracks"). |
| `DELETE /api/jobs/{id}/files` · `DELETE /api/jobs/{id}` | Discard staging files · remove the job. |
| `GET /api/events` | Server-Sent Events: `job`, `removed`, `log`. |
| `GET` · `PUT /api/settings` | Read · change settings (partial updates accepted). |
| `POST /api/account/login` · `/api/account/code` | Start a sign-in · submit the 2FA code. |
| `GET /api/catalog/search?q=` · `/api/catalog/artists/{id}` · `/api/catalog/albums/{id}?sf=` | Catalogue. The album response lists tracks with `available` and `in_library`; the artist response has `shelves`, the first releases of each group. |
| `GET /api/catalog/artists/{id}/groups/{group}?offset=` · `/api/catalog/artists/{id}/others` | A page of an artist's group (`items`, `next`; the group `all` is every release, newest first), and the releases outside Apple's grouping. |
| `GET /api/catalog/albums/{id}/quality?sf=` | The lossless quality the album is offered in: `{"quality": {"bit_depth", "sample_rate_min", "sample_rate_max"}}`, or `null` if it cannot be told. The two rates differ for a hi-res album whose exact rate is not known. |

The catalogue routes answer from a short memory (see ARCHITECTURE.md).
`fresh=1` asks Apple regardless; `stale_since` (Unix seconds) in an answer
means Apple could not be reached and the answer is that old.

Errors are `{"error": "<message>"}` with a fitting status code.

## Conventions

- **Backend:** type hints throughout; modules stay small and single-purpose;
  blocking work (ffmpeg, file copies, hashing) goes through
  `asyncio.to_thread`; errors meant for the user are `JobError` /
  `HTTPException` with a complete sentence.
- **Frontend:** function components and hooks, no state library; server state
  lives in `lib/store.tsx`; styles use the tokens in `styles.css` only; no
  inline scripts and no web fonts (the Content-Security-Policy forbids
  them); interactive elements are at least 44 px tall on touch devices;
  destructive actions go through `useConfirm()`; status is never shown by
  colour alone; icons come from `components/Icon.tsx`, not from typed
  symbols (the exceptions are listed in ARCHITECTURE.md).
- **Library safety:** anything that writes to the library goes through
  `library.py` and keeps its rules. Add a test for every new rule.
- Pin versions. No `latest`.

## Manual checks

What was run by hand for 0.1.0, as a checklist for changes that touch the
pipeline:

- one-track and 13-track album downloads, FLAC on: tags, lyrics, cover,
  permissions, decoded-audio identity;
- re-queue an album that is in the library: skipped without downloading;
- an album with unavailable songs: only the available ones are downloaded,
  the result says "N of M" and how many are not available;
- choose two songs on the album page, then a third: the third is added to
  the existing folder, the first two are untouched;
- "Add missing tracks" on a skipped album; "Keep N tracks" on a failed job
  that has staged tracks, including one cut-off file that must be left out;
- cancel during download: process gone, staging removed;
- restart the app during a download: job becomes `interrupted`, retry works;
- discard files, retry, remove, clear history;
- cross-site POST refused; invalid settings rejected with a message;
- supervisor sign-in flow against a stand-in for wrapper-lite: wrong
  password, 2FA wait, bad code format, good code, concurrent sign-in refused,
  password masked in logs;
- UI screenshots in light, dark and phone width.

## Troubleshooting

| Symptom | Look at |
|---|---|
| "Wrapper offline" | `docker compose logs wrapper`. `mount ... failed` means the `security_opt` entries in `compose.yaml` are not in effect. |
| Jobs fail with "Not signed in" | Account page; the wrapper log at the bottom of it. |
| "The library folder is empty" | The library path is not mounted on the host, or `LIBRARY_PATH` is wrong. |
| Search fails, downloads work | Apple changed its web player; see `catalog.py`. |
| A job fails with "N of M tracks downloaded" | The job log. Usually a track without a lossless version. |

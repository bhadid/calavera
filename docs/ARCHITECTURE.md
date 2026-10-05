# Architecture

## Overview

```
 browser ──HTTP──▶ app container                          wrapper container
                   ┌───────────────────────────────┐      ┌──────────────────────────┐
                   │ FastAPI  (calavera.api)       │      │ supervisor.py   :12341   │
                   │   /api/*      JSON            │─────▶│   /health /login /2fa    │
                   │   /api/events Server-Sent     │      │   starts and restarts ▼  │
                   │   /*          built frontend  │      │ wrapper-lite    :12340   │
                   │ JobManager (calavera.jobs)    │      │   Apple session,         │
                   │   amdl ──────────────────────────────▶   decryption API        │
                   │   ffmpeg, mutagen             │      └──────────────────────────┘
                   └───────────────────────────────┘
                     │ /data     SQLite: queue, history, settings
                     │ /staging  one folder per job
                     ▼ /library  the music library (import target)
```

Only the app's port is published. The wrapper's two ports are reachable from
the app container only.

## Repository layout

```
compose.yaml              both services and every version pin
.github/
  workflows/upstream-check.yml   weekly check of the amdl and wrapper-lite pins
  scripts/check-upstream.sh      the check itself; opens issues, changes nothing
  dependabot.yml                 dependency update pull requests
.env.example              host-specific settings
wrapper/
  Dockerfile              builds wrapper-lite from source at a pinned commit
  supervisor.py           process supervisor + sign-in control API (stdlib only)
app/
  Dockerfile              frontend build, amdl download, tests, runtime image
  backend/
    requirements.in       direct dependencies; requirements.txt is the generated lock
    calavera/
      __main__.py         starts uvicorn
      config.py           deployment facts from the environment
      settings.py         user-changeable settings (one pydantic model)
      db.py               SQLite: jobs, job logs, key/value
      urls.py             Apple Music link parsing
      catalog.py          catalogue search and lookup
      wrapper.py          client for wrapper-lite and the supervisor
      amdl.py             amdl config, process runner, output parser
      audio.py            probing, FLAC conversion and verification, tag clean-up
      library.py          the never-overwrite library import
      jobs.py             queue, worker and the pipeline
      api.py              HTTP routes, events, static files, request guard
    tests/                pytest; runs in the Dockerfile's `test` stage
  frontend/
    src/
      main.tsx, App.tsx   entry and routes
      lib/                api client, types, store (jobs, status, toasts), theme
      components/         Layout (top bar, tab bar, status line), JobCard,
                          AlbumGrid, Cover, Icon, Controls (switch, segmented
                          control), Confirm (confirmation dialog)
      pages/              Queue, Search, Artist, Settings, Account
      styles.css          design tokens and all styles
```

## The job pipeline

`JobManager._run` in `jobs.py`, one job at a time:

1. **Preflight.** Fails early, before any download, if the wrapper is not
   signed in, the library is unusable, or staging has under 1 GB free. If the
   album's folder already exists in the library, the job ends as `skipped`
   without downloading.
2. **Download.** amdl runs with a config file generated for this job and
   writes Apple Lossless files to `<staging>/<job id>/music/<Artist>/<Album>/`.
   Its output is parsed line by line for progress. The job only continues if
   amdl exits with 0 and its summary says every track completed with no
   errors.
3. **Verify.** Every track must be ALAC, have a duration and a title tag (an
   unfinished track has none).
4. **Convert** (if FLAC is on). Per track: ffmpeg writes the FLAC, tags are
   normalised, sample rate and bit depth must match the source, and the
   decoded audio of both files must have the same MD5. Only then is the `.m4a`
   deleted.
5. **Import.** `library.import_album` applies the library rules.
6. **Clean up.** Staging is deleted when everything was imported, kept
   otherwise.

Each stage is one method. A new stage (for example "ask Navidrome to scan")
is a new method called from `_run`.

### Why Calavera converts instead of amdl

amdl can convert to FLAC itself, but it deletes the original without checking
the result. Calavera runs the same ffmpeg command and adds the verification,
and it rewrites ffmpeg's generic tag names into the ones FLAC tools expect
(`ALBUMARTISTSORT`, `TRACKTOTAL`, front-cover picture type, no MP4 container
leftovers).

### Why per-job staging

Each job has its own amdl config pointing at its own folder, so "which files
belong to this job" is never inferred from timestamps, and a failed job cannot
contaminate the next one.

## State

| What | Where | Lost when |
|---|---|---|
| Apple session | `wrapper-session` volume | `docker compose down -v` |
| Supervisor control token | `control` volume | same; recreated on start |
| Queue, history, logs, settings | `data/calavera.db` (SQLite, WAL) | the file is deleted |
| Downloads in progress | `STAGING_PATH/<job id>/` | job finishes or is discarded |

On start, jobs found in `running` state are marked `interrupted`.

## Live updates

`GET /api/events` is a Server-Sent Events stream of three event types:
`job` (full job object), `removed` (job id) and `log` (one log line). The
frontend loads the job list once and then applies events; on every reconnect
it reloads the list. Progress events are throttled to about three per second.

## Sign-in

```
browser ─POST /api/account/login─▶ app ─POST /login─▶ supervisor
                                                         │ stops the serving wrapper-lite
                                                         │ runs: wrapper-lite --login <id>:<pw> --code-from-file
                                                         │ sees "2FA: true" in its output
browser ◀─ status: awaiting_2fa (polled via /api/status) ┘
browser ─POST /api/account/code──▶ app ─POST /login/2fa─▶ supervisor writes 2fa.txt
                                                         │ wrapper-lite reads it, stores tokens, exits 0
                                                         └ supervisor starts the serving wrapper-lite again
```

The supervisor requires a bearer token on every request. It creates the token
on first start in the `control` volume, which only these two containers mount.
The password exists in the supervisor only until the sign-in process has been
started, and it is masked in any wrapper output that echoes it.

## Security model

- No user accounts. Protection is network placement (`BIND_ADDRESS`).
- State-changing requests whose `Origin` header names another site are
  refused, so a web page open in the same browser cannot drive Calavera.
- A Content-Security-Policy allows the page's own files and artwork from
  Apple's image CDN only, and forbids framing.
- The app container runs as an unprivileged user (`PUID:PGID`).
- The wrapper container is not privileged but runs with seccomp and AppArmor
  unconfined and unmasked `/proc`, which wrapper-lite's rootless launcher
  needs to create its namespaces.

## Interface design

The look combines three things, all implemented in `styles.css`:

- **Neo-brutalism:** 2 px ink borders, hard offset shadows without blur, flat
  status colours, buttons that move when pressed.
- **Terminal:** a single monospace family from the system (no web fonts),
  prompt glyphs, a status line under the top bar, text progress bars and a
  terminal pane for logs.
- **Apple's Human Interface Guidelines** for behaviour: 44 pt touch targets,
  16 px inputs, a bottom tab bar with safe-area insets on phones, switches and
  segmented controls for settings, status given as text and symbol as well as
  colour, a confirmation before destructive actions, reduced motion
  respected, light and dark themes following the system.

The accent is pink. The logo is the favicon artwork with a frame drawn over
its edge and a pink offset shadow in both themes.

## Extending

| To add… | Touch |
|---|---|
| a setting | `settings.py` (field + default), where it is used, `pages/Settings.tsx`, `lib/types.ts` |
| a pipeline stage | a method in `jobs.py`, called from `_run`; a label in `STAGE` in `JobCard.tsx` |
| a link type (e.g. playlists) | `urls.py` (`SUPPORTED_KINDS`), `JobManager._collect` (folder layout), `_describe` |
| an API endpoint | `api.py`, `lib/api.ts`, `lib/types.ts` |
| a page | `pages/`, a `<Route>` in `App.tsx`, optionally `NAV` in `Layout.tsx` |
| a colour or theme | the token block at the top of `styles.css` |

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
  workflows/ci.yml               tests, image build and colour check on every push
  workflows/upstream-check.yml   weekly check of the amdl and wrapper-lite pins
  scripts/check-upstream.sh      the check itself; opens issues, changes nothing
  dependabot.yml                 dependency update pull requests
.env.example              host-specific settings
scripts/
  browser-smoke.mjs       read-only browser test of the main routes
  check-accent.mjs        contrast check of every accent colour choice
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
      memory.py           short memory for catalogue answers
      wrapper.py          client for wrapper-lite and the supervisor
      amdl.py             amdl config, process runner, output parser
      audio.py            probing, FLAC conversion and verification, tag clean-up
      library.py          the never-overwrite library import and merge
      plan.py             which tracks of an album to download (pure functions)
      jobs.py             queue, worker and the pipeline
      api.py              HTTP routes, events, static files, request guard
    tests/                pytest; runs in the Dockerfile's `test` stage
  frontend/
    src/
      main.tsx, App.tsx   entry and routes
      lib/                api client, types, store (jobs, status, toasts), theme,
                          accent colour
      components/         Layout (top bar, tab bar, status line), JobCard,
                          AlbumGrid, ArtistNames, StaleNote, Cover, Icon, Skull (logo),
                          Controls (switch, segmented control), Confirm
                          (confirmation dialog)
      pages/              Queue, Search, Album (song selection), Artist,
                          Song (forwards to the album), Settings, Account
      styles.css          design tokens and all styles
```

## The job pipeline

`JobManager._run` in `jobs.py`, one job at a time:

1. **Preflight.** Fails early, before any download, if the wrapper is not
   signed in, the library is unusable, or staging has under 1 GB free.
2. **Plan** (`plan.py`, album jobs). The catalogue says which songs exist
   and which of them Apple actually offers. Left out: songs that are not
   available, songs outside an explicit selection, and, in merge mode, tracks
   the album folder already has. A plain album job whose folder exists ends
   here as `skipped`; so does any job with nothing left to download.
3. **Download.** amdl runs with a config file generated for this job and
   writes Apple Lossless files to `<staging>/<job id>/music/<Artist>/<Album>/`.
   It gets the album link when the whole album is wanted, otherwise one song
   link per wanted track, all in a single run. Its output is parsed line by
   line for progress. The job only continues if amdl exits with 0 and
   reports every requested track completed with no errors.
4. **Verify.** Every track must be ALAC, have a duration and a title tag (an
   unfinished track has none).
5. **Convert** (if FLAC is on). Per track: ffmpeg writes the FLAC, tags are
   normalised, sample rate and bit depth must match the source, and the
   decoded audio of both files must have the same MD5. Only then is the `.m4a`
   deleted.
6. **Import.** `library.import_album` applies the library rules; in merge
   mode `library.merge_album` adds only missing tracks to an existing folder.
7. **Clean up.** Staging is deleted when everything was imported, kept
   otherwise.

Job options, stored with the job: `track_ids` (only these songs), `merge`
(may add to an existing album folder; set for song selections, single songs
and the "add missing" / "keep tracks" actions) and `resume`.

**Resuming.** `POST /api/jobs/{id}/import` re-runs a finished job in merge
mode. If the job still has tracks in staging, nothing is downloaded: tracks
that do not decode completely are dropped, the rest go through steps 4 to 7.
That is "Keep N tracks" after a failed download. Without staged tracks the
job runs from the start in merge mode ("Add missing tracks").

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

## Going easy on Apple's catalogue

One page costs few requests: a search, an album or an artist one, a page of
an artist's group one per 100 releases as it is scrolled to. Finding the
releases outside Apple's grouping costs one per 100 releases and per 100 in
each group (see "Artist pages"). `catalog.py` holds two safeguards:

- If Apple answers "too many requests" (HTTP 429), nothing more is sent
  until the pause it names is over (at least one minute, at most fifteen).
  Requests in that time fail at once with a message saying so.
- The search for releases outside Apple's grouping stops at 300 releases
  (`ARTIST_ALBUMS`).

`memory.py` keeps Apple's answers for a while, so that going back to a page
does not ask again: searches and artist pages for 15 minutes, albums for an
hour, an album's quality for a day, at most 300 answers. They are held in the
process only; a restart forgets them.

- Reloading a page in the browser, or pressing the Search button, asks Apple
  afresh (`fresh=1` on the catalogue routes; `lib/api.ts` adds it for the
  page that was reloaded).
- If Apple cannot be reached, or has asked for a pause, an answer up to a
  day old is shown with a line saying when it is from (`stale_since`,
  `components/StaleNote.tsx`). Something Apple says no longer exists is
  forgotten instead.
- "In library" is not remembered: it is worked out from the library folder
  on every request.
- A download never plans from memory. `jobs.py` asks the catalogue directly,
  so during a pause a new job fails with the pause message and can be
  retried afterwards.

An album page also shows the quality on offer in numbers. Apple's
catalogue only says "lossless" (up to 24-bit / 48 kHz) or "hi-res lossless"
(24-bit, above 48 kHz); the numbers are in a song's stream description, a
small playlist file on Apple's download servers. The album request already
returns the address of the public one, so `Catalog.album_quality` costs one
download of that file for one song (the first with the album's best quality)
and no further catalogue request. The page asks for it after it has appeared,
and shows the tag alone if no answer comes. Other songs of the album are
assumed to match.

The public file is right for lossless albums but can leave out an album's
hi-res versions. Those are listed in full only in the description Apple
gives a signed-in device, which the downloader gets through the wrapper.
Calavera does not ask for that one while browsing, so that browsing stays
anonymous. A hi-res album whose public file names no hi-res rate therefore
shows the range of rates hi-res can have, "24-bit / 88.2–192 kHz". If the
file names one, the range starts there ("96–192 kHz"), and 192 kHz, the
highest there is, stands alone.

Unrelated to Apple, the queue page shows its history 50 jobs at a time
(`HISTORY_STEP` in `pages/Queue.tsx`).

## Artist pages

Laid out as in Apple's Music app. `pages/Artist.tsx` shows a row
(`components/Shelf.tsx`) for each group of Apple's own grouping of the
artist's releases (`views` on the artist): albums, singles and EPs, live
albums, compilations, appears on. Apple sends the first few of each group
with the artist, so the page needs one request. Each row leads to the whole
group, `/artist/<id>/<group>` (`pages/ArtistGroup.tsx`), which fetches 100
releases at a time as the end of the list comes near and keeps what it has
loaded, and where it was scrolled to, for the way back from an album.

Apple's grouping leaves out releases it counts as the same as another, which
can be a different version under the same title (a radio edit, a re-release
on another label). So that nothing is hidden, the group page also asks for
`/api/catalog/artists/<id>/others`: `catalog.artist_albums` reads the full
list (`/artists/<id>/albums`) and every page of the grouping, and returns the
releases in the list but not in the grouping. Each joins the group of the
release with the same title, and its card says "Other release" and names
the label; without one it goes by its title (" - Single" or " - EP" at the
end, or Apple's single flag, which Apple sets only for one-song releases,
make it a single; anything else is an album). They are shown at the end of
the group page once the list is complete.

*All releases* under the artist's name opens `/artist/<id>/all`: every
release Apple lists for the artist in one grid, newest first. Apple sorts the
full list itself (`sort=-releaseDate`), so this page also loads 100 at a time
as it is scrolled. Nothing is left out there; releases under the same title
(which usually share their date and so arrive together) show their label.

## Artist links

Apple prints who made an album or song as one line of text (`artist`, e.g.
"A & B"). `catalog.py` also asks for the artists behind it (`artists`: ID and
name of each), and `components/ArtistNames.tsx` links each name found in the
line to `/artist/<id>`. A job stores the artists with its title (`jobs.artists`,
JSON); `db.py` adds that column to a database made before it existed. Where
Apple names no artist (compilations) the line stays plain text.

Album names link to `/album/<id>` the same way. A song has no page: its
album's ID is read from the song's Apple Music link (`songAlbumPath` in
`lib/format.ts`). A queue card of a song job knows the song's ID only and
links to `/song/<id>`, where `pages/Song.tsx` looks the album up and goes on
to it.

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

Symbols follow one rule. Actions and notices use drawn icons from
`components/Icon.tsx` (one rounded stroke style), so they look the same on
every device. Status tags are words; the green ones (done, in library) also carry the
drawn check mark. A few marks are typed characters
on purpose, because they should look like terminal output: the status-line
marks, the prompt before page titles, the log toggle and the text progress
bar.

The accent colour is the user's choice (Settings → Appearance): a hue
slider and a depth slider, or monochrome. `lib/accentColour.ts` calculates
every shade from them in the OKLCH colour model, where a fixed lightness
looks equally light at every hue. Each shade has its own lightness; the depth
slider moves that of the accent fills, down to a floor below which black
text on them would be too faint, so text on an accent fill stays readable
wherever the sliders are. Each shade is as vivid as sRGB allows for its hue,
up to a cap. The result is set as `--ac-*` variables on the root element,
which the tokens in `styles.css` read, with the default (hue 21, depth 5: a
red) as their fallback. The choice is kept in
the browser's local storage together with the calculated shades, so
`public/theme.js` can apply them before first paint.
`scripts/check-accent.mjs` checks the contrast of all 360 hues at every
depth and of monochrome, and that the fallbacks in `styles.css` match the
calculation.

The logo (`components/Skull.tsx`) is a skull with headphones: white bone,
and lines in a further shade of the chosen hue calculated like the others.
The areas outside the outer contour are see-through. With monochrome there
is no bone, only the lines: black in the light theme, white in the dark one.
The "Logo fill" switch removes the bone with a colour as well. `public/favicon.svg`
is the same drawing in the default colour and always keeps its bone, so that
it shows on any tab bar. When another accent is chosen, `lib/accent.ts` recolours
that file and sets the result as the
browser-tab icon; a browser that ignores the change keeps the default one.

## Extending

| To add… | Touch |
|---|---|
| a setting | `settings.py` (field + default), where it is used, `pages/Settings.tsx`, `lib/types.ts` |
| a pipeline stage | a method in `jobs.py`, called from `_run`; a label in `STAGE` in `JobCard.tsx` |
| a link type (e.g. playlists) | `urls.py` (`SUPPORTED_KINDS`), `JobManager._collect` (folder layout), `_describe` |
| an API endpoint | `api.py`, `lib/api.ts`, `lib/types.ts` |
| a page | `pages/`, a `<Route>` in `App.tsx`, optionally `NAV` in `Layout.tsx` |
| a colour or theme | the token block at the top of `styles.css`; accent shades in `lib/accentColour.ts` |

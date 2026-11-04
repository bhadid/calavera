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
compose.yaml              both services, their security options
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
  Dockerfile              builds wrapper-lite from source at a pinned commit; runs as user 10001
  supervisor.py           process supervisor + sign-in control API (stdlib only)
app/
  Dockerfile              frontend build, amdl download (pinned), tests, runtime image
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
      lib/hooks/          page logic: search, album selection, artist pages,
                          adding links, job actions, settings, sign-in
      components/         Layout (sidebar, tab bar, banners), tiles (grid spans,
                          artwork colours, Cover, Notice), AlbumTile, JobLog,
                          ArtistNames, DotsLogo (logo), Icon, Controls (switch,
                          segmented control), Confirm (alert), CoverViewer
      pages/              Search (start page), Queue, Album (song selection),
                          Artist, ArtistGroup, Song (forwards to the album),
                          Settings, Account
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
   mode `library.merge_album` adds only missing tracks to an existing folder,
   and nothing if the folder's files carry another barcode than the new ones
   (another edition under the same title). Planning makes the same check
   against Apple's barcode for the album, so such a job does not download.
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

Apple's grouping leaves out releases it counts as another edition of one it
shows: a deluxe or standard edition, a remaster, a re-release on another
label, or a single next to the EP with the same song. So that nothing is hidden, the group page also asks for
`/api/catalog/artists/<id>/others`: `catalog.artist_albums` reads the full
list (`/artists/<id>/albums`) and every page of the grouping, and returns the
releases in the list but not in the grouping. Each joins the group of the
release with the same title; without one it goes by its title (" - Single"
or " - EP" at the end, or Apple's single flag, which Apple sets only for
one-song releases, make it a single; anything else is an album). The group
page mixes them in next to the release with the same title, or else at
their date, once the list has loaded down to that date, so that nothing
moves above what is being read. Their cards carry an *Other release* tag
that explains itself when tapped (a `popover`). The album page shows the tag
too, wherever it was opened from: a tagged card passes it on with the link
(router state), so it shows at once; otherwise the page asks
`/api/catalog/albums/<id>/other-release` once it is shown, which checks the
same `others` answer for up to three of the album's artists. That takes a few
requests per artist, remembered like an artist page, and none when the
artist's pages were just seen. Every album page names the label in the line
under the title.

*All releases* under the artist's name opens `/artist/<id>/all`: every
release Apple lists for the artist in one grid, newest first. Apple sorts the
full list itself (`sort=-releaseDate`), so this page also loads 100 at a time
as it is scrolled. Nothing is left out there; the releases outside Apple's
grouping (the same `others` answer) get their *Other release* tag once it
arrives.

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
- Requests whose `Host` header is not `BIND_ADDRESS`, a name in
  `ALLOWED_HOSTS` or `localhost`/`127.0.0.1` are refused with 421. This stops
  DNS rebinding: a page whose domain is made to resolve to Calavera's address
  sends its own domain as `Host` (and `Origin`), so the Origin check alone
  would let it through.
- State-changing requests whose `Origin` header names another site are
  refused, so a web page open in the same browser cannot drive Calavera.
- A Content-Security-Policy allows the page's own files and artwork from
  Apple's image CDN only, and forbids framing.
- Both containers run without Linux capabilities and with
  `no-new-privileges`: the app as `PUID:PGID`, the wrapper as user `10001`.
  Both have memory and process limits. The app's image is read-only; it
  writes only to `/data`, `/staging`, `/library` and a `/tmp` in memory.
- The wrapper container is not privileged but runs with seccomp and AppArmor
  unconfined and unmasked `/proc`, which wrapper-lite's rootless launcher
  needs to create its namespaces (it maps its own user to root inside them).
  Because the user is not root, the unmasked `/proc` gives no write access to
  the host's kernel settings, also not from inside those namespaces.
- The image prepares the wrapper's volume mount points owned by `10001`, and
  Docker copies that ownership into new volumes. On start the supervisor
  checks it can write every file in them; if not (volumes from 0.5.0), it does
  not start wrapper-lite and reports the one-time `chown` instead (phase
  `needs_fix`).

## Interface design

Pages are grids of rounded tiles ("bento"), following Apple's Human Interface
Guidelines. All styles are in `styles.css`, built on the tokens at its top.

- **Colour:** iOS's semantic colours: a grey page, tiles a step lighter,
  labels at full and 60 % strength, hairline separators. Light and dark follow
  the system unless chosen in Settings.
- **Type:** the system font (SF Pro on Apple devices; no web fonts), sizes in
  rem and `-apple-system-body` on Safari, so the device's text size applies.
  Large page titles; hierarchy by size and weight, not borders.
- **Layout:** a page is one column of blocks (title, search field, notices,
  grids, section headings) with the same distance `--gap` between any two;
  section headings get a larger space above. Grids have 2, 4 or 6 columns
  depending on the width of the content (container queries), and every tile
  states its span at each (`span()` in `components/tiles.tsx`). The document
  order is the reading order at every width. Few tiles: a tile is one piece of
  information or one task, and facts that belong to something (an album's
  year, quality, library state) sit in its tile as text and labels.
- **Navigation:** a translucent sidebar on wide screens, with the status of
  Apple Music, the library and the live connection at its foot; a tab bar on
  phones. Search is the start page.
- **Artwork colours:** tiles showing one cover (the album page, the top
  search result, the download in progress) take the background and text
  colours Apple picked from it, when the text has 4.5:1 contrast on it.
- **Behaviour:** 44 pt touch targets, 17 px inputs, safe-area insets, iOS
  switches, segmented controls and alerts, a confirmation before destructive
  actions, status in words and symbols as well as colour,
  `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast` respected.

Icons are drawn in `components/Icon.tsx` in the manner of SF Symbols (SF
Symbols themselves may only be used in apps on Apple platforms).

The accent is monochrome by default, or one of a few colours (Settings →
Appearance). `lib/accentColour.ts` calculates every shade in the OKLCH colour
model, where a fixed lightness looks equally light at every hue, and moves a
shade further where a hue still needs it for contrast:

- `--ac-b-*`: the accent, for buttons, links and all-good status. Text on it
  is white in the light appearance and black in the dark one.
- `--ac-b2-*`: the second colour, for status that needs attention, at the hue
  of the logo's highlight.
- `--ac-dot-*`: the logo's three dot colours, a light and a dark set.

In monochrome the second colour and the logo keep the shades of the default
hue, so they stay in colour. The shades are set as variables on the root
element, which the tokens in `styles.css` read, with monochrome as their
fallback. The choice is kept in the browser's local storage together with the
calculated shades, so `public/theme.js` can apply them before first paint.

The logo (`components/DotsLogo.tsx`, drawn from
`components/halftone-skull.svg`) is a halftone skull and crossbones in dots of
three colours: edge, bone and highlight. Each keeps the distance in hue,
lightness and chroma from the accent that the drawing has at the default hue,
so the default's dark set is the drawing's own colours and every other hue
turns all three together. On a light page the bone is dark and the other two
are deeper, so it shows on both. Its box is a square cropped close around
the dots, so the skull fills whatever size it is drawn at.
`public/favicon.svg` is the logo in the default shades, with the light or
dark set chosen by the browser's own appearance, and the smallest dots drawn
a little larger so they still show as dots at 16 px; with a colour chosen,
`lib/accent.ts` draws the tab icon in its shades. `public/apple-touch-icon.png`
(180 × 180, for the iOS home screen) is the logo on the drawing's dark tile.

`scripts/check-accent.mjs` checks the contrast of every hue and of
monochrome, that the fallbacks in `styles.css` match the calculation, that the
logo's default shades are the drawing's, and that `public/favicon.svg` is up
to date (`scripts/favicon.mjs` writes it).

## Extending

| To add… | Touch |
|---|---|
| a setting | `settings.py` (field + default), where it is used, `pages/Settings.tsx`, `lib/types.ts` |
| a pipeline stage | a method in `jobs.py`, called from `_run`; a label in `STAGE` in `pages/Queue.tsx` |
| a link type (e.g. playlists) | `urls.py` (`SUPPORTED_KINDS`), `JobManager._collect` (folder layout), `_describe` |
| an API endpoint | `api.py`, `lib/api.ts`, `lib/types.ts` |
| a page | `pages/`, a `<Route>` in `App.tsx`, optionally `NAV` in `Layout.tsx` |
| a colour or theme | the token block at the top of `styles.css`; accent shades in `lib/accentColour.ts` |

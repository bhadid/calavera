# Deploying Calavera

Everything needed to put Calavera on a server, check that it works, keep it
up to date, and take it down again. It is written so that a person or an
automated agent can follow it from a fresh host to a working install
without further questions, except for the values in the first section,
which belong to your network and are not in this repository.

- [Before you start](#before-you-start)
- [1. Prepare the host](#1-prepare-the-host)
- [2. Install](#2-install)
- [3. Behind a reverse proxy](#3-behind-a-reverse-proxy)
- [4. Media server scans](#4-media-server-scans)
- [5. Start and sign in](#5-start-and-sign-in)
- [6. Check that it works](#6-check-that-it-works)
- [Operating](#operating)
- [Updating](#updating)
- [Moving to another host, or retiring one](#moving-to-another-host-or-retiring-one)
- [Troubleshooting](#troubleshooting)

## Before you start

### What the host needs

- Linux on x86-64. ARM is not supported: the images fetch x86-64 builds
  (amdl's binary, for one).
  Developed and in daily use on Debian 12.
- Docker Engine with the Compose plugin (`docker compose version` works).
  Rootless Docker, Podman and SELinux hosts are untested.
- About 1.5 GB for the images, a few GB of staging space, and outbound
  HTTPS to Apple and GitHub. Building the `wrapper` image downloads about
  1 GB and takes several minutes.

### Values to collect first

| Value | Example | Goes into |
|---|---|---|
| Address the UI is published on | `192.168.1.20` or `127.0.0.1` | `BIND_ADDRESS` |
| Port | `8080` | `WEB_PORT` |
| Host names it is opened by (reverse proxy, local DNS) | `calavera.home.example` | `ALLOWED_HOSTS` |
| Path of the music library **on the host** | `/mnt/music` | `LIBRARY_PATH` |
| Numeric user and group that own the library's files | `1000` / `1000` | `PUID` / `PGID` |
| Timezone | `Europe/Berlin` | `TZ` |
| Optional: media server URL, user, password | `https://music.home.example`, `calavera` | `SUBSONIC_*` |
| The Apple ID that signs in | – | typed into the UI, never into a file |

### Rules that hold for every install

- **One Calavera per Apple ID, and one per library.** Stop the old instance
  before starting a new one that uses the same Apple ID or writes to the
  same library (see [Moving](#moving-to-another-host-or-retiring-one)).
- **The UI has no login of its own.** Anyone who can reach it can queue
  downloads and start an Apple sign-in. Publish it on a trusted LAN address,
  or on `127.0.0.1` behind your own reverse proxy; never on a public
  interface.
- **Calavera never overwrites, renames or deletes anything in the library**
  ([library rules](../README.md#library-rules)). Nothing else in this guide
  writes there either: none of the steps below needs write access to the
  library from outside the container.

### Notes for automated agents

You can do every step here on your own except two, which need the person
who owns the install:

- **Signing in to Apple** needs their Apple ID password and a two-factor
  code from their device. Hand them the URL of the Account page.
- **Secrets** (`SUBSONIC_PASSWORD`) come from them. Put them only into
  `.env` (mode `600`), never into a commit, an issue or a log.

Do not run `docker compose down -v` on an instance that works (it deletes the
Apple session), do not write to the library path yourself, and ask before
stopping an instance that has a job running.

## 1. Prepare the host

### The music library

`LIBRARY_PATH` must exist, contain at least one entry and be writable by
`PUID:PGID`. Calavera refuses to write to an empty folder, because an empty
folder usually means a network share that is not mounted.

**On a network share** (NFS, SMB), the share must be mounted by the host
before Docker starts, and come back by itself after a reboot. With NFS, for
example, an `/etc/fstab` line like:

```
nas.home.example:/export/music  /mnt/music  nfs4  _netdev,nofail,x-systemd.automount  0 0
```

`x-systemd.automount` mounts it on first access, so it is there even if the
NAS comes up after the host. The container sees a mount that appears later
as well (the bind uses `rslave` propagation).

**File ownership.** With NFS (`sec=sys`) the NAS checks the numeric user ID,
not the name. Set `PUID`/`PGID` to the numbers that own the library on the
share, which can differ from your login on the new host:

```bash
stat -c '%u:%g %A' /mnt/music          # e.g. 1000:1000 drwxrwx---
```

Check that this user can write there (the `.calavera-check` file is
removed again at once):

```bash
sudo setpriv --reuid=1000 --regid=1000 --clear-groups \
  sh -c 'touch /mnt/music/.calavera-check && rm /mnt/music/.calavera-check && echo writable'
```

If this fails while the numbers match, the share maps users (NFS
`root_squash` does not matter here, `all_squash` does) or is exported
read-only.

### Staging

`STAGING_PATH` holds one download at a time (a few hundred MB to a few GB
for a Hi-Res album) and is emptied after each import. Keep it on a local
disk, not on the library's share: the import copies from staging to the
library and reads every file back, which is twice the network traffic if
both are on the NAS. The default `./data/staging` is fine.

### The host clock

Start Docker only after the clock is right. Apple's servers reject a session
that is used with a wrong time, and once that happens it stays rejected:
downloads fail until someone signs in again. This has happened in practice,
after a server booted with its hardware clock years off; the time was
corrected within minutes, but the containers had already started.

This is a host setting and affects all containers. On Debian and other
systemd hosts with `systemd-timesyncd`, make Docker wait for the first time
synchronisation, for at most three minutes:

```bash
sudo systemctl enable systemd-time-wait-sync.service
sudo mkdir -p /etc/systemd/system/systemd-time-wait-sync.service.d /etc/systemd/system/docker.service.d
printf '[Service]\nTimeoutStartSec=3min\n' | sudo tee /etc/systemd/system/systemd-time-wait-sync.service.d/timeout.conf
printf '[Unit]\nWants=time-sync.target\nAfter=time-sync.target\n' | sudo tee /etc/systemd/system/docker.service.d/wait-for-time-sync.conf
sudo systemctl daemon-reload
```

Docker by itself waits only for `time-set.target`, which is reached as soon
as the clock has *some* value, for example the time saved at the last
shutdown. `time-sync.target` waits until the time has actually been
synchronised over the network. Without the timeout, a host that cannot
reach a time server would never start Docker. If Calavera did start with a
wrong clock, it says so: the account shows *Session expired*.

## 2. Install

Use the latest release tag from
[Releases](https://github.com/bhadid/calavera/releases) rather than `main`:

```bash
git clone --branch v0.8.8 https://github.com/bhadid/calavera.git
cd calavera
cp .env.example .env
chmod 600 .env
mkdir -p data/staging
```

Then edit `.env`:

| Variable | Meaning |
|---|---|
| `BIND_ADDRESS` | Address the UI is published on: the host's LAN IP, or `127.0.0.1`. Required. |
| `WEB_PORT` | Port of the UI. Default `8080`. |
| `ALLOWED_HOSTS` | Other host names the UI is opened by, comma-separated: a local DNS name, or the reverse proxy's host name. Requests for any other name are refused (protection against DNS rebinding). `BIND_ADDRESS`, `localhost` and `127.0.0.1` are always accepted. |
| `LIBRARY_PATH` | The music library on the host. Required. Must exist, must not be empty, and be writable by `PUID:PGID`. |
| `STAGING_PATH` | Scratch space for downloads in progress. Default `./data/staging`. |
| `TZ` | Timezone, e.g. `Europe/Berlin`. Used for times in the logs. |
| `PUID` / `PGID` | Numeric owner of the files written to the library and to `data/`. |
| `SUBSONIC_URL` / `SUBSONIC_USER` / `SUBSONIC_PASSWORD` | Optional, see [Media server scans](#4-media-server-scans). |

`data/` and the staging folder must be writable by `PUID:PGID` too; if you
ran `mkdir` as another user, `chown` them.

Build the images:

```bash
docker compose build
```

To build each image straight from a tag in a compose file of your own
instead, use `build: https://github.com/bhadid/calavera.git#v0.8.8:app` (or
`…:wrapper`), and copy `security_opt`, `cap_drop`, volumes and ports from
`compose.yaml`: the wrapper does not start without its three relaxed
options (`compose.yaml` explains each).

## 3. Behind a reverse proxy

Calavera speaks plain HTTP; a reverse proxy in front of it can add HTTPS
and a host name. Three things matter:

1. **Put the proxy's host name into `ALLOWED_HOSTS`.** Otherwise every
   request is answered with *421: Calavera does not answer to the host
   name …*.
2. **Pass the original `Host` header on.** Calavera refuses a change
   (`POST`, `PUT`, `DELETE`) whose `Origin` names a different host than
   `Host` (*403: Cross-site request refused*). Caddy passes it on by
   default; with nginx set `proxy_set_header Host $host;`.
3. **Do not buffer responses.** The Queue page gets live updates over
   Server-Sent Events (`/api/events`), and downloads to the device can be
   large. Calavera sends `X-Accel-Buffering: no`, which nginx obeys; Caddy
   does not buffer these anyway.

Where the proxy runs decides `BIND_ADDRESS`:

| Proxy | `BIND_ADDRESS` | Proxy points at |
|---|---|---|
| On another machine | this host's LAN IP | `<LAN IP>:<WEB_PORT>` |
| On this host, installed directly | `127.0.0.1` | `127.0.0.1:<WEB_PORT>` |
| On this host, in a Docker container | this host's LAN IP, or a shared Docker network (below) | `<LAN IP>:<WEB_PORT>` or `calavera-app-1:8080` |

Caddy, for example:

```
calavera.home.example {
	reverse_proxy 192.168.1.20:8080
}
```

nginx:

```nginx
location / {
    proxy_pass http://192.168.1.20:8080;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
}
```

With the LAN IP bound, the UI stays reachable directly too. To allow only
the proxy, filter the port in the host's firewall. Docker's published ports
bypass `INPUT` rules, so the rule goes into the `DOCKER-USER` chain.

**Sharing a Docker network** with a proxy or media server in another
Compose project needs no change to `compose.yaml`. A
`compose.override.yaml` next to it is read automatically, and git ignores
it, so updates leave it alone:

```yaml
services:
  app:
    networks: [default, proxy]
networks:
  proxy:
    external: true
    name: proxy          # the network the other project created
```

`BIND_ADDRESS` is still required; set it to `127.0.0.1` if nothing should
reach the UI except through that network.

## 4. Media server scans

A media server on another machine does not notice new files on a network
share. With a server that speaks the Subsonic API (Navidrome, gonic and
others) set up, Calavera asks it to scan after each import. Set
`SUBSONIC_URL`, `SUBSONIC_USER` and `SUBSONIC_PASSWORD` in `.env`.

`SUBSONIC_URL` is any address that the `app` container can reach:

- **The media server's normal URL**, e.g. through your reverse proxy
  (`https://music.home.example`). This is the simplest choice. With
  `https`, the certificate must be from a public certificate authority
  (Let's Encrypt and the like): the container trusts only those, not a
  private CA such as Caddy's `tls internal`.
- **Its LAN address and port**, e.g. `http://192.168.1.20:4533`.
- **Its container name on a shared Docker network**, e.g.
  `http://navidrome:4533`, with the network added as shown
  [above](#3-behind-a-reverse-proxy). Plain HTTP is fine here, as the
  traffic never leaves the host.

The user must be allowed to start scans (in Navidrome: an admin); a
separate user just for Calavera is a good idea. The password stays in
`.env`; the UI never shows or takes it, and it is sent only as Subsonic's
salted token, which can still be replayed by anyone who reads the traffic,
so use `https` across a network you do not trust. A media server that
cannot be reached never fails a job. The README's
[Media server scans](../README.md#media-server-scans) section describes how
it behaves in use.

## 5. Start and sign in

```bash
docker compose up -d
docker compose ps        # app: "healthy" after about 15 seconds
```

Open `http://<BIND_ADDRESS>:<WEB_PORT>` (or the proxy's URL), go to
**Account** (the status pill in the top right) and sign in with the Apple ID
and password; a field for the two-factor code appears if Apple asks for one.
The password is not stored. On a network you do not trust, sign in from the
terminal instead:

```bash
docker compose exec wrapper python3 /app/supervisor.py login
```

More in the README under [Signing in](../README.md#signing-in).

## 6. Check that it works

Work through these in order; each one rules out a different part.

1. **Containers:** `docker compose ps` shows both running and `app` as
   `healthy`.
2. **Status:** in the UI, the pill reads *Signed in*, and the Queue page
   shows no problem notice. Or, from the host:

   ```bash
   curl -s http://<BIND_ADDRESS>:<WEB_PORT>/api/status | python3 -m json.tool
   ```

   Expect `wrapper.ready: true`, `wrapper.auth.ok: true` and
   `library.ok: true`.
3. **Proxy:** open the UI by its proxy URL, and on *Settings* change any
   setting and change it back. That is a change request through the
   proxy; a 403 or 421 points to [the proxy rules](#3-behind-a-reverse-proxy).
4. **Media server**, if set up: *Settings → Media server → Test connection*.
5. **Downloading, without touching the library:** open any album, choose one
   song, and press the **download arrow** (to this device, not *Add to
   library*). The job runs through the Queue and ends as *Ready to
   download*. That proves the Apple session, the decryption keys and the
   FLAC conversion. Remove the job afterwards.
6. **The library:** add one song or single you want anyway with *Add to
   library*. It should end as *In library*, and appear under
   `<LIBRARY_PATH>/<Artist>/<Album>/` with the owner `PUID:PGID`, and in the
   media server after its scan.

## Operating

```bash
docker compose ps
docker compose logs -f app        # or: wrapper
docker compose stop               # keep everything, stop running
docker compose down               # remove containers; session, queue and settings are kept
```

| What | Where | Kept by |
|---|---|---|
| Apple session | `wrapper-session` Docker volume | restarts, rebuilds, `down`; **not** `down -v` |
| Queue, history, settings | `data/calavera.db` | everything except deleting `data/` |
| Downloads in progress | `STAGING_PATH` | emptied after each import |

Both containers restart by themselves after a reboot (`restart:
unless-stopped`). A download running during a restart becomes
*Interrupted*; *Retry* runs it again.

## Updating

New versions are listed under
[Releases](https://github.com/bhadid/calavera/releases), each with notes on
what changed and anything to do when upgrading. Look at the Queue first: a
running download is interrupted by the restart. Then, in the cloned folder:

```bash
docker tag calavera-app:local calavera-app:rollback        # for going back
docker tag calavera-wrapper:local calavera-wrapper:rollback
git fetch --tags
git checkout vX.Y.Z          # the release you are updating to
docker compose build
docker compose up -d
```

`.env`, `compose.override.yaml`, the Apple session, the queue, history and
settings are kept. Then run checks 2 and 5 from
[Check that it works](#6-check-that-it-works).

**Going back:** `git checkout` the previous tag, then
`docker tag calavera-app:rollback calavera-app:local` (and the same for
`wrapper`) and `docker compose up -d`. Or simply build the previous tag
again.

### Upgrading from 0.5.0 or older

Since 0.6.0 the wrapper runs as user `10001` instead of root. The files that
older versions left in its two volumes belong to root, so once, after
`docker compose build`:

```bash
docker compose stop wrapper
docker compose run --rm --no-deps --user 0 --cap-add CHOWN --entrypoint chown wrapper -R 10001:10001 /app/rootfs/data /control
docker compose up -d
```

The Apple session is kept. Without this step the wrapper does not start, and
the Account page shows this command.

### The pinned components

Versions are pinned in the two Dockerfiles, so an image built from a tag
always gets the same components:

| Component | Pin | Where |
|---|---|---|
| wrapper-lite | commit `e51e370a6b0660ed9d722fff1add079098aeb935` | `wrapper/Dockerfile` → `ARG WRAPPER_REF` |
| amdl | release `v0.1.4` + SHA-256 of the binary | `app/Dockerfile` → `ARG AMDL_VERSION`, `ARG AMDL_SHA256` |
| ffmpeg | static 7.1, image digest | `app/Dockerfile` |
| Python packages | direct ones in `requirements.in`, full lock generated | `app/backend/requirements.txt` |
| JavaScript packages | lockfile | `app/frontend/package-lock.json` |

To change one yourself, edit the pin, then `docker compose build && docker
compose up -d`, and run check 5. Calavera reads amdl's terminal output (see
`app/backend/calavera/amdl.py`), so after changing amdl download one whole
album and look at the result. There is no need to follow every upstream
release: update when something stops working or when you want a new
feature.

### Finding out about updates

In a copy kept on GitHub (a fork, for example), two things watch for
updates:

- **`.github/workflows/upstream-check.yml`** runs every Monday and compares
  the amdl and wrapper-lite pins with upstream. If either is behind, it
  opens an issue (label `upstream`) with the new version, the changes and
  the exact lines to put into the Dockerfile, including amdl's checksum. It
  never changes anything itself. Run it by hand under *Actions → Upstream
  check → Run workflow*, or locally with
  `DRY_RUN=1 .github/scripts/check-upstream.sh` (needs `curl` and `jq`).
- **Dependabot** (`.github/dependabot.yml`) opens weekly pull requests for
  Calavera's own dependencies. Image tags set through build arguments
  (`PYTHON_VERSION`, `NODE_VERSION`, `DEBIAN_VERSION`) and the ffmpeg
  digest are not updated by it.

## Moving to another host, or retiring one

A new install starts empty: no queue, no history, default settings, and a
new Apple sign-in. The library is not part of an install, so a new host can
use the same library as before.

**Retiring the old instance**, in its cloned folder:

1. On the Queue page, wait until nothing is queued or running (or cancel
   it). Check that nothing is waiting under *Ready to download* or
   *Keep N tracks* that you still want.
2. Stop it and remove its containers, volumes and images:

   ```bash
   docker compose down -v --rmi all
   ```

   `-v` deletes the Apple session, so the old host cannot be started by
   accident with the same Apple ID later. Images tagged `:rollback` by an
   update are not removed by this; `docker image rm` them as well.
3. Delete the cloned folder (it holds `.env`, `data/` and the staging
   folder; nothing in it is part of the library). Remove the old host's
   entry from the reverse proxy if it is no longer used.

Do this before signing in on the new host.

**Keeping the queue history and settings** instead of starting empty: after
step 1, `docker compose stop`, copy `data/calavera.db` to the new install's
`data/` before its first start, and make it owned by the new `PUID:PGID`.
Do not copy the `wrapper-session` volume; sign in again on the new host.

## Troubleshooting

| Symptom | Look at |
|---|---|
| A page says *Calavera does not answer to the host name …* (421) | Add that name to `ALLOWED_HOSTS` in `.env`, then `docker compose up -d`. |
| *Cross-site request refused* (403) on every change | The reverse proxy changes the `Host` header; pass the original on. |
| Queue shows no live progress behind a proxy | The proxy buffers `/api/events`; turn buffering off for it. |
| "Wrapper offline" | `docker compose logs wrapper`. `unshare` or `mount ... failed` means the `security_opt` entries in `compose.yaml` are not in effect. |
| "Wrapper needs a fix" | Volumes from 0.5.0 or older still belong to root; see [Upgrading from 0.5.0 or older](#upgrading-from-050-or-older). |
| Jobs fail with "Not signed in" | The Account page, and the wrapper log at the bottom of it. |
| "Session expired" | Apple stopped accepting the session: `createMusicToken failed` or `Invalid CKC error` in `docker compose logs wrapper`. Sign in again. A host that started with a wrong clock can cause it; see [The host clock](#the-host-clock). |
| "The library folder is empty" | The share is not mounted on the host, or `LIBRARY_PATH` is wrong. `ls <LIBRARY_PATH>` on the host. |
| "The library folder is not writable" | `PUID`/`PGID` do not match the owner on the share, or the share is exported read-only; see [The music library](#the-music-library). |
| Media server test fails with a certificate error | The media server's certificate is from a private CA; use its `http://` LAN or container address instead. |
| Search fails, downloads work | Apple changed its web player; `app/backend/calavera/catalog.py` needs an update. |
| A job fails with "N of M tracks downloaded" | The message gives amdl's reason; the job log has the rest. A refused `/key` means the session expired. |
| `lyrics http status=404` in the wrapper log | Harmless: Apple has no lyrics for that song, which is then saved without them. |

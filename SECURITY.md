# Security

## Reporting a vulnerability

Please report it privately, not in a public issue: on the repository's
**Security** tab, choose **Report a vulnerability**. Say what you found, how
to reproduce it and which version or commit you used.

Calavera is a personal project maintained in spare time. Reports are read
and answered as soon as that allows; there is no guaranteed response time.

Only the latest release and the `main` branch receive fixes.

## What Calavera protects, and what it does not

Calavera is built to run on a private network. These points are by design
and described in the [README](README.md) and in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); they are not vulnerabilities:

- The web UI has no login. Anyone who can reach its port can use it.
- The web UI is served over plain HTTP.
- The wrapper container runs with relaxed seccomp, AppArmor and `/proc`
  settings, which wrapper-lite needs.
- During a sign-in, the Apple ID password is visible in the wrapper
  container's process list.

Worth reporting, for example:

- a way to make Calavera overwrite, rename or delete files in the library,
  or write outside the library and staging folders;
- a way for a web page on another site to act on a running Calavera;
- the Apple ID password or the session ending up in a log, a file or an API
  response;
- reaching the wrapper's ports from outside the Compose network with the
  shipped `compose.yaml`.

## Other projects

[amdl](https://github.com/zhaarey/apple-music-downloader),
[wrapper-lite](https://github.com/WorldObservationLog/wrapper) and ffmpeg are
separate programs that Calavera fetches at build time. Problems in them
belong with their maintainers; a problem in how Calavera uses them belongs
here.

# Contributing

Calavera is a personal project maintained in spare time. Bug reports and
small fixes are welcome. Larger changes may be declined if they do not fit
where the project is going, so please open an issue before you put work into
one.

## Reporting a bug

Open an issue with:

- what you did, what you expected and what happened;
- the Calavera version (Settings page) and how you run Docker;
- the job's log from the queue page, if a download is involved.

Leave out anything personal: your Apple ID, tokens, and library paths you do
not want public. Security problems go through [SECURITY.md](SECURITY.md)
instead of an issue.

Not something an issue here can help with: Apple accounts and
subscriptions, and faults in
[amdl](https://github.com/zhaarey/apple-music-downloader) or
[wrapper-lite](https://github.com/WorldObservationLog/wrapper) themselves.

## Changing the code

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains how to build, run and
test; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the parts
fit together. Everything builds in Docker; the host needs no Python or Node.

For a pull request:

- Keep it to one change, with a commit message that says what changes for
  the user.
- The checks in `.github/workflows/ci.yml` must pass: backend tests, the
  app image build (which type-checks the frontend) and the accent colour
  check.
- Anything that writes to the music library goes through `library.py` and
  keeps its rules: nothing existing is overwritten, renamed or deleted. A
  new rule needs a test.
- Use a scratch folder as the library while developing, never a real one.
- Follow the conventions listed in DEVELOPMENT.md, and update the README
  and the docs when behaviour changes.
- Pin versions; no `latest`.

## Licence of contributions

Calavera is licensed under `AGPL-3.0-only` (see [LICENSE](LICENSE)). By
contributing you agree that your contribution is under the same licence, and
you confirm that you wrote it yourself or have the right to submit it. Do
not copy code from other projects unless its licence allows use under the
AGPL, and say where it comes from if you do.

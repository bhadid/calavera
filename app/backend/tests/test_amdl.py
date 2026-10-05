from pathlib import Path

from calavera import amdl
from calavera.settings import Settings

OUTPUT = """\
lite-server regions: [de]
Queue 1 of 1: Album
Hatebreed
The Concrete Confessional
Track 1 of 13: songs
01. A.D.
24-bit / 44100 Hz
Downloading...  50%  (20/40 MB, 66 MB/s)
Downloading...  100%  (40/40 MB, 66 MB/s)
Downloaded
Decrypting...  50%  (20/40 MB, 19 MB/s)
Decrypted
Track 2 of 13: songs
02. Looking Down the Barrel of Today
"""


def feed(text: str) -> tuple[amdl.Progress, list[str]]:
    progress, kept = amdl.Progress(), []
    for line in text.splitlines():
        if not progress.feed(line):
            kept.append(line)
    return progress, kept


def test_progress_follows_tracks_and_drops_progress_bar_lines():
    progress, kept = feed(OUTPUT)
    assert (progress.track, progress.total) == (2, 13)
    assert progress.quality == "24-bit / 44.1 kHz"
    assert not any(line.startswith(("Downloading...", "Decrypting...")) for line in kept)
    assert "Downloaded" in kept
    assert 1 / 13 <= progress.fraction < 2 / 13


def test_fraction_within_a_track():
    progress, _ = feed("Track 1 of 4: songs\nDownloading...  50%  (1/2 MB)")
    assert progress.fraction == 0.0625  # half of the download half of track 1 of 4
    progress.feed("Decrypting...  100%  (2/2 MB)")
    assert progress.fraction == 0.25


def test_clean_summary():
    progress, _ = feed("=======  [✔ ] Completed: 13/13  |  [⚠ ] Warnings: 0  |  [✖ ] Errors: 0  =======")
    assert progress.summary.clean


def test_failed_track_is_not_clean():
    progress, _ = feed("=======  [✔ ] Completed: 14/15  |  [⚠ ] Warnings: 0  |  [✖ ] Errors: 1  =======")
    assert not progress.summary.clean
    assert (progress.summary.completed, progress.summary.total, progress.summary.errors) == (14, 15, 1)


def test_no_summary_means_no_result():
    assert feed("Error connecting to lite-server")[0].summary is None


def test_config_points_downloads_at_the_job_folder_and_never_converts():
    cfg = amdl.build_config(Settings(language="en-GB", max_sample_rate=96000), "http://wrapper:12340", "de", Path("/staging/j1/music"))
    assert cfg["paths"]["alac"] == "/staging/j1/music"
    assert cfg["general"]["lite-server"] == "http://wrapper:12340"
    assert cfg["general"]["exit-on-error"] is True
    assert cfg["media"]["alac-max"] == 96000
    assert cfg["convert"]["after-download"] is False

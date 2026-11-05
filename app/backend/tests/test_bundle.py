"""The ZIP made while it is sent: valid, complete, and exactly as long as announced."""
import io
import os
import zipfile

import pytest

from calavera import bundle


def make_album(root, files):
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return root


def build(entries, chunk=bundle.CHUNK):
    return b"".join(bundle.zip_stream(entries, chunk))


FILES = {
    "01 Intro.flac": os.urandom(300_000),
    "02 Café del Mar.flac": os.urandom(2_500_000),
    "03 Ünïcödé – Song.lrc": "[00:01.00]la".encode(),
    "cover.jpg": os.urandom(50_000),
    "empty.txt": b"",
}


def test_the_archive_holds_every_file_unchanged(tmp_path):
    album = make_album(tmp_path / "Artist" / "Album", FILES)
    entries = bundle.entries_for([("Artist - Album", album)])
    data = build(entries, chunk=64 * 1024)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.testzip() is None
        assert sorted(z.namelist()) == sorted(f"Artist - Album/{n}" for n in FILES)
        for name, content in FILES.items():
            info = z.getinfo(f"Artist - Album/{name}")
            assert info.compress_type == zipfile.ZIP_STORED
            assert z.read(info) == content


@pytest.mark.parametrize("names", [
    ["a.flac"],
    ["01 Song.flac", "02 Song.flac", "cover.jpg"],
    ["Ünïcödé/日本語.flac", "plain.flac"],
])
def test_the_announced_size_is_the_real_size(tmp_path, names):
    root = make_album(tmp_path / "x", {n: os.urandom(1000 + 37 * i) for i, n in enumerate(names)})
    entries = bundle.entries_for([("Folder", root)])
    assert bundle.zip_size(entries) == len(build(entries))


def test_the_announced_size_holds_with_zip64_parts(tmp_path, monkeypatch):
    # Lower the ZIP64 threshold so small files take the ZIP64 paths for sizes,
    # offsets and the end records.
    monkeypatch.setattr(zipfile, "ZIP64_LIMIT", 5000)
    root = make_album(tmp_path / "x", {"big.flac": os.urandom(6000), "small.flac": os.urandom(100), "late.jpg": os.urandom(4000)})
    entries = bundle.entries_for([("Folder", root)])
    data = build(entries)
    assert bundle.zip_size(entries) == len(data)
    monkeypatch.undo()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.read("Folder/big.flac") == (root / "big.flac").read_bytes()


def test_several_albums_get_their_own_folders(tmp_path):
    a = make_album(tmp_path / "A" / "One", {"01 x.flac": b"1"})
    b = make_album(tmp_path / "B" / "Two", {"01 y.flac": b"2"})
    entries = bundle.entries_for([("A - One", a), ("B - Two", b)])
    with zipfile.ZipFile(io.BytesIO(build(entries))) as z:
        assert z.namelist() == ["A - One/01 x.flac", "B - Two/01 y.flac"]

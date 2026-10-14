import hashlib
import os

import pytest

from calavera import library


def tree(root):
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in filenames:
            p = os.path.join(dirpath, name)
            out.append((os.path.relpath(p, root), hashlib.md5(open(p, "rb").read()).hexdigest()))
        out += [(os.path.relpath(os.path.join(dirpath, d), root) + "/", "") for d in dirnames]
    return sorted(out)


@pytest.fixture
def lib(tmp_path):
    root = tmp_path / "library"
    (root / "Other Artist" / "Old Album").mkdir(parents=True)
    (root / "Other Artist" / "Old Album" / "keep.flac").write_text("precious")
    return root


@pytest.fixture
def album(tmp_path):
    src = tmp_path / "staging" / "New Artist" / "Album One"
    src.mkdir(parents=True)
    (src / "01. a.flac").write_bytes(b"audio" * 1000)
    (src / "cover.jpg").write_bytes(b"jpeg")
    return src


def test_new_artist_and_album_are_created(lib, album):
    before = tree(lib)
    result = library.import_album(album, lib, "New Artist", "Album One")
    assert result.status == "imported" and result.path == "New Artist/Album One"
    assert (lib / "New Artist" / "Album One" / "01. a.flac").read_bytes() == b"audio" * 1000
    assert (lib / "New Artist" / "Album One" / "cover.jpg").exists()
    assert all(entry in tree(lib) for entry in before)          # nothing existing changed
    assert not any(e.startswith(".") for e in os.listdir(lib / "New Artist"))  # no temp folder left
    assert album.exists()                                        # the source is the caller's to remove


def test_existing_artist_folder_is_reused_case_insensitively(lib, album):
    (lib / "new artist").mkdir()
    result = library.import_album(album, lib, "New Artist", "Album One")
    assert result.status == "imported" and result.path == "new artist/Album One"
    assert not (lib / "New Artist").exists()


def test_existing_album_is_skipped_and_untouched(lib, album):
    (lib / "New Artist" / "ALBUM ONE").mkdir(parents=True)
    (lib / "New Artist" / "ALBUM ONE" / "old.mp3").write_text("old")
    before = tree(lib)
    result = library.import_album(album, lib, "New Artist", "Album One")
    assert result.status == "exists" and result.path == "New Artist/ALBUM ONE"
    assert tree(lib) == before


def test_empty_library_is_treated_as_unmounted(tmp_path, album):
    empty = tmp_path / "empty"
    empty.mkdir()
    result = library.import_album(album, empty, "New Artist", "Album One")
    assert result.status == "failed" and "not mounted" in result.message
    assert os.listdir(empty) == []


def test_missing_library(tmp_path, album):
    assert library.import_album(album, tmp_path / "nope", "A", "B").status == "failed"


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores directory permissions")
def test_read_only_library(lib, album):
    lib.chmod(0o555)
    try:
        result = library.import_album(album, lib, "New Artist", "Album One")
    finally:
        lib.chmod(0o755)
    assert result.status == "failed" and "not writable" in result.message


def test_copy_error_leaves_no_album_folder(lib, album, monkeypatch):
    monkeypatch.setattr(library, "_sha256", lambda _p: "different")
    before = tree(lib)
    result = library.import_album(album, lib, "New Artist", "Album One")
    assert result.status == "failed" and "checksum mismatch" in result.message
    assert not (lib / "New Artist" / "Album One").exists()
    assert all(entry in tree(lib) for entry in before)


def test_find_album_uses_the_downloaders_folder_names(lib):
    (lib / "Daniil Trifonov" / "BACH_ The Art of Life").mkdir(parents=True)
    assert library.find_album(lib, "Daniil Trifonov", "BACH: The Art of Life") == "Daniil Trifonov/BACH_ The Art of Life"
    assert library.find_album(lib, "daniil trifonov", "bach: the art of life") == "Daniil Trifonov/BACH_ The Art of Life"
    assert library.find_album(lib, "Daniil Trifonov", "Something Else") is None
    assert library.find_album(lib, "Nobody", "Nothing") is None


def test_album_path_names_the_existing_or_the_future_folder(lib):
    (lib / "Daniil Trifonov" / "BACH_ The Art of Life").mkdir(parents=True)
    assert library.album_path(lib, "daniil trifonov", "bach: the art of life") == "Daniil Trifonov/BACH_ The Art of Life"
    # A new album goes into the artist folder as it is spelled on disk.
    assert library.album_path(lib, "DANIIL TRIFONOV", "Silver Age") == "Daniil Trifonov/Silver Age"
    assert library.album_path(lib, "AC/DC", "Back in Black - Single") == "AC_DC/Back in Black - Single"


# ---- merging into an existing album folder ------------------------------------
@pytest.fixture
def partial(lib):
    """An album folder that already holds track 1 (as .m4a) and a cover."""
    folder = lib / "New Artist" / "Album One"
    folder.mkdir(parents=True)
    (folder / "01. a.m4a").write_bytes(b"old alac")
    (folder / "cover.jpg").write_bytes(b"old cover")
    return folder


def test_merge_adds_only_missing_tracks(lib, album, partial):
    (album / "02. b.flac").write_bytes(b"new" * 500)
    before = tree(lib)
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert (result.status, result.added, result.skipped) == ("imported", 1, 1)
    assert (partial / "02. b.flac").read_bytes() == b"new" * 500
    assert all(entry in tree(lib) for entry in before)                 # every old file unchanged
    assert (partial / "01. a.m4a").read_bytes() == b"old alac"         # not replaced by the .flac
    assert not (partial / "01. a.flac").exists()
    assert (partial / "cover.jpg").read_bytes() == b"old cover"        # existing cover kept
    assert not any(e.startswith(".") for e in os.listdir(partial))     # no temp files left


def test_merge_with_nothing_new_touches_nothing(lib, album, partial):
    before = tree(lib)
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert (result.status, result.added, result.skipped) == ("exists", 0, 1)
    assert tree(lib) == before


def test_merge_without_existing_folder_is_a_normal_import(lib, album):
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert (result.status, result.added) == ("imported", 1)
    assert (lib / "New Artist" / "Album One" / "cover.jpg").exists()


def test_merge_matches_folders_and_tracks_case_insensitively(lib, album):
    folder = lib / "new artist" / "ALBUM ONE"
    folder.mkdir(parents=True)
    (folder / "01. A.mp3").write_text("old")
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert result.status == "exists" and result.path == "new artist/ALBUM ONE"


def test_merge_checksum_failure_adds_nothing_and_cleans_up(lib, album, partial, monkeypatch):
    (album / "02. b.flac").write_bytes(b"new")
    monkeypatch.setattr(library, "_sha256", lambda _p: "different")
    before = tree(lib)
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert result.status == "failed" and result.added == 0
    assert tree(lib) == before


def test_place_never_replaces_an_existing_file(tmp_path):
    final = tmp_path / "track.flac"
    final.write_text("original")
    tmp = tmp_path / ".tmp"
    tmp.write_text("new")
    assert library._place(tmp, final) is False
    assert final.read_text() == "original" and not tmp.exists()


def test_merge_into_unmounted_library_fails(tmp_path, album):
    empty = tmp_path / "empty"
    empty.mkdir()
    assert library.merge_album(album, empty, "A", "B").status == "failed"


def test_the_folders_barcode_comes_from_its_files(lib, monkeypatch):
    folder = lib / "deadmau5" / "while(1_2)"
    folder.mkdir(parents=True)
    for name in ("01. a.flac", "02. b.flac", "cover.jpg"):
        (folder / name).write_bytes(b"x")
    codes = {"01. a.flac": None, "02. b.flac": "00883958012772"}
    monkeypatch.setattr(library.audio, "read_barcode", lambda path: codes.get(path.name, "wrong"))
    assert library.folder_barcode(folder) == "00883958012772"
    assert library.folder_barcode(lib / "nothing") is None


@pytest.mark.parametrize("a, b, same", [
    ("00883958012772", "883958012772", True),
    ("00883958012772", "0883958012772", True),
    ("00883958012772", "00883958013243", False),
    ("", "", False),
])
def test_barcodes_differ_only_in_leading_zeros(a, b, same):
    assert library.same_barcode(a, b) is same


def test_merge_never_mixes_two_editions(lib, album, partial, monkeypatch):
    (album / "02. b.flac").write_bytes(b"new" * 500)
    barcodes = {partial: "00883958012772", album: "00883958013243"}
    monkeypatch.setattr(library.audio, "read_barcode", lambda path: barcodes.get(path.parent))
    result = library.merge_album(album, lib, "New Artist", "Album One")
    assert result.status == "failed" and "different edition" in result.message
    assert sorted(os.listdir(partial)) == ["01. a.m4a", "cover.jpg"]
    # The same edition, with fewer leading zeros in one of them, is merged.
    barcodes[album] = "883958012772"
    assert library.merge_album(album, lib, "New Artist", "Album One").status == "imported"

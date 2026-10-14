import pytest

from calavera import audio


def test_alac_is_converted_verified_and_the_source_removed(tmp_path, make_track):
    src = make_track(tmp_path / "01. Song.m4a", bits=24, rate=96000)
    before = audio.decoded_md5("ffmpeg", src)
    dst = audio.convert_to_flac("ffmpeg", src)
    assert dst.name == "01. Song.flac" and dst.exists() and not src.exists()
    info = audio.probe(dst)
    assert (info.codec, info.sample_rate, info.bit_depth, info.title) == ("flac", 96000, 24, "Song")
    assert audio.decoded_md5("ffmpeg", dst) == before
    assert dst.stat().st_mode & 0o777 == 0o644


def test_tags_survive_conversion(tmp_path, make_track):
    from mutagen.flac import FLAC
    dst = audio.convert_to_flac("ffmpeg", make_track(tmp_path / "a.m4a"))
    tags = {k.lower(): v for k, v in FLAC(dst).tags}
    assert tags["title"] == "Song" and tags["artist"] == "Artist" and "la la" in tags["lyrics"]


def test_flac_tags_are_conventional(tmp_path, make_track):
    from mutagen.flac import FLAC
    from mutagen.mp4 import MP4, MP4Cover
    src = make_track(tmp_path / "a.m4a")
    m = MP4(src)
    m["trkn"], m["disk"] = [(3, 13)], [(1, 2)]
    m["aART"], m["soar"], m["soal"], m["soaa"], m["sonm"] = ["AA"], ["Sort A"], ["Sort Al"], ["Sort AA"], ["Sort T"]
    # a 1x1 JPEG as cover art
    jpeg = bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a"
        "1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f"
        "0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d010203"
        "00041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738"
        "393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2"
        "a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7"
        "f8f9faffda0008010100003f00fbfcffd9"
    )
    m["covr"] = [MP4Cover(jpeg, imageformat=MP4Cover.FORMAT_JPEG)]
    m.save()

    f = FLAC(audio.convert_to_flac("ffmpeg", src))
    tags = {k: v for k, v in f.tags}
    assert tags["TRACKNUMBER"] == "3" and tags["TRACKTOTAL"] == "13"
    assert tags["DISCNUMBER"] == "1" and tags["DISCTOTAL"] == "2"
    assert tags["ALBUMARTIST"] == "AA" and tags["ALBUMARTISTSORT"] == "Sort AA"
    assert tags["ARTISTSORT"] == "Sort A" and tags["ALBUMSORT"] == "Sort Al" and tags["TITLESORT"] == "Sort T"
    assert not {"MAJOR_BRAND", "COMPATIBLE_BRANDS", "ENCODER", "CREATION_TIME"} & set(tags)
    assert all(k == k.upper() for k in tags)
    assert [p.type for p in f.pictures] == [3]


def test_untagged_track_is_refused_and_left_alone(tmp_path, make_track):
    src = make_track(tmp_path / "a.m4a", title=None)
    with pytest.raises(audio.AudioError, match="no title tag"):
        audio.convert_to_flac("ffmpeg", src)
    assert src.exists() and not src.with_suffix(".flac").exists()


def test_non_alac_source_is_refused(tmp_path, make_track):
    src = make_track(tmp_path / "a.m4a", codec="aac")
    with pytest.raises(audio.AudioError, match="expected alac"):
        audio.convert_to_flac("ffmpeg", src)
    assert src.exists()


def test_failed_verification_keeps_the_source(tmp_path, make_track, monkeypatch):
    src = make_track(tmp_path / "a.m4a")
    digests = iter(["MD5=aaa", "MD5=bbb"])
    monkeypatch.setattr(audio, "decoded_md5", lambda *_: next(digests))
    with pytest.raises(audio.AudioError, match="same audio"):
        audio.convert_to_flac("ffmpeg", src)
    assert src.exists() and not src.with_suffix(".flac").exists()


def test_cut_off_download_is_detected_by_decoding(tmp_path, make_track):
    whole = make_track(tmp_path / "whole.m4a")
    audio.check_decodes("ffmpeg", whole)                      # a complete file passes
    cut = tmp_path / "cut.m4a"
    data = whole.read_bytes()
    cut.write_bytes(data[: len(data) * 2 // 3])               # header intact, audio data missing
    with pytest.raises(audio.AudioError, match="incomplete or damaged"):
        audio.check_decodes("ffmpeg", cut)


def test_truncated_file_is_reported(tmp_path):
    bad = tmp_path / "a.m4a"
    bad.write_bytes(b"not audio")
    with pytest.raises(audio.AudioError):
        audio.probe(bad)


def test_the_barcode_is_read_from_any_tagging_style(tmp_path, make_track):
    from mutagen.flac import FLAC
    from mutagen.mp4 import MP4, MP4FreeForm

    flac = make_track(tmp_path / "a.flac", codec="flac")
    f = FLAC(flac)
    f["UPC"] = "00883958012772"
    f.save()
    assert audio.read_barcode(flac) == "00883958012772"

    m4a = make_track(tmp_path / "b.m4a")
    m = MP4(m4a)
    m["----:com.apple.iTunes:UPC"] = [MP4FreeForm(b"00883958013243")]
    m.save()
    assert audio.read_barcode(m4a) == "00883958013243"

    other = make_track(tmp_path / "c.flac", codec="flac")
    f = FLAC(other)
    f["BARCODE"] = "883958012772"
    f.save()
    assert audio.read_barcode(other) == "883958012772"


def test_no_barcode_is_none(tmp_path, make_track):
    assert audio.read_barcode(make_track(tmp_path / "a.flac", codec="flac")) is None
    (tmp_path / "broken.flac").write_bytes(b"not audio")
    assert audio.read_barcode(tmp_path / "broken.flac") is None

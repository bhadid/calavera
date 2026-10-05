from calavera import library
from calavera.plan import make_plan, track_file_stem


def track(n, name, available=True):
    return {"id": str(100 + n), "name": name, "track_number": n, "available": available}


ALBUM = [track(1, "One"), track(2, "Two", available=False), track(3, "Three: Part 1"), track(4, "Four")]


def test_file_stem_matches_the_downloaders_naming():
    assert track_file_stem(ALBUM[2]) == "03. Three_ Part 1"


def test_whole_album_leaves_out_unavailable_songs():
    plan = make_plan(ALBUM, None, None)
    assert [t["id"] for t in plan.wanted] == ["101", "103", "104"]
    assert [t["id"] for t in plan.unavailable] == ["102"]
    assert not plan.whole_album
    assert plan.note() == "1 song is not available on Apple Music"


def test_fully_available_album_is_a_single_link():
    plan = make_plan([track(1, "One"), track(2, "Two")], None, None)
    assert plan.whole_album and plan.note() == ""


def test_selection_only_considers_selected_songs():
    plan = make_plan(ALBUM, ["102", "104"], None)
    assert [t["id"] for t in plan.wanted] == ["104"]
    assert [t["id"] for t in plan.unavailable] == ["102"]
    assert not plan.whole_album


def test_tracks_already_in_the_library_are_left_out_in_any_format():
    present = {library.track_key("01. one.m4a"), library.track_key("03. Three_ Part 1.flac")}
    plan = make_plan(ALBUM, None, present)
    assert [t["id"] for t in plan.wanted] == ["104"]
    assert [t["id"] for t in plan.owned] == ["101", "103"]
    assert plan.note() == "1 song is not available on Apple Music; 2 are already in the library"


def test_titles_containing_dots_are_matched_whole():
    tracks = [track(1, "Mr. Brightside"), track(2, "Mr. Nobody")]
    plan = make_plan(tracks, None, {library.track_key("01. Mr. Brightside.flac")})
    assert [t["name"] for t in plan.owned] == ["Mr. Brightside"]
    assert [t["name"] for t in plan.wanted] == ["Mr. Nobody"]


def test_nothing_left_to_download():
    plan = make_plan(ALBUM, ["102"], None)
    assert plan.wanted == [] and len(plan.unavailable) == 1

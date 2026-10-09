from calavera.catalog import _album, _artists, _song


def related(*artists):
    return {"artists": {"data": [{"id": i, "type": "artists", **({"attributes": {"name": n}} if n else {})} for i, n in artists]}}


def test_artists_come_from_the_relationship():
    item = {"id": "1", "attributes": {"artistName": "A & B"}, "relationships": related(("10", "A"), ("11", "B"))}
    assert _artists(item) == [{"id": "10", "name": "A"}, {"id": "11", "name": "B"}]
    assert _album(item)["artists"] == _artists(item)
    assert _album(item)["artist"] == "A & B"
    assert _song(item)["artists"] == _artists(item)


def test_no_relationship_means_no_artists():
    assert _artists({"id": "1", "attributes": {"artistName": "Various Artists"}}) == []
    assert _album({"id": "1"})["artists"] == []
    assert _song({"id": "1", "relationships": {"artists": {"data": []}}})["artists"] == []


def test_artists_without_a_name_are_left_out():
    # Apple sends bare references when the relationship was not asked for.
    assert _artists({"relationships": related(("10", None), ("11", "B"))}) == [{"id": "11", "name": "B"}]

import pytest

from calavera import urls


def test_album_link_is_normalised():
    u = urls.parse("https://music.apple.com/de/album/the-concrete-confessional/1463549484?l=en-GB")
    assert (u.kind, u.storefront, u.apple_id) == ("album", "de", "1463549484")
    assert u.url == "https://music.apple.com/de/album/1463549484"


def test_album_link_with_track_parameter_is_a_song():
    u = urls.parse("https://music.apple.com/us/album/some-album/1624945511?i=1624945512")
    assert (u.kind, u.apple_id) == ("song", "1624945512")
    assert u.url == "https://music.apple.com/us/song/1624945512"


def test_song_link_without_slug():
    assert urls.parse("https://music.apple.com/de/song/1440507524").kind == "song"


@pytest.mark.parametrize("bad", [
    "",
    "not a url",
    "https://example.com/de/album/x/123",
    "https://music.apple.com/de/playlist/hits/pl.3950454ced8c45a3b0cc693c2a7db97b",
    "https://music.apple.com/de/artist/hatebreed/3231036",
    "ftp://music.apple.com/de/album/x/123",
    "https://music.apple.com/de/album/x/not-a-number",
])
def test_unsupported_links_are_rejected_with_a_message(bad):
    with pytest.raises(urls.UnsupportedUrl) as e:
        urls.parse(bad)
    assert str(e.value)

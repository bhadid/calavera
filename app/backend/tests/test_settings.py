import pytest
from pydantic import ValidationError

from calavera.settings import Settings


def test_defaults():
    s = Settings()
    assert s.flac is True and s.max_sample_rate == 96000 and s.language == "" and s.storefront == ""


def test_unknown_stored_keys_are_ignored():
    assert Settings(**{"flac": False, "removed_option": 1}).flac is False


@pytest.mark.parametrize("field,value", [
    ("max_sample_rate", 12345), ("language", "english!"), ("storefront", "germany"), ("cover_size", 10),
])
def test_invalid_values_are_rejected(field, value):
    with pytest.raises(ValidationError):
        Settings(**{field: value})


@pytest.mark.parametrize("language", ["", "en-GB", "de-DE", "zh-Hans-CN", "ja"])
def test_language_tags(language):
    assert Settings(language=language).language == language

"""User-changeable settings, stored in the database as one JSON document.

To add a setting: add a field with a default here, use it where needed, and
expose it in the frontend's Settings page. Stored documents missing the new
field pick up the default automatically.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Settings(BaseModel):
    model_config = {"extra": "ignore"}

    # Convert each ALAC track to FLAC and delete the ALAC file once the FLAC
    # has been verified to decode to identical audio.
    flac: bool = True
    # Highest sample rate to download (Hz). The best version at or below it is used.
    max_sample_rate: Literal[44100, 48000, 96000, 192000] = 96000
    # Metadata language, e.g. "en-GB". Empty: the store's default language.
    language: str = Field(default="", max_length=16, pattern=r"^([a-z]{2,3}(-[A-Za-z]{2,4}){0,2})?$")
    # Store used for search. Empty: the store of the signed-in account.
    storefront: str = Field(default="", max_length=2, pattern=r"^([a-z]{2})?$")
    # Embed synced lyrics when Apple has them.
    lyrics: bool = True
    # Embedded cover size in pixels (square).
    cover_size: Literal[1400, 3000, 5000] = 3000

"""Deciding which tracks of an album a job should download.

Pure functions, no I/O, so the rules can be tested directly:

* Songs Apple does not offer (`available` is false) are never requested.
  Leaving them out is expected, not a failure.
* With an explicit selection only the selected songs are considered.
* Tracks the library already has are left out, when the caller passes what
  the album folder contains.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import library


def track_file_stem(track: dict) -> str:
    """The file name (without extension) the downloader gives a track."""
    return f"{track['track_number']:02d}. {library.folder_name(track['name'])}"


@dataclass
class Plan:
    wanted: list[dict] = field(default_factory=list)       # to download
    unavailable: list[dict] = field(default_factory=list)  # considered, but Apple does not offer them
    owned: list[dict] = field(default_factory=list)        # considered, but already in the library
    album_tracks: int = 0                                  # tracks on the album in total

    @property
    def whole_album(self) -> bool:
        """True if the download is simply "the album": one link will do."""
        return self.album_tracks > 0 and len(self.wanted) == self.album_tracks

    def note(self) -> str:
        """One sentence for the user about what is being left out, or ""."""
        parts = []
        if self.unavailable:
            n = len(self.unavailable)
            parts.append(f"{n} {'song is' if n == 1 else 'songs are'} not available on Apple Music")
        if self.owned:
            n = len(self.owned)
            parts.append(f"{n} {'is' if n == 1 else 'are'} already in the library")
        return "; ".join(parts)


def make_plan(tracks: list[dict], selected_ids: list[str] | None, present_keys: set[str] | None) -> Plan:
    """`selected_ids` None means the whole album. `present_keys` (see
    library.track_keys) None means: do not look at the library."""
    plan = Plan(album_tracks=len(tracks))
    selection = None if selected_ids is None else set(selected_ids)
    for track in tracks:
        if selection is not None and track["id"] not in selection:
            continue
        if not track["available"]:
            plan.unavailable.append(track)
        elif present_keys is not None and library.stem_key(track_file_stem(track)) in present_keys:
            plan.owned.append(track)
        else:
            plan.wanted.append(track)
    return plan

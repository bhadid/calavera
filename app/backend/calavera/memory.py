"""A short memory for answers from Apple's catalogue.

Going back to a page, or opening it again a little later, does not have to
ask Apple again. Answers are kept in the process only: nothing is written to
disk and a restart forgets everything. Each kind of answer has a lifetime
after which it is asked for anew. An answer past its lifetime is still used,
and reported as old, when Apple cannot be reached.

Only what Apple said is remembered. What depends on the library ("in
library") is worked out on every request, and a download never plans from
memory: `jobs.py` asks the catalogue directly.
"""
from __future__ import annotations

import copy
import time
from collections.abc import Awaitable, Callable, Hashable
from typing import Any

from .catalog import CatalogError, NotInCatalog

# Lifetimes in seconds. New releases show up in searches and on artist pages,
# an album changes rarely, the quality it is offered in hardly ever.
SEARCH = ARTIST = 15 * 60
ALBUM = 60 * 60
QUALITY = 24 * 60 * 60


class Memory:
    def __init__(self, limit: int = 300, keep: float = 24 * 60 * 60, clock: Callable[[], float] = time.time) -> None:
        self._limit = limit  # answers kept; the oldest go first
        self._keep = keep  # an answer older than this is never used
        self._clock = clock
        self._answers: dict[Hashable, tuple[float, Any]] = {}

    async def get(
        self, key: Hashable, lifetime: float, fetch: Callable[[], Awaitable[Any]], fresh: bool = False
    ) -> tuple[Any, float | None]:
        """The answer for `key`: remembered if it is within its lifetime and
        `fresh` is not asked for, otherwise fetched and remembered.

        Returns the answer and None, or, if fetching failed and an older
        answer exists, that answer and the time it is from. The answer is the
        caller's own copy."""
        known = self._answers.get(key)
        now = self._clock()
        if known and not fresh and now - known[0] < lifetime:
            return copy.deepcopy(known[1]), None
        try:
            answer = await fetch()
        except NotInCatalog:
            self._answers.pop(key, None)  # it is gone; do not keep showing it
            raise
        except CatalogError:
            if known and now - known[0] < self._keep:
                return copy.deepcopy(known[1]), known[0]
            raise
        if answer is None:  # nothing could be told this time; ask again next time
            return None, None
        self._answers.pop(key, None)
        self._answers[key] = (now, answer)
        while len(self._answers) > self._limit:
            del self._answers[next(iter(self._answers))]
        return copy.deepcopy(answer), None

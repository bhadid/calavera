import asyncio

import pytest

from calavera.catalog import CatalogError, NotInCatalog
from calavera.memory import Memory


class Apple:
    """Stands in for the catalogue: counts requests, answers or fails."""

    def __init__(self) -> None:
        self.asked = 0
        self.fails: Exception | None = None
        self.answer: object = None

    async def fetch(self):
        self.asked += 1
        if self.fails:
            raise self.fails
        return self.answer if self.answer is not None else {"n": self.asked, "albums": []}


@pytest.fixture
def setup():
    now = [1000.0]
    apple = Apple()
    memory = Memory(limit=3, keep=1000, clock=lambda: now[0])
    get = lambda key="a", lifetime=60, fresh=False: asyncio.run(memory.get(key, lifetime, apple.fetch, fresh))  # noqa: E731
    return now, apple, get


def test_an_answer_is_reused_within_its_lifetime_and_asked_for_again_after(setup):
    now, apple, get = setup
    assert get() == ({"n": 1, "albums": []}, None)
    now[0] += 59
    assert get() == ({"n": 1, "albums": []}, None) and apple.asked == 1
    now[0] += 2
    assert get() == ({"n": 2, "albums": []}, None) and apple.asked == 2


def test_fresh_asks_again_at_once(setup):
    _, apple, get = setup
    get()
    assert get(fresh=True) == ({"n": 2, "albums": []}, None)
    # ... and what it brought back is what is remembered from then on.
    assert get() == ({"n": 2, "albums": []}, None) and apple.asked == 2


def test_what_the_caller_does_to_an_answer_is_not_remembered(setup):
    _, _, get = setup
    answer, _ = get()
    answer["albums"].append("in library")
    assert get()[0]["albums"] == []


def test_an_old_answer_is_used_and_dated_when_apple_cannot_be_reached(setup):
    now, apple, get = setup
    get()
    now[0] += 500
    apple.fails = CatalogError("paused")
    assert get() == ({"n": 1, "albums": []}, 1000.0)
    assert get(fresh=True) == ({"n": 1, "albums": []}, 1000.0)
    # Apple is asked each time: the old answer is a fallback, not a new lease.
    assert apple.asked == 3


def test_an_answer_older_than_the_keeping_time_is_not_used(setup):
    now, apple, get = setup
    get()
    now[0] += 1001
    apple.fails = CatalogError("paused")
    with pytest.raises(CatalogError):
        get()


def test_without_an_old_answer_the_error_is_passed_on(setup):
    _, apple, get = setup
    apple.fails = CatalogError("paused")
    with pytest.raises(CatalogError):
        get()


def test_what_no_longer_exists_is_forgotten_not_shown(setup):
    now, apple, get = setup
    get()
    now[0] += 61
    apple.fails = NotInCatalog("gone")
    with pytest.raises(NotInCatalog):
        get()
    apple.fails = CatalogError("paused")
    with pytest.raises(CatalogError):
        get()


def test_an_empty_handed_answer_is_not_remembered(setup):
    _, apple, get = setup

    async def nothing():
        apple.asked += 1
        return None

    memory = Memory()
    assert asyncio.run(memory.get("q", 60, nothing)) == (None, None)
    assert asyncio.run(memory.get("q", 60, nothing)) == (None, None)
    assert apple.asked == 2


def test_only_the_newest_answers_are_kept(setup):
    _, apple, get = setup
    for key in "abcd":
        get(key)
    assert apple.asked == 4
    get("d"), get("c"), get("b")
    assert apple.asked == 4  # still remembered
    get("a")
    assert apple.asked == 5  # the oldest had to go

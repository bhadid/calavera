"""Tests for the supervisor's watch on the Apple session. Standard library only:

    python3 -m unittest discover -s wrapper
"""
import unittest

from supervisor import AuthWatch

# wrapper-lite's log, as it was when Apple stopped accepting a session.
REFRESH_REFUSED = """\
[INFO ] background token refresh starting
[WARN ] createMusicToken failed: no music_token in response
[WARN ] using cached MUSIC_TOKEN (AkAsnrmK3s/IxG...)
[INFO ] token cache saved
[INFO ] background token refresh completed"""
REFRESH_OK = """\
[INFO ] background token refresh starting
[INFO ] token cache saved
[INFO ] background token refresh completed"""
DEV_TOKEN_HICCUP = """\
[INFO ] background token refresh starting
[WARN ] failed to get dev token
[WARN ] background token refresh failed"""
KEY_REFUSED = """\
[INFO ] request: GET /key?adamId=1440783123&uri=skd%3A%2F%2Fitunes.apple.com%2Fp1488041010%2Fc23
[ERROR] handler exception: Invalid CKC error."""
KEY_OK = """\
[INFO ] request: GET /key?adamId=434543346&uri=skd%3A%2F%2Fitunes.apple.com%2Fp1484015880%2Fc23
[INFO ] adamId: 434543346, uri: skd://itunes.apple.com/p1484015880/c23"""


def watch(*chunks: str) -> AuthWatch:
    w = AuthWatch()
    for n, chunk in enumerate(chunks):
        for line in chunk.splitlines():
            w.feed(line, now=float(n))
    return w


class AuthWatchTest(unittest.TestCase):
    def test_a_working_session_is_ok(self):
        self.assertEqual(watch(REFRESH_OK, KEY_OK).state(), {"ok": True, "problem": None, "since": None})

    def test_a_refused_token_refresh_is_a_problem_although_the_refresh_completes(self):
        state = watch(REFRESH_OK, REFRESH_REFUSED).state()
        self.assertFalse(state["ok"])
        self.assertIn("session token", state["problem"])
        self.assertEqual(state["since"], 1.0)

    def test_the_problem_stays_while_refreshes_keep_failing(self):
        state = watch(REFRESH_REFUSED, REFRESH_REFUSED, REFRESH_REFUSED).state()
        self.assertFalse(state["ok"])
        self.assertEqual(state["since"], 0.0)

    def test_a_good_refresh_clears_the_token_problem(self):
        self.assertTrue(watch(REFRESH_REFUSED, REFRESH_OK).state()["ok"])

    def test_a_dev_token_hiccup_is_not_a_problem(self):
        self.assertTrue(watch(DEV_TOKEN_HICCUP, REFRESH_OK).state()["ok"])
        self.assertTrue(watch(DEV_TOKEN_HICCUP).state()["ok"])

    def test_a_refused_key_is_a_problem_until_a_key_is_handed_out(self):
        state = watch(KEY_REFUSED).state()
        self.assertFalse(state["ok"])
        self.assertIn("decryption key", state["problem"])
        self.assertFalse(watch(KEY_REFUSED, REFRESH_OK).state()["ok"])
        self.assertTrue(watch(KEY_REFUSED, KEY_OK).state()["ok"])

    def test_both_signs_are_reported(self):
        state = watch(REFRESH_REFUSED, KEY_REFUSED).state()
        self.assertIn("session token", state["problem"])
        self.assertIn("decryption key", state["problem"])

    def test_signing_in_again_clears_everything(self):
        w = watch(REFRESH_REFUSED, KEY_REFUSED)
        w.reset()
        self.assertTrue(w.state()["ok"])


if __name__ == "__main__":
    unittest.main()

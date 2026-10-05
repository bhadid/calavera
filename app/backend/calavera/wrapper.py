"""Client for the wrapper container: wrapper-lite's API and the supervisor."""
from __future__ import annotations

from pathlib import Path

import httpx


class WrapperClient:
    def __init__(self, wrapper_url: str, supervisor_url: str, token_file: Path) -> None:
        self._wrapper_url = wrapper_url
        self._supervisor_url = supervisor_url
        self._token_file = token_file
        self._http = httpx.AsyncClient(timeout=5.0)

    async def close(self) -> None:
        await self._http.aclose()

    def _headers(self) -> dict[str, str]:
        # Read on every call: the supervisor creates the file on its first start.
        try:
            return {"Authorization": f"Bearer {self._token_file.read_text().strip()}"}
        except OSError:
            return {}

    async def regions(self) -> list[str]:
        """Storefronts the signed-in wrapper can serve. Empty when it is not
        reachable or not signed in."""
        try:
            resp = await self._http.get(f"{self._wrapper_url}/status")
            resp.raise_for_status()
            return list((resp.json().get("data") or {}).get("regions") or [])
        except (httpx.HTTPError, ValueError):
            return []

    async def status(self) -> dict:
        """State for the UI. Never raises."""
        state = {"reachable": False, "phase": "unreachable", "session": False, "ready": False,
                 "regions": [], "login": {"state": "idle", "message": "", "twofa_deadline": None}, "log_tail": []}
        try:
            resp = await self._http.get(f"{self._supervisor_url}/health", headers=self._headers())
            resp.raise_for_status()
            state.update(resp.json(), reachable=True)
        except (httpx.HTTPError, ValueError):
            return state
        if state["phase"] == "running":
            state["regions"] = await self.regions()
            state["ready"] = bool(state["regions"])
        return state

    async def _post(self, path: str, body: dict) -> tuple[int, dict]:
        try:
            resp = await self._http.post(f"{self._supervisor_url}{path}", json=body, headers=self._headers(), timeout=30.0)
            return resp.status_code, resp.json()
        except (httpx.HTTPError, ValueError) as e:
            return 502, {"error": f"The wrapper container did not answer ({type(e).__name__})."}

    async def login(self, email: str, password: str) -> tuple[int, dict]:
        return await self._post("/login", {"email": email, "password": password})

    async def submit_code(self, code: str) -> tuple[int, dict]:
        return await self._post("/login/2fa", {"code": code})

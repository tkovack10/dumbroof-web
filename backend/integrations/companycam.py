"""
CompanyCam Integration — Multi-Tenant API v2 Client
=====================================================
Adapted from USARM-Operations-Export/scripts/generate_inspection_pdf.py.
Each instance takes an api_key parameter for multi-tenant use.

CompanyCam has a proper REST API with Bearer token auth.
Photo URLs are in photo.uris[] — look for type "web", fallback to "original".
"""

import httpx
from typing import Any

BASE_URL = "https://api.companycam.com/v2"
REQUEST_TIMEOUT = 30


class CompanyCamAuthError(Exception):
    """Raised when CompanyCam returns 401/403 — API key invalid or account suspended."""
    pass


class CompanyCamUnavailableError(Exception):
    """Raised when CompanyCam is unreachable or returns 5xx."""
    pass


class CompanyCamClient:
    """Multi-tenant CompanyCam API v2 client."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

    async def _request(
        self, method: str, path: str, params: dict | None = None,
        raise_on_auth_error: bool = True,
    ) -> tuple[int, Any]:
        """Execute a CompanyCam API request. Returns (status_code, body).

        If raise_on_auth_error is True (default), raises CompanyCamAuthError
        on 401/403 so callers don't silently get empty results.
        """
        url = f"{BASE_URL}{path}"
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                resp = await client.request(
                    method, url, headers=self.headers, params=params
                )
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            raise CompanyCamUnavailableError(
                f"Cannot reach CompanyCam API: {e}"
            )

        if resp.status_code == 200:
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, resp.text

        # Surface auth errors clearly instead of swallowing them
        if raise_on_auth_error and resp.status_code in (401, 403):
            raise CompanyCamAuthError(
                f"CompanyCam API key is invalid or account is suspended "
                f"(HTTP {resp.status_code}). Please reconnect in Settings."
            )

        return resp.status_code, resp.text

    async def test_connection(self) -> tuple[bool, str]:
        """Test the API key by fetching the first project."""
        try:
            code, body = await self._request(
                "GET", "/projects", params={"per_page": "1"},
                raise_on_auth_error=False,
            )
            if code == 200:
                return True, "Connected to CompanyCam"
            if code == 401:
                return False, "Invalid or expired API key. Your CompanyCam account may have been suspended — generate a new API key in CompanyCam Settings → Integrations → API."
            if code == 403:
                return False, "API access denied. Check that your CompanyCam account is active and API access is enabled."
            if code == 402:
                return False, "CompanyCam account has a billing issue. Please resolve payment in CompanyCam first."
            return False, f"CompanyCam returned HTTP {code}"
        except CompanyCamUnavailableError as e:
            return False, f"Cannot reach CompanyCam — the service may be temporarily down. {e}"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def search_projects(
        self, query: str = "", per_page: int = 20, page: int = 1
    ) -> list[dict]:
        """Search projects by address/query."""
        params: dict[str, str] = {
            "per_page": str(per_page),
            "page": str(page),
        }
        if query:
            params["query"] = query

        code, body = await self._request("GET", "/projects", params=params)
        if code == 200 and isinstance(body, list):
            return body
        return []

    async def get_project(self, project_id: str) -> dict | None:
        """Get a single project by ID."""
        code, body = await self._request("GET", f"/projects/{project_id}")
        if code == 200 and isinstance(body, dict):
            return body
        return None

    async def get_project_photos(
        self, project_id: str, per_page: int = 100, page: int = 1
    ) -> list[dict]:
        """Get photos for a project. Returns list of photo objects with URIs."""
        code, body = await self._request(
            "GET",
            f"/projects/{project_id}/photos",
            params={"per_page": str(per_page), "page": str(page)},
        )
        if code == 200 and isinstance(body, list):
            return body
        return []

    async def get_all_project_photos(
        self, project_id: str, max_pages: int = 10
    ) -> list[dict]:
        """Paginate through all photos for a project."""
        all_photos: list[dict] = []
        for page in range(1, max_pages + 1):
            photos = await self.get_project_photos(
                project_id, per_page=100, page=page
            )
            if not photos:
                break
            all_photos.extend(photos)
            if len(photos) < 100:
                break
        return all_photos

    @staticmethod
    def get_photo_url(photo: dict, size: str = "web") -> str | None:
        """Extract the best download URL from a CompanyCam photo object.

        Priority: requested size → "web" → "medium" → "original"
        Photo URIs are in photo["uris"] as list of {type, uri/url}.
        """
        uris = photo.get("uris", [])
        if not uris:
            return None

        uri_map: dict[str, str] = {}
        for entry in uris:
            t = entry.get("type", "")
            u = entry.get("uri") or entry.get("url", "")
            if t and u:
                uri_map[t] = u

        for preferred in [size, "web", "medium", "original"]:
            if preferred in uri_map:
                return uri_map[preferred]

        # Fallback: return the first URI we find
        return next(iter(uri_map.values()), None)

    async def download_photo(self, url: str) -> bytes | None:
        """Download a photo by URL. Returns raw bytes."""
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp.content
        except Exception:
            pass
        return None

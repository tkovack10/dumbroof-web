"""
AccuLynx Integration — Multi-Tenant API v2 Client
====================================================
Adapted from USARM-Operations-Export/modules/acculynx/api_client.py.
Each instance takes an api_key parameter (not from env) for multi-tenant use.

Key constraints (discovered via testing on 5,270+ jobs):
- Auth: Bearer token
- Max page size: 25 (silently returns empty above this!)
- Pagination uses pageStartIndex (zero-based offset), NOT page numbers
- Rate limit: 0.3s delay recommended between calls
"""

import asyncio
import httpx
from typing import Any

BASE_URL = "https://api.acculynx.com/api/v2"
MAX_PAGE_SIZE = 25
API_DELAY = 0.3
REQUEST_TIMEOUT = 30


class AccuLynxClient:
    """Multi-tenant AccuLynx API v2 client."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(
        self, method: str, path: str, params: dict | None = None
    ) -> tuple[int, Any]:
        """Execute an AccuLynx API request. Returns (status_code, body)."""
        url = f"{BASE_URL}{path}"
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.request(
                method, url, headers=self.headers, params=params
            )
            if resp.status_code == 200:
                try:
                    return resp.status_code, resp.json()
                except Exception:
                    return resp.status_code, resp.text
            return resp.status_code, resp.text

    async def test_connection(self) -> tuple[bool, str]:
        """Test the API key by fetching the first job. Returns (ok, message)."""
        try:
            code, body = await self._request(
                "GET", "/jobs", params={"pageStartIndex": "0", "pageSize": "1"}
            )
            if code == 200:
                return True, "Connected to AccuLynx"
            if code == 401:
                return False, "Invalid API key"
            return False, f"AccuLynx returned HTTP {code}"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def search_jobs(
        self, search: str = "", page: int = 0, page_size: int = MAX_PAGE_SIZE
    ) -> list[dict]:
        """Search/list jobs. Returns list of job summaries."""
        actual_size = min(page_size, MAX_PAGE_SIZE)
        params: dict[str, str] = {
            "pageStartIndex": str(page * actual_size),
            "pageSize": str(actual_size),
        }
        if search:
            params["search"] = search

        code, body = await self._request("GET", "/jobs", params=params)
        if code != 200:
            return []

        if isinstance(body, dict) and "items" in body:
            return body["items"]
        if isinstance(body, list):
            return body
        return []

    async def get_job(self, job_id: str) -> dict | None:
        """Get a single job by ID."""
        code, body = await self._request("GET", f"/jobs/{job_id}")
        if code == 200 and isinstance(body, dict):
            return body
        return None

    async def get_job_contacts(self, job_id: str) -> list[dict]:
        """Get contacts for a job."""
        code, body = await self._request("GET", f"/jobs/{job_id}/contacts")
        if code == 200:
            if isinstance(body, list):
                return body
            if isinstance(body, dict) and "items" in body:
                return body["items"]
        return []

    async def get_job_insurance(self, job_id: str) -> dict | None:
        """Get insurance info for a job (carrier, claim number, etc.)."""
        code, body = await self._request("GET", f"/jobs/{job_id}/insurance")
        if code == 200 and isinstance(body, dict):
            return body
        return None

    async def get_job_documents(self, job_id: str) -> list[dict]:
        """List documents attached to a job (v2 API — metadata only)."""
        code, body = await self._request("GET", f"/jobs/{job_id}/documents")
        if code == 200:
            if isinstance(body, list):
                return body
            if isinstance(body, dict) and "items" in body:
                return body["items"]
        return []

    async def get_job_photos(self, job_id: str) -> list[dict]:
        """Get photos for a job (v2 API)."""
        code, body = await self._request("GET", f"/jobs/{job_id}/photos")
        if code == 200:
            if isinstance(body, list):
                return body
            if isinstance(body, dict) and "items" in body:
                return body["items"]
        return []

    async def get_job_financials(self, job_id: str) -> dict | None:
        """Get financial info for a job."""
        code, body = await self._request("GET", f"/jobs/{job_id}/financials")
        if code == 200 and isinstance(body, dict):
            return body
        return None

    async def paginate_all_jobs(
        self, search: str = "", max_pages: int = 10
    ) -> list[dict]:
        """Fetch multiple pages of jobs. Caps at max_pages to prevent runaway."""
        all_jobs: list[dict] = []
        for page in range(max_pages):
            jobs = await self.search_jobs(search=search, page=page)
            if not jobs:
                break
            all_jobs.extend(jobs)
            if len(jobs) < MAX_PAGE_SIZE:
                break
            await asyncio.sleep(API_DELAY)
        return all_jobs

    async def search_jobs_by_address(
        self, query: str, max_pages: int = 20
    ) -> list[dict]:
        """Search jobs by address — client-side filter.

        AccuLynx's search= parameter only matches job number/customer name,
        NOT street address. So we paginate jobs and filter locally.
        Caps at max_pages * 25 = 500 jobs scanned.
        """
        query_lower = query.lower().strip()
        if not query_lower:
            return await self.search_jobs()

        # First try the native search (works for job numbers and names)
        native = await self.search_jobs(search=query)
        native_matches = [
            j for j in native
            if query_lower in (j.get("streetAddress", "") or "").lower()
            or query_lower in (j.get("city", "") or "").lower()
            or query_lower in str(j.get("jobNumber", "")).lower()
        ]
        if native_matches:
            return native_matches

        # Native search didn't match by address — paginate and filter
        all_jobs: list[dict] = []
        for page in range(max_pages):
            jobs = await self.search_jobs(page=page)
            if not jobs:
                break
            for job in jobs:
                addr = (job.get("streetAddress", "") or "").lower()
                city = (job.get("city", "") or "").lower()
                full = f"{addr} {city}"
                if query_lower in full:
                    all_jobs.append(job)
            if len(jobs) < MAX_PAGE_SIZE:
                break
            await asyncio.sleep(API_DELAY)
            # Stop early if we found enough matches
            if len(all_jobs) >= 25:
                break
        return all_jobs[:25]

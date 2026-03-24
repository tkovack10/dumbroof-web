"""
AccuLynx Integration — Multi-Tenant API v2 Client
====================================================
Adapted from USARM-Operations-Export/modules/acculynx/api_client.py.

Key constraints (discovered via testing on 5,270+ jobs):
- Auth: Bearer token
- Max page size: 25 (silently returns empty above this!)
- Pagination uses pageStartIndex (zero-based offset), NOT page numbers
- Rate limit: 0.3s delay recommended between calls
- API response wraps jobs in {"count", "pageSize", "pageStartIndex", "items"}
- Address is in locationAddress.street1 / .city / .state.abbreviation (NOT streetAddress)
- search= parameter does NOT reliably filter — must paginate and filter client-side
- /jobs/{id}/documents and /jobs/{id}/photos return 404 (D-022 — v2 can't access these)
"""

import asyncio
import httpx
from typing import Any

BASE_URL = "https://api.acculynx.com/api/v2"
MAX_PAGE_SIZE = 25
API_DELAY = 0.3
REQUEST_TIMEOUT = 30


def _extract_address(job: dict) -> dict:
    """Extract address fields from AccuLynx job's locationAddress object."""
    loc = job.get("locationAddress", {}) or {}
    state_obj = loc.get("state", {}) or {}
    return {
        "street": loc.get("street1", "") or "",
        "city": loc.get("city", "") or "",
        "state": state_obj.get("abbreviation", "") or "",
        "zip": loc.get("zipCode", "") or "",
    }


def _normalize_job(job: dict) -> dict:
    """Normalize AccuLynx job to a flat structure for the frontend."""
    addr = _extract_address(job)

    # Extract primary contact name
    homeowner = ""
    for c in job.get("contacts", []):
        contact_obj = c.get("contact", {})
        # The contacts list has _link but not full name — we store the link for later
        if c.get("isPrimary"):
            homeowner = contact_obj.get("_link", "")
            break

    return {
        "id": job.get("id", ""),
        "streetAddress": addr["street"],
        "city": addr["city"],
        "state": addr["state"],
        "zip": addr["zip"],
        "currentMilestone": job.get("currentMilestone", ""),
        "workType": (job.get("workType", {}) or {}).get("name", ""),
        "tradeTypes": [t.get("name", "") for t in (job.get("tradeTypes", []) or [])],
        "contactLink": homeowner,
    }


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
                count = body.get("count", 0) if isinstance(body, dict) else 0
                return True, f"Connected to AccuLynx ({count} jobs)"
            if code == 401:
                return False, "Invalid API key"
            return False, f"AccuLynx returned HTTP {code}"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def _fetch_page(self, page: int, page_size: int = MAX_PAGE_SIZE) -> list[dict]:
        """Fetch one page of jobs and normalize them."""
        actual_size = min(page_size, MAX_PAGE_SIZE)
        params = {
            "pageStartIndex": str(page * actual_size),
            "pageSize": str(actual_size),
        }
        code, body = await self._request("GET", "/jobs", params=params)
        if code != 200:
            return []

        if isinstance(body, dict) and "items" in body:
            raw = body["items"]
        elif isinstance(body, list):
            raw = body
        else:
            return []

        return [_normalize_job(j) for j in raw]

    async def search_jobs(
        self, query: str = "", max_pages: int = 20
    ) -> list[dict]:
        """Search jobs by address, city, zip, or milestone — client-side filter.

        AccuLynx v2 search= parameter is unreliable (doesn't filter by address).
        We paginate and filter locally. Caps at max_pages * 25 = 500 jobs scanned.
        Returns up to 25 normalized job objects.
        """
        query_lower = query.lower().strip()

        if not query_lower:
            # No query — just return first page
            return await self._fetch_page(0)

        matches: list[dict] = []
        for page in range(max_pages):
            jobs = await self._fetch_page(page)
            if not jobs:
                break
            for job in jobs:
                searchable = " ".join([
                    job.get("streetAddress", ""),
                    job.get("city", ""),
                    job.get("state", ""),
                    job.get("zip", ""),
                    job.get("currentMilestone", ""),
                    " ".join(job.get("tradeTypes", [])),
                ]).lower()
                if query_lower in searchable:
                    matches.append(job)
            if len(jobs) < MAX_PAGE_SIZE:
                break
            if len(matches) >= 25:
                break
            await asyncio.sleep(API_DELAY)

        return matches[:25]

    async def get_job(self, job_id: str) -> dict | None:
        """Get a single job by ID."""
        code, body = await self._request("GET", f"/jobs/{job_id}")
        if code == 200 and isinstance(body, dict):
            return _normalize_job(body)
        return None

    async def get_job_contacts(self, job_id: str) -> list[dict]:
        """Get contacts for a job."""
        code, body = await self._request("GET", f"/jobs/{job_id}/contacts")
        if code == 200:
            items = body if isinstance(body, list) else (body.get("items", []) if isinstance(body, dict) else [])
            return items
        return []

    async def get_job_insurance(self, job_id: str) -> dict | None:
        """Get insurance info for a job (carrier, claim number, etc.)."""
        code, body = await self._request("GET", f"/jobs/{job_id}/insurance")
        if code == 200 and isinstance(body, dict):
            return body
        return None

    async def get_contact(self, contact_url: str) -> dict | None:
        """Fetch a contact by its full API URL (from job.contacts[].contact._link)."""
        if not contact_url:
            return None
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(contact_url, headers=self.headers)
            if resp.status_code == 200:
                try:
                    return resp.json()
                except Exception:
                    pass
        return None

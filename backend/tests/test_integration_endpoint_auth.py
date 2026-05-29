"""Regression test: the CRM integration endpoints reject a missing/mismatched JWT.

Security context (2026-05-29 cross-tenant IDOR residuals): the AccuLynx /
CompanyCam integration endpoints used to trust a caller-supplied ``user_id``
query/body param to pick whose stored API key to use. Any signed-in (or even
unauthenticated) caller could therefore read another tenant's AccuLynx jobs or
CompanyCam projects/photos, or import into another tenant's storage path.

The fix (mirroring how PR #67 hardened ``acculynx/jobs``) derives the caller's
identity from the verified Supabase JWT via ``_resolve_brain_user_id`` and:
  * raises 401 when no token resolves, and
  * raises 403 when a supplied ``user_id`` does not match the verified id.

Both guards run BEFORE the endpoint ever resolves the integration client, so we
can assert them without mocking Supabase or the AccuLynx/CompanyCam HTTP clients:
  * no Authorization header -> ``_resolve_brain_user_id`` returns None
    (no network call) -> the endpoint raises HTTPException(401).
  * a verified id (monkeypatched) plus a different ``user_id`` param ->
    the endpoint raises HTTPException(403) before touching the client.

main.py pulls heavy runtime deps (fastapi, dotenv, supabase, ...). When those
aren't installed (bare local shell) the test SKIPS with a clear note; in CI /
Railway where deps are present it runs the real endpoint functions. Mirrors the
import-and-test style of the other backend/tests/*.py files.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import main as backend_main
    from fastapi import HTTPException
except Exception as exc:  # pragma: no cover - import guard for dep-less envs
    backend_main = None
    HTTPException = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


VERIFIED_ID = "11111111-1111-1111-1111-111111111111"
OTHER_ID = "99999999-9999-9999-9999-999999999999"


pytestmark = pytest.mark.skipif(
    backend_main is None,
    reason=f"backend.main import unavailable (missing runtime deps): {_IMPORT_ERROR}",
)


def _run(coro):
    return asyncio.run(coro)


# Each entry: (label, callable building the coroutine for a given user_id).
# Covers all five hardened endpoints (2 GET-query, 1 GET path-photos, 2 POST-body).
def _no_auth_calls():
    """Coroutine factories invoked with NO Authorization header (authorization=None)."""
    return [
        ("acculynx_job_detail", lambda: backend_main.acculynx_job_detail(
            job_id="job-1", user_id=None, authorization=None)),
        ("companycam_projects", lambda: backend_main.companycam_projects(
            query="", page=1, user_id=None, authorization=None)),
        ("companycam_photos", lambda: backend_main.companycam_photos(
            project_id="proj-1", user_id=None, authorization=None)),
        ("companycam_import", lambda: backend_main.companycam_import(
            project_id="proj-1", slug="addr-1", user_id=None, authorization=None)),
        ("acculynx_import", lambda: backend_main.acculynx_import(
            job_id="job-1", slug="addr-1", user_id=None, authorization=None)),
    ]


def _mismatch_calls():
    """Coroutine factories invoked with a verified id but a DIFFERENT user_id param.

    authorization is a non-None placeholder so we exercise the real header path;
    _resolve_brain_user_id is monkeypatched to return VERIFIED_ID regardless.
    """
    return [
        ("acculynx_job_detail", lambda: backend_main.acculynx_job_detail(
            job_id="job-1", user_id=OTHER_ID, authorization="Bearer x")),
        ("companycam_projects", lambda: backend_main.companycam_projects(
            query="", page=1, user_id=OTHER_ID, authorization="Bearer x")),
        ("companycam_photos", lambda: backend_main.companycam_photos(
            project_id="proj-1", user_id=OTHER_ID, authorization="Bearer x")),
        ("companycam_import", lambda: backend_main.companycam_import(
            project_id="proj-1", slug="addr-1", user_id=OTHER_ID, authorization="Bearer x")),
        ("acculynx_import", lambda: backend_main.acculynx_import(
            job_id="job-1", slug="addr-1", user_id=OTHER_ID, authorization="Bearer x")),
    ]


@pytest.mark.parametrize("label,make_coro", _no_auth_calls(), ids=lambda v: v if isinstance(v, str) else "")
def test_integration_endpoint_401_without_jwt(label, make_coro):
    """No Authorization header -> 401 (the unauthenticated IDOR is closed)."""
    with pytest.raises(HTTPException) as exc:
        _run(make_coro())
    assert exc.value.status_code == 401


@pytest.mark.parametrize("label,make_coro", _mismatch_calls(), ids=lambda v: v if isinstance(v, str) else "")
def test_integration_endpoint_403_on_user_id_mismatch(label, make_coro, monkeypatch):
    """A verified caller may not impersonate another tenant via the user_id param -> 403.

    The 403 is raised before the endpoint resolves the integration client, so no
    AccuLynx/CompanyCam or Supabase mocking is required.
    """
    monkeypatch.setattr(backend_main, "_resolve_brain_user_id", lambda *_a, **_k: VERIFIED_ID)
    with pytest.raises(HTTPException) as exc:
        _run(make_coro())
    assert exc.value.status_code == 403

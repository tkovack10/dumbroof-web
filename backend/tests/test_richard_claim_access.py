"""Regression test: a non-owner is denied access to a per-claim Richard endpoint.

Security context (2026-05-29 cross-tenant IDOR hardening): the per-claim Richard
endpoints (chat / approve-action / reset / suggestions / history) used to gate the
ownership check behind the RICHARD_ENFORCE_AUTH env var (soft-fail). That gate was
removed so the check runs UNCONDITIONALLY — every one of those endpoints now calls
``_user_can_access_claim(sb, resolved_user_id, claim)`` and raises 403 when it
returns False (and 401 when no JWT resolves).

``_user_can_access_claim`` is the single authority all five endpoints share, so we
test it directly: a non-owner who does not share the claim's company_id is denied
(the False that becomes a 403), while the owner and a same-company teammate are
allowed. We also assert the no-JWT path (resolved_user_id falsy) is denied — that is
the 401 branch.

The function lives in backend/main.py, which pulls heavy runtime deps (fastapi,
dotenv, supabase, ...). When those aren't installed (bare local shell), the test
SKIPS with a clear note; in CI / Railway where deps are present, it runs the real
function. Mirrors the import-and-test style of the other backend/tests/*.py files.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from main import _user_can_access_claim
except Exception as exc:  # pragma: no cover - import guard for dep-less envs
    _user_can_access_claim = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


OWNER_ID = "11111111-1111-1111-1111-111111111111"
TEAMMATE_ID = "22222222-2222-2222-2222-222222222222"
STRANGER_ID = "99999999-9999-9999-9999-999999999999"
USARM_COMPANY = "a0000000-0000-0000-0000-000000000001"
OTHER_COMPANY = "b0000000-0000-0000-0000-000000000002"


class _FakeQuery:
    """Minimal stand-in for the supabase-py query builder used by
    _user_can_access_claim: .table().select().eq().limit().execute() ->
    object with a .data list. Returns the company_id mapped to the queried
    user_id (the only DB lookup the function performs)."""

    def __init__(self, user_company_map):
        self._user_company_map = user_company_map
        self._queried_user = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, col, val):
        if col == "user_id":
            self._queried_user = val
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        company_id = self._user_company_map.get(self._queried_user)
        data = [{"company_id": company_id}] if company_id is not None else []
        return type("Result", (), {"data": data})()


class _FakeSupabase:
    def __init__(self, user_company_map):
        self._user_company_map = user_company_map

    def table(self, _name):
        return _FakeQuery(self._user_company_map)


# Owner belongs to USARM; the teammate also belongs to USARM; the stranger has
# their own unrelated company.
_USER_COMPANY_MAP = {
    OWNER_ID: USARM_COMPANY,
    TEAMMATE_ID: USARM_COMPANY,
    STRANGER_ID: OTHER_COMPANY,
}

# A claim owned by OWNER_ID and stamped with USARM's company_id.
_CLAIM = {"user_id": OWNER_ID, "company_id": USARM_COMPANY}


pytestmark = pytest.mark.skipif(
    _user_can_access_claim is None,
    reason=f"backend.main import unavailable (missing runtime deps): {_IMPORT_ERROR}",
)


def _sb():
    return _FakeSupabase(_USER_COMPANY_MAP)


def test_non_owner_other_company_is_denied():
    """The core regression: a signed-in user who is neither the owner nor a
    company member must be denied -> the endpoints raise 403."""
    assert _user_can_access_claim(_sb(), STRANGER_ID, _CLAIM) is False


def test_owner_is_allowed():
    assert _user_can_access_claim(_sb(), OWNER_ID, _CLAIM) is True


def test_same_company_teammate_is_allowed():
    """Company-scoped multi-tenancy: a teammate sharing company_id is allowed."""
    assert _user_can_access_claim(_sb(), TEAMMATE_ID, _CLAIM) is True


def test_missing_user_is_denied():
    """No resolved user (the 401 branch feeds a falsy user_id) -> denied."""
    assert _user_can_access_claim(_sb(), "", _CLAIM) is False
    assert _user_can_access_claim(_sb(), None, _CLAIM) is False


def test_claim_without_company_denies_non_owner():
    """A solo-owner claim with NULL company_id stays owner-only: a stranger
    (even one who has a company) cannot reach it via the company branch."""
    solo_claim = {"user_id": OWNER_ID, "company_id": None}
    assert _user_can_access_claim(_sb(), STRANGER_ID, solo_claim) is False
    assert _user_can_access_claim(_sb(), OWNER_ID, solo_claim) is True

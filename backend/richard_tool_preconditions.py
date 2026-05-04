"""Tool precondition checks (governance v2 Day 4).

Pattern: each tool can register a precondition function that runs BEFORE
the handler dispatches. If the precondition fails, execute_tool short-
circuits with a structured error result that tells Richard what's missing.
Richard then surfaces it as natural language ("You need to finish onboarding
first").

This is the layer that catches Ronaldo's case (governance v2 plan, mistake
#7): user with no company_profile asked Richard to invite a team member.
The handler would have happily collected the email and tried to write a
company_invites row that referenced a null company_id. Precondition catches
the schema fact before the LLM round-trip.

Each precondition takes (sb, claim_data, company_profile, user_id, tool_input)
and returns either None (= ok, dispatch to handler) or a tool_result dict
with action="error" or action="precondition_failed".
"""

from __future__ import annotations

from typing import Any, Callable, Optional


PreconditionFn = Callable[..., Optional[dict]]


def _company_profile_complete(company_profile: dict) -> bool:
    """A company profile is 'complete' if it has at minimum a company name
    and a contact name. These are the fields invite_team_member, integrations,
    and outbound emails depend on.
    """
    if not company_profile:
        return False
    name = (company_profile.get("company_name") or "").strip()
    contact = (company_profile.get("contact_name") or "").strip()
    return bool(name) and bool(contact)


def _user_company_role(company_profile: dict) -> str:
    """Best-effort role lookup. Returns 'owner' | 'admin' | 'member' | ''."""
    return (company_profile.get("role") or "").strip().lower()


# ─── Precondition functions ──────────────────────────────────────────────


def require_company_profile_complete(
    sb: Any,
    claim_data: dict,
    company_profile: dict,
    user_id: str,
    tool_input: dict,
) -> Optional[dict]:
    """Block tools that depend on company name/contact_name being set."""
    if _company_profile_complete(company_profile):
        return None
    return {
        "action": "error",
        "message": (
            "Cannot proceed — your company profile is incomplete. "
            "Please go to Settings → Company Profile and fill in your "
            "company name and contact name first. Once that's saved, "
            "I can take this action."
        ),
        "precondition_failed": "company_profile_incomplete",
        "missing_fields": [
            f for f, v in [
                ("company_name", company_profile.get("company_name")),
                ("contact_name", company_profile.get("contact_name")),
            ] if not (v or "").strip()
        ],
    }


def require_admin_or_owner(
    sb: Any,
    claim_data: dict,
    company_profile: dict,
    user_id: str,
    tool_input: dict,
) -> Optional[dict]:
    """Block tools restricted to owner/admin role."""
    role = _user_company_role(company_profile)
    if role in ("owner", "admin"):
        return None
    return {
        "action": "error",
        "message": (
            "Cannot proceed — this action requires owner or admin role. "
            "Ask the account owner to perform this, or get them to "
            "promote your role in Settings → Team."
        ),
        "precondition_failed": "insufficient_role",
        "current_role": role or "unknown",
    }


def require_email_in_input(
    sb: Any,
    claim_data: dict,
    company_profile: dict,
    user_id: str,
    tool_input: dict,
) -> Optional[dict]:
    """Block invite_team_member when the email is missing or obviously bad.

    The handler validates more carefully but this catches the common case
    where Richard tries to call the tool before getting the email from the
    user (Ronaldo's transcript: Richard happily moved to 'what's the email?'
    instead of refusing because no company_profile was set up).
    """
    email = (tool_input.get("email") or "").strip()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return {
            "action": "error",
            "message": "I need the new team member's email address before I can invite them.",
            "precondition_failed": "missing_or_invalid_email",
        }
    return None


def chain(*fns: PreconditionFn) -> PreconditionFn:
    """Run preconditions in order; return the first failure, else None."""
    def _runner(*args, **kwargs):
        for fn in fns:
            res = fn(*args, **kwargs)
            if res is not None:
                return res
        return None
    return _runner


# ─── Registry ────────────────────────────────────────────────────────────

# Maps tool_name → precondition function (single fn or chain).
# Tools NOT in this dict have no preconditions and dispatch as today.
TOOL_PRECONDITIONS: dict[str, PreconditionFn] = {
    # The Ronaldo case: user with no company_profile asks to invite someone.
    # Catches the schema fact (no company → no company_invites.company_id)
    # AND surfaces a clear "finish onboarding first" message.
    "invite_team_member": chain(
        require_company_profile_complete,
        require_admin_or_owner,
        require_email_in_input,
    ),
    # save_integration_key writes to company_profiles.* — no profile = nothing
    # to write to. Same root cause as invite, different surface.
    "save_integration_key": require_company_profile_complete,
    # Cross-tenant admin tools require owner/admin role
    "list_company_claims": require_admin_or_owner,
    "get_company_portfolio_summary": require_admin_or_owner,
    "compare_team_performance": require_admin_or_owner,
    "get_team_member_workload": require_admin_or_owner,
}


def check_preconditions(
    sb: Any,
    tool_name: str,
    claim_data: dict,
    company_profile: dict,
    user_id: str,
    tool_input: dict,
) -> Optional[dict]:
    """Run the registered precondition for tool_name. Returns None on
    pass, or a tool_result dict on failure.
    """
    fn = TOOL_PRECONDITIONS.get(tool_name)
    if fn is None:
        return None
    try:
        return fn(sb, claim_data, company_profile, user_id, tool_input)
    except Exception as e:
        # Don't block the tool on a precondition bug — log and let dispatch
        # handle the underlying issue.
        print(f"[PRECONDITION_ERROR] {tool_name}: {type(e).__name__}: {e}", flush=True)
        return None

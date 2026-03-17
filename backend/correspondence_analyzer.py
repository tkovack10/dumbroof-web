"""
Correspondence Analyzer — AI Analysis + Socratic Response Drafting
===================================================================
When a carrier email is matched to a claim:
  1. Analyze carrier position (Sonnet — extraction tier)
  2. Select strongest evidence photos (algorithmic)
  3. Draft Socratic response (Opus — IP-quality tier)
  4. Store results in carrier_correspondence + email_drafts
"""

from __future__ import annotations

import os
import json
import time
from typing import Optional

import anthropic
from supabase import Client

from telemetry import call_claude_logged, _estimate_cost

# Models
EXTRACTION_MODEL = "claude-opus-4-6"  # Carrier position analysis
DRAFTING_MODEL = "claude-opus-4-6"       # Socratic response drafting


def get_claude_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ.get("CLAUDE_API_KEY"))


async def analyze_correspondence(sb: Client, correspondence_id: str) -> dict:
    """Full pipeline: analyze carrier position → select photos → draft response."""
    # Fetch correspondence record
    result = sb.table("carrier_correspondence").select("*").eq("id", correspondence_id).single().execute()
    correspondence = result.data
    if not correspondence:
        raise ValueError(f"Correspondence {correspondence_id} not found")

    claim_id = correspondence.get("claim_id")
    if not claim_id:
        raise ValueError(f"Correspondence {correspondence_id} has no matched claim")

    # Mark as analyzing
    sb.table("carrier_correspondence").update(
        {"analysis_status": "analyzing"}
    ).eq("id", correspondence_id).execute()

    try:
        client = get_claude_client()

        # Fetch claim data for context
        claim = sb.table("claims").select("*").eq("id", claim_id).single().execute().data

        # Fetch claim photos from data warehouse
        photos_result = sb.table("photos").select("*").eq("claim_id", claim_id).execute()
        claim_photos = photos_result.data or []

        # Get user's compliance role from company profile
        user_id = correspondence["user_id"]
        profile_result = sb.table("company_profiles").select("*").eq("user_id", user_id).maybeSingle().execute()
        compliance_role = "contractor"  # Default safe mode

        # Step 1: Analyze carrier position
        carrier_position = analyze_carrier_position(
            client, sb, claim_id, correspondence, claim
        )

        # Step 2: Select strongest photos
        selected_photos = select_strongest_photos(
            claim_photos, carrier_position
        )

        # Step 3: Draft Socratic response
        draft_result = draft_socratic_response(
            client, sb, claim_id, correspondence, claim,
            carrier_position, selected_photos, compliance_role
        )

        # Step 4: Update correspondence with analysis
        sb.table("carrier_correspondence").update({
            "carrier_position": json.dumps(carrier_position),
            "suggested_action": carrier_position.get("recommended_response", "respond_socratic"),
            "analysis_status": "analyzed",
            "status": "response_drafted",
        }).eq("id", correspondence_id).execute()

        # Step 5: Create email draft
        draft_data = {
            "correspondence_id": correspondence_id,
            "claim_id": claim_id,
            "user_id": user_id,
            "to_email": correspondence.get("original_from", ""),
            "subject": f"Re: {correspondence.get('original_subject', 'Claim Review')}",
            "body_html": draft_result["body_html"],
            "body_text": draft_result["body_text"],
            "selected_photos": json.dumps(selected_photos),
            "response_strategy": carrier_position.get("recommended_response", "socratic"),
            "carrier_weaknesses": json.dumps(carrier_position.get("weaknesses", [])),
            "compliance_role": compliance_role,
            "status": "draft",
            "generation_cost": draft_result.get("cost", 0),
        }

        draft_result_db = sb.table("email_drafts").insert(draft_data).select("id").single().execute()

        # Update claim pending_drafts count
        claim_pending = (claim.get("pending_drafts") or 0) + 1
        sb.table("claims").update({
            "pending_drafts": claim_pending,
            "latest_carrier_position": carrier_position.get("stance", "unknown"),
        }).eq("id", claim_id).execute()

        return {
            "correspondence_id": correspondence_id,
            "draft_id": draft_result_db.data["id"],
            "carrier_position": carrier_position,
            "selected_photos_count": len(selected_photos),
        }

    except Exception as e:
        sb.table("carrier_correspondence").update(
            {"analysis_status": "error"}
        ).eq("id", correspondence_id).execute()
        raise


def analyze_carrier_position(
    client: anthropic.Anthropic,
    sb: Client,
    claim_id: str,
    correspondence: dict,
    claim: dict,
) -> dict:
    """Step 1: Use Sonnet to analyze the carrier's email and extract their position."""

    email_body = correspondence.get("text_body", "")
    carrier_name = correspondence.get("carrier_name", "Unknown")
    claim_address = claim.get("address", "Unknown")

    prompt = f"""Analyze this carrier correspondence and extract the carrier's position.

CARRIER: {carrier_name}
CLAIM ADDRESS: {claim_address}
CARRIER EMAIL SUBJECT: {correspondence.get('original_subject', 'N/A')}

--- CARRIER EMAIL BODY ---
{email_body[:8000]}
--- END EMAIL ---

Extract the following as JSON:
{{
  "stance": "<full_denial | partial_denial | underpayment | request_for_info | reinspection_offer | acceptance>",
  "key_arguments": ["<what the carrier is claiming — each argument as a separate string>"],
  "weaknesses": [
    {{
      "weakness": "<hole in carrier's position>",
      "evidence": "<what evidence contradicts this>",
      "suggested_question": "<Socratic question that exposes this weakness>"
    }}
  ],
  "tone": "<hostile | dismissive | neutral | cooperative>",
  "urgency": "<low | medium | high | critical>",
  "recommended_response": "<socratic | factual_rebuttal | escalation | reinspection_request>",
  "summary": "<2-3 sentence summary of carrier's position>"
}}

Focus on identifying:
- Claims that contradict physical evidence
- Logical inconsistencies in their argument
- Missing items they should have covered
- Standard carrier tactics (blanket denial, wear-and-tear excuse, spot repair only)

Return ONLY valid JSON, no other text."""

    response = call_claude_logged(
        client, sb, claim_id,
        step_name="analyze_carrier_position",
        model=EXTRACTION_MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # Extract JSON from response
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "stance": "unknown",
            "key_arguments": ["Unable to parse carrier response"],
            "weaknesses": [],
            "tone": "neutral",
            "urgency": "medium",
            "recommended_response": "socratic",
            "summary": "Carrier response could not be fully parsed by AI.",
        }


def select_strongest_photos(
    claim_photos: list[dict],
    carrier_position: dict,
) -> list[dict]:
    """Step 2: Score every photo against carrier's arguments, pick top 4-6."""

    if not claim_photos:
        return []

    stance = carrier_position.get("stance", "")
    key_arguments = [a.lower() for a in carrier_position.get("key_arguments", [])]
    arguments_text = " ".join(key_arguments)

    scored_photos = []
    seen_elevations: dict[str, int] = {}

    for photo in claim_photos:
        score = 0
        reasons = []

        damage_type = (photo.get("damage_type") or "").lower()
        severity = (photo.get("severity") or "").lower()
        elevation = (photo.get("elevation") or "unknown").lower()
        trade = (photo.get("trade") or "").lower()
        fraud_score = photo.get("fraud_score") or 0
        annotation = photo.get("annotation_text") or ""

        # Skip overview/none photos
        if damage_type in ("none", "overview", ""):
            continue

        # Severity bonus
        severity_scores = {"critical": 40, "severe": 30, "moderate": 20, "minor": 10}
        severity_bonus = severity_scores.get(severity, 5)
        score += severity_bonus
        if severity_bonus >= 30:
            reasons.append(f"{severity} damage documented")

        # Carrier says "no damage" → any damage photo scores +30
        if stance == "full_denial" or "no damage" in arguments_text:
            score += 30
            reasons.append("Contradicts carrier's 'no damage' position")

        # Carrier says "wear and tear" → fresh impact photos +25
        if "wear" in arguments_text or "tear" in arguments_text or "age" in arguments_text:
            fresh_indicators = ["impact", "crack", "fracture", "puncture", "dent", "crease"]
            if any(ind in damage_type for ind in fresh_indicators) or any(ind in annotation.lower() for ind in fresh_indicators):
                score += 25
                reasons.append("Shows fresh impact, not wear and tear")

        # Chalk tests always score +20
        if damage_type == "chalk_test" or "chalk" in annotation.lower():
            score += 20
            reasons.append("Forensic chalk test documentation")

        # Trade relevance bonus
        if trade and trade in arguments_text:
            score += 15
            reasons.append(f"Directly relevant to disputed {trade} trade")

        # Fraud score penalty
        if fraud_score > 50:
            score -= 20

        # Elevation diversity penalty (don't pick 6 photos of same spot)
        elevation_count = seen_elevations.get(elevation, 0)
        if elevation_count >= 2:
            score -= 15 * (elevation_count - 1)

        scored_photos.append({
            "path": photo.get("file_path") or photo.get("storage_url", ""),
            "annotation_key": photo.get("annotation_key", ""),
            "description": annotation or f"{damage_type} on {elevation}",
            "damage_type": damage_type,
            "severity": severity,
            "elevation": elevation,
            "score": max(score, 0),
            "reasons": reasons,
        })

    # Sort by score descending
    scored_photos.sort(key=lambda p: p["score"], reverse=True)

    # Select top 4-6, ensuring elevation diversity
    selected = []
    elevation_counts: dict[str, int] = {}

    for photo in scored_photos:
        if len(selected) >= 6:
            break

        elev = photo["elevation"]
        if elevation_counts.get(elev, 0) >= 2 and len(selected) >= 4:
            continue

        selected.append(photo)
        elevation_counts[elev] = elevation_counts.get(elev, 0) + 1

    # Ensure at least 4 if available
    if len(selected) < 4 and len(scored_photos) > len(selected):
        for photo in scored_photos:
            if photo not in selected:
                selected.append(photo)
            if len(selected) >= 4:
                break

    return selected


def draft_socratic_response(
    client: anthropic.Anthropic,
    sb: Client,
    claim_id: str,
    correspondence: dict,
    claim: dict,
    carrier_position: dict,
    selected_photos: list[dict],
    compliance_role: str,
) -> dict:
    """Step 3: Draft a Socratic response using Opus (IP-quality tier)."""

    carrier_name = correspondence.get("carrier_name", "the carrier")
    claim_address = claim.get("address", "the property")
    stance = carrier_position.get("stance", "denial")
    weaknesses = carrier_position.get("weaknesses", [])

    # Build photo reference list
    photo_descriptions = []
    for i, photo in enumerate(selected_photos, 1):
        desc = photo.get("description", "damage documentation")
        photo_descriptions.append(f"Photo {i}: {desc}")
    photo_list = "\n".join(photo_descriptions) if photo_descriptions else "No photos selected"

    # Build weakness list
    weakness_list = []
    for w in weaknesses:
        weakness_list.append(f"- Weakness: {w.get('weakness', 'N/A')}")
        if w.get("suggested_question"):
            weakness_list.append(f"  Question: {w['suggested_question']}")
    weakness_text = "\n".join(weakness_list) if weakness_list else "No specific weaknesses identified"

    # UPPA compliance instructions
    if compliance_role == "contractor":
        compliance_instructions = """CRITICAL — CONTRACTOR MODE (UPPA Compliance):
- You are writing on behalf of a CONTRACTOR, NOT a public adjuster or attorney
- NEVER use: "on behalf of," "demand," "appeal," cite insurance regulations, threaten bad faith
- NEVER reference: 11 NYCRR, § 2601, unfair claims practices, regulatory complaints
- USE ONLY: professional questions, factual observations, requests for re-review
- The Socratic method IS the technique — questions the adjuster can't dodge honestly
- End with a professional request for re-review, NOT a demand"""
    else:
        compliance_instructions = f"""MODE: {compliance_role.upper()} — Full advocacy language permitted.
- You may cite insurance regulations, demand re-evaluation, reference unfair claims practices
- You may use formal appeal language and regulatory citations"""

    prompt = f"""Draft a professional email response to {carrier_name}'s {stance} regarding the claim at {claim_address}.

{compliance_instructions}

CARRIER'S POSITION:
{carrier_position.get('summary', 'Carrier denied or underpaid the claim.')}

CARRIER'S KEY ARGUMENTS:
{json.dumps(carrier_position.get('key_arguments', []), indent=2)}

IDENTIFIED WEAKNESSES:
{weakness_text}

ATTACHED EVIDENCE PHOTOS:
{photo_list}

RESPONSE STRATEGY: Use the Socratic method — ask questions the adjuster cannot honestly answer without contradicting their own position.

REQUIRED STRUCTURE:
1. Professional greeting referencing the claim address and their correspondence
2. Confirm receipt of their position
3. "Can you confirm these {len(selected_photos)} photographs are included in the claim file?"
4. For each key photo, ask a specific question:
   - "Having reviewed [Photo N] showing [specific damage], what does the carrier believe caused the [specific anomaly] documented in this image?"
   - "If the carrier maintains this is [their claim], can you explain the [specific evidence] visible in [Photo N]?"
5. Reference each attached photo by its specific forensic description
6. Professional closing requesting a re-review based on the documented evidence

TONE: Professional, factual, non-confrontational. Let the evidence speak through pointed questions.

Generate TWO versions:
1. HTML version (with <p> tags, <strong> for emphasis, <ol>/<ul> for lists)
2. Plain text version

Return as JSON:
{{
  "body_html": "<html email body>",
  "body_text": "<plain text email body>"
}}

Return ONLY valid JSON."""

    start_time = time.time()

    response = call_claude_logged(
        client, sb, claim_id,
        step_name="draft_socratic_response",
        model=DRAFTING_MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    # Calculate cost
    usage = response.usage
    cost = _estimate_cost(DRAFTING_MODEL, usage.input_tokens, usage.output_tokens)

    try:
        result = json.loads(text)
        result["cost"] = cost
        return result
    except json.JSONDecodeError:
        # If JSON parse fails, use raw text
        return {
            "body_html": f"<p>{text}</p>",
            "body_text": text,
            "cost": cost,
        }


async def regenerate_draft(
    sb: Client,
    draft_id: str,
    strategy: Optional[str] = None,
) -> dict:
    """Regenerate a draft with a different strategy."""
    # Fetch existing draft
    draft = sb.table("email_drafts").select("*").eq("id", draft_id).single().execute().data
    if not draft:
        raise ValueError(f"Draft {draft_id} not found")

    correspondence = sb.table("carrier_correspondence").select("*").eq(
        "id", draft["correspondence_id"]
    ).single().execute().data

    claim = sb.table("claims").select("*").eq("id", draft["claim_id"]).single().execute().data

    # Get photos
    photos_result = sb.table("photos").select("*").eq("claim_id", draft["claim_id"]).execute()
    claim_photos = photos_result.data or []

    client = get_claude_client()

    # Re-analyze if strategy changed
    carrier_position = json.loads(correspondence.get("carrier_position", "{}")) if isinstance(
        correspondence.get("carrier_position"), str
    ) else correspondence.get("carrier_position", {})

    if strategy:
        carrier_position["recommended_response"] = strategy

    selected_photos = select_strongest_photos(claim_photos, carrier_position)

    new_draft = draft_socratic_response(
        client, sb, draft["claim_id"], correspondence, claim,
        carrier_position, selected_photos, draft.get("compliance_role", "contractor")
    )

    # Update draft record
    sb.table("email_drafts").update({
        "body_html": new_draft["body_html"],
        "body_text": new_draft["body_text"],
        "selected_photos": json.dumps(selected_photos),
        "response_strategy": strategy or draft.get("response_strategy", "socratic"),
        "edited_body_html": None,  # Clear user edits
        "status": "draft",
        "generation_cost": new_draft.get("cost", 0),
    }).eq("id", draft_id).execute()

    return {
        "draft_id": draft_id,
        "strategy": strategy or "socratic",
        "photos_count": len(selected_photos),
    }

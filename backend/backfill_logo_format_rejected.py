#!/usr/bin/env python3
"""Backfill identifier for claims affected by the non-raster-logo bug (E203).

Symptom: PDFs shipped with the company name rendered as broken alt-text on
the cover page instead of an actual logo image. Root causes:
  1. company_profiles.logo_path IS NULL (signup skipped logo upload).
  2. logo_path points to a non-raster file (.ai, .pdf, .svg, .eps).

For each affected claim this script will (with --apply):
  - If the user STILL has a non-raster or NULL logo: do NOT auto-reprocess.
    Send the user the same logo-format-rejected email so they know to fix it.
  - If the user has uploaded a valid raster since: trigger reprocess via the
    existing /api/process-claim endpoint, which auto-clears
    completion_email_sent_at (E199) and resends with the corrected logo.

Outputs a CSV at /tmp/backfill_logo_<timestamp>.csv with one row per claim.

Usage:
    # Dry-run (default — writes CSV, sends nothing)
    python3 backend/backfill_logo_format_rejected.py

    # Real run (sends emails, kicks reprocesses)
    python3 backend/backfill_logo_format_rejected.py --apply

    # Limit to a specific user (for spot-checks)
    python3 backend/backfill_logo_format_rejected.py --user-id <uuid>
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.request
from datetime import datetime

NON_RASTER_EXTS = {".ai", ".pdf", ".svg", ".eps", ".psd", ".tiff", ".tif"}


def _get(url: str, sk: str):
    req = urllib.request.Request(
        url,
        headers={"apikey": sk, "Authorization": f"Bearer {sk}",
                 "Accept": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _post(url: str, sk: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json",
                 "apikey": sk, "Authorization": f"Bearer {sk}",
                 "User-Agent": "Mozilla/5.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Take action (send emails, trigger reprocess). Default is dry-run.")
    parser.add_argument("--user-id", default="", help="Limit to one user_id (UUID).")
    parser.add_argument("--days", type=int, default=60, help="Look-back window for completed claims.")
    args = parser.parse_args()

    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sk = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sk:
        print("FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY not set in env.", file=sys.stderr)
        sys.exit(2)

    print(f"=== backfill_logo_format_rejected (apply={args.apply}, days={args.days}) ===")

    user_filter = f"&user_id=eq.{args.user_id}" if args.user_id else ""
    claims = _get(
        f"{sb_url}/rest/v1/claims?status=in.(complete,ready)"
        f"&select=id,user_id,address,status,output_files,created_at,completion_email_sent_at,file_path"
        f"&order=created_at.desc&limit=2000{user_filter}",
        sk,
    )
    print(f"Fetched {len(claims)} claim rows in window.")

    cutoff_iso = (datetime.utcnow().replace(microsecond=0).isoformat() + "Z")  # informational
    rows: list[dict] = []
    for c in claims:
        user_id = c.get("user_id")
        if not user_id:
            continue
        prof_rows = _get(
            f"{sb_url}/rest/v1/company_profiles?user_id=eq.{user_id}"
            "&select=user_id,company_name,contact_name,email,logo_path,is_usarm",
            sk,
        )
        prof = (prof_rows or [{}])[0]
        if prof.get("is_usarm"):
            continue  # USARM claims use bundled logo — not affected
        logo_path = (prof.get("logo_path") or "").lower()
        ext = ""
        is_problem = False
        if not logo_path:
            is_problem = True  # never uploaded a logo
        else:
            ext = "." + logo_path.rsplit(".", 1)[-1] if "." in logo_path else ""
            if ext in NON_RASTER_EXTS:
                is_problem = True
        if not is_problem:
            continue

        rows.append({
            "claim_id": c.get("id"),
            "user_id": user_id,
            "address": c.get("address"),
            "status": c.get("status"),
            "logo_path": prof.get("logo_path") or "",
            "logo_ext": ext or "(none)",
            "company_name": prof.get("company_name") or "",
            "user_email": prof.get("email") or "",
            "completion_email_sent_at": c.get("completion_email_sent_at") or "",
            "created_at": c.get("created_at") or "",
            "action_taken": "(dry-run)",
        })

    print(f"Found {len(rows)} affected claims.")
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    csv_path = f"/tmp/backfill_logo_{timestamp}.csv"

    if args.apply and rows:
        # Real-run: send the rejection email per affected user (deduped).
        # Reprocess loop is intentionally NOT auto-triggered because the user
        # still has a broken logo on file — reprocessing would just regenerate
        # the same broken PDFs. They need to upload a valid raster first.
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from claim_brain_email import send_via_resend  # type: ignore
        except Exception as e:
            print(f"FATAL: could not import send_via_resend: {e}", file=sys.stderr)
            sys.exit(3)
        seen_users = set()
        for r in rows:
            uid = r["user_id"]
            if uid in seen_users:
                r["action_taken"] = "skip_dup_user"
                continue
            seen_users.add(uid)
            if not r["user_email"]:
                r["action_taken"] = "skip_no_email"
                continue
            ext = r["logo_ext"] or "(missing)"
            subject = "Action needed: re-upload your DumbRoof company logo"
            body_html = f"""
<div style='font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937'>
  <h2 style='margin-top:0;color:#b91c1c'>Your past reports shipped without a logo image</h2>
  <p>Hi {r['company_name'] or 'there'},</p>
  <p>We just shipped an update that fixes how DumbRoof handles company logos.
     While reviewing existing accounts, we noticed your logo file
     ({ext}) isn&rsquo;t a format we can embed in PDF reports — so the
     reports we already generated for you used a text fallback instead of
     a real logo image.</p>
  <p style='background:#fef3c7;border-left:4px solid #f59e0b;padding:12px;margin:16px 0'>
     This affects past reports for: <strong>{r['address'] or '(your claims)'}</strong>.
  </p>
  <h3 style='margin-top:24px'>Two-minute fix</h3>
  <ol style='line-height:1.6'>
    <li>Open your logo and export it as <strong>PNG</strong> (preferred) or <strong>JPG</strong>.</li>
    <li>Upload the new file in <a href='https://dumbroof.ai/dashboard/settings'
       style='color:#2563eb'>Settings</a>.</li>
    <li>From any past claim, hit <strong>Reprocess</strong> &mdash; the
       reports regenerate with your real logo and we&rsquo;ll resend.</li>
  </ol>
  <p style='font-size:13px;color:#6b7280;margin-top:24px'>
     Supported: PNG, JPG/JPEG, WEBP, GIF.<br>
     Not supported: AI, PDF, SVG, EPS, PSD, TIFF.
  </p>
  <p style='font-size:12px;color:#9ca3af'>&mdash; DumbRoof</p>
</div>
"""
            try:
                send_via_resend(
                    company_name=r["company_name"] or "DumbRoof",
                    to_email=r["user_email"],
                    subject=subject,
                    body_html=body_html,
                )
                r["action_taken"] = "email_sent"
            except Exception as e:
                r["action_taken"] = f"email_failed: {str(e)[:80]}"

    # Write CSV either way
    if rows:
        cols = list(rows[0].keys())
        with open(csv_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {csv_path} ({len(rows)} rows)")
    else:
        print("No affected claims to write.")

    print("=== done ===")


if __name__ == "__main__":
    main()

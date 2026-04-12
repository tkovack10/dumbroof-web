#!/usr/bin/env python3
"""Batch reprocess a corpus of claims for before/after accuracy measurement.

Usage:
    python3 backend/scripts/reprocess_corpus.py --claim-ids id1 id2 id3 [--backend-url URL]

Triggers reprocessing on Railway for each claim ID, waits for completion,
and saves before/after annotation diffs to /tmp/reprocess_corpus_report.json.

Plan: ~/.claude/plans/proud-wiggling-hearth.md — Wind Damage Detection Focus
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


DEFAULT_BACKEND = "https://dumbroof-backend-production.up.railway.app"


def trigger_reprocess(backend_url: str, claim_id: str) -> bool:
    """Trigger reprocess for a single claim. Returns True if accepted."""
    url = f"{backend_url}/api/reprocess/{claim_id}"
    try:
        req = urllib.request.Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "reprocessing"
    except Exception as e:
        print(f"  ERROR triggering {claim_id}: {e}")
        return False


def wait_for_completion(backend_url: str, claim_ids: list[str], timeout_min: int = 30) -> dict:
    """Poll claim statuses until all are done or timeout."""
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    # Load Supabase
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")
    url_sb = key_sb = ""
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if "=" in line and not line.startswith("#"):
                    k, v = line.strip().split("=", 1)
                    v = v.strip("'\"").rstrip("\\n")
                    if k == "NEXT_PUBLIC_SUPABASE_URL":
                        url_sb = v
                    elif k == "SUPABASE_SERVICE_KEY":
                        key_sb = v.rstrip("\\n")

    from supabase import create_client
    sb = create_client(url_sb, key_sb)

    deadline = time.time() + timeout_min * 60
    pending = set(claim_ids)
    results = {}

    while pending and time.time() < deadline:
        for cid in list(pending):
            res = sb.table("claims").select("id, status, last_processed_at, qa_audit_flags").eq("id", cid).limit(1).execute()
            if res.data:
                row = res.data[0]
                if row["status"] in ("ready", "qa_review_pending", "error", "needs_improvement"):
                    results[cid] = row
                    pending.discard(cid)
                    print(f"  {cid[:8]}: {row['status']}")

        if pending:
            remaining = len(pending)
            print(f"  Waiting... {remaining} claim(s) still processing")
            time.sleep(30)

    for cid in pending:
        results[cid] = {"id": cid, "status": "timeout"}

    return results


def main():
    parser = argparse.ArgumentParser(description="Batch reprocess claims for accuracy measurement")
    parser.add_argument("--claim-ids", nargs="+", required=True, help="Claim IDs to reprocess")
    parser.add_argument("--backend-url", default=DEFAULT_BACKEND, help="Railway backend URL")
    parser.add_argument("--timeout-min", type=int, default=30, help="Max wait time in minutes")
    args = parser.parse_args()

    print(f"Reprocessing {len(args.claim_ids)} claims on {args.backend_url}")
    print()

    # Trigger all reprocesses
    triggered = []
    for cid in args.claim_ids:
        print(f"  Triggering {cid[:8]}...")
        if trigger_reprocess(args.backend_url, cid):
            triggered.append(cid)
            print(f"    ✓ Accepted")
        else:
            print(f"    ✗ Failed")

    if not triggered:
        print("No claims were triggered. Exiting.")
        sys.exit(1)

    print(f"\n{len(triggered)} claims triggered. Waiting for completion...")
    results = wait_for_completion(args.backend_url, triggered, args.timeout_min)

    # Save report
    report_path = "/tmp/reprocess_corpus_report.json"
    report = {
        "triggered": len(triggered),
        "completed": sum(1 for r in results.values() if r.get("status") in ("ready", "qa_review_pending")),
        "failed": sum(1 for r in results.values() if r.get("status") == "error"),
        "timeout": sum(1 for r in results.values() if r.get("status") == "timeout"),
        "results": results,
    }
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\nReport saved to {report_path}")
    print(f"Completed: {report['completed']}, Failed: {report['failed']}, Timeout: {report['timeout']}")


if __name__ == "__main__":
    main()

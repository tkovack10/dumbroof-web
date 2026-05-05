#!/usr/bin/env bash
# Vercel Ignored Build Step.
# Exit 0 → SKIP this deployment.
# Exit 1 → PROCEED with the build.
#
# Skips preview builds for branches that exist only as review-queue handoffs
# (e.g. agent/* branches created by /api/admin/agent-recommendations/[id]/approve).
# Those branches contain only a `.agent-recommendations/{id}.md` file describing
# a proposed diff — they are NEVER merged as-is, so the preview build is wasted
# compute AND the build fails because preview env doesn't expose all server-only
# secrets (SUPABASE_SERVICE_KEY etc.), which spams Tom's inbox with deploy-fail
# emails.

set -euo pipefail

REF="${VERCEL_GIT_COMMIT_REF:-}"
TARGET="${VERCEL_TARGET_ENV:-${VERCEL_ENV:-}}"

# Always build production deployments.
if [[ "$TARGET" == "production" ]]; then
  echo "[vercel-ignore] target=production — proceeding with build"
  exit 1
fi

# Skip agent-recommendation review branches.
if [[ "$REF" == agent/* ]]; then
  echo "[vercel-ignore] branch=$REF is an agent review-queue handoff — skipping build"
  exit 0
fi

echo "[vercel-ignore] branch=$REF — proceeding with build"
exit 1

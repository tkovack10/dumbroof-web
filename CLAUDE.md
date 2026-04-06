# dumbroof.ai — AI Brain

> Auto-loaded every session in this repo. Keep slim. Detailed knowledge lives in `~/USARM-Claims-Platform/memory/MEMORY.md` (the master brain).

---

## What this is

The **dumbroof.ai** web app — public-facing SaaS for storm damage claim packages. Companion to the local USARM CLI at `~/USARM-Claims-Platform`. Same pipeline (extract → analyze → generate 5 PDFs) but multi-tenant, mobile-first, paid via Stripe.

- **Frontend:** Next.js 15 (App Router) + React 19 + Tailwind 4 → **Vercel**
- **Backend:** FastAPI (Python) → **Railway** at `~/dumbroof-web/backend/`
- **DB + Storage + Auth:** Supabase (`hdiyncxkaadxnhwiyagn`)
- **Payments:** Stripe (LIVE)
- **Email:** Resend (`dumbroof.ai` verified — SPF/DKIM/DMARC live)

---

## Critical Deploy Rules

| What changed | How to deploy |
|---|---|
| Frontend (`src/`, `public/`, etc.) | `git push` → Vercel auto-deploys |
| Backend (`backend/processor.py`, etc.) | `cd backend && railway up -d` (does **NOT** auto-deploy from git) |
| Supabase migrations | Apply via `mcp__claude_ai_Supabase__apply_migration` OR `npx supabase db push`. **They do NOT auto-apply.** Verify after with REST query (E100) |

**NEVER use the local USARM `usarm_pdf_generator.py` for web claims.** Web claims live in Supabase/Railway. Fix `backend/processor.py` → `railway up -d` → reprocess from dumbroof.ai. Never upload local PDFs to "fix" a web claim.

---

## Domain & Network Gotchas

- **Always use `www.dumbroof.ai`** for backend → frontend API calls. Bare `dumbroof.ai` 307-redirects, and urllib doesn't follow POST redirects.
- **Railway domain:** `dumbroof-backend-production.up.railway.app`
- **Vercel project:** `dumbroof-web`
- **Production URL:** https://www.dumbroof.ai
- **Login (Tom):** `tkovack@usaroofmasters.com` / `FatCat219!`

---

## Directory Layout

```
~/dumbroof-web/
├── src/
│   ├── app/                          ← Next.js App Router
│   │   ├── page.tsx                  ← Homepage (Server Component, ISR 5 min, dynamic stats from Supabase)
│   │   ├── login/, signup/           ← Auth pages
│   │   ├── auth/callback/route.ts    ← OAuth callback (Google) — sends new users to /dashboard/new-claim
│   │   ├── auth/confirm/route.ts     ← Email confirmation (magic link / OTP)
│   │   ├── dashboard/                ← Authenticated user area
│   │   │   ├── new-claim/page.tsx    ← Upload form (the funnel killer — heavy form, mobile-hostile)
│   │   │   ├── claim/[slug]/         ← Claim detail (scope comparison, supplement composer, claim brain chat)
│   │   │   ├── photo-review/         ← Annotation feedback (training data)
│   │   │   ├── settings/             ← Profile, billing, Gmail OAuth, company branding
│   │   │   └── admin/                ← Admin-only views (Tom + USARM team)
│   │   └── api/                      ← Route handlers (server actions equivalents)
│   │       ├── billing/              ← Stripe quota/checkout/portal
│   │       ├── storage/sign-upload/  ← Signed-URL upload endpoint
│   │       ├── claim-brain/          ← Streaming SSE chat (Claude Sonnet)
│   │       ├── supplement-email/     ← Direct send via Gmail OAuth
│   │       └── reprocess/            ← Trigger Railway reprocessing
│   ├── components/                   ← Shared React components
│   ├── lib/
│   │   ├── supabase/                 ← server.ts, client.ts, middleware.ts, admin.ts
│   │   ├── upload-utils.ts           ← directUpload() — bypasses SDK to avoid Navigator.locks
│   │   ├── stripe.ts, stripe-config.ts
│   │   └── claim-constants.ts
│   ├── types/claim.ts                ← Shared Claim type (ALL dashboards import from here)
│   └── middleware.ts                 ← Routes /dashboard/* through Supabase session refresh
├── backend/                          ← FastAPI app deployed to Railway
│   ├── processor.py                  ← Main pipeline: extract → score → build config → generate PDFs → upload
│   ├── usarm_pdf_generator.py        ← Universal PDF generator (mirrored from local repo)
│   ├── carrier_playbooks/            ← Per-carrier intelligence
│   ├── damage_scoring/, fraud_detection/, hail_detection/, noaa_weather/, repair_ai/
│   └── requirements.txt
├── supabase/                         ← Migration SQL files
└── .env.local                        ← LIVE keys (never commit)
```

---

## Supabase — Critical Patterns

- **Project ref:** `hdiyncxkaadxnhwiyagn`
- **Env var:** `SUPABASE_SERVICE_KEY` (NOT `SUPABASE_SERVICE_ROLE_KEY`)
- **Read keys from `.env.local`** — they were rotated 2026-03-09; old keys in memory are stale

**Patterns to follow:**
- `.single()` throws on 0 rows — use `.limit(1)` then index `[0]` (E099)
- **NEVER init Supabase at module level in API routes** — use `function getSb() { return createClient(...) }` inside the handler. Module-level init fails at build time (E082)
- **NEVER use `supabase.storage.uploadToSignedUrl()`** — causes Navigator.locks timeout on mobile (E104). Always use `directUpload()` from `upload-utils.ts`
- Storage paths use subdirectories: `{user_id}/{slug}/photos/`, `/measurements/`, `/scope/`, etc.
- Sign-upload endpoint allows: own path → admin table → email domain match

**Key tables:**
- `claims` — main claim records (`scope_comparison` JSONB has 30+ fields after reprocess)
- `subscriptions` — Stripe state, `lifetime_claims_used`, `claims_used_this_period`
- `company_profiles` — white-label branding, Gmail OAuth refresh token
- `annotation_feedback` — proprietary training data, UNIQUE on photo_id, feeds few-shot examples
- `excluded_photos`, `excluded_line_items`, `line_item_feedback` — survive reprocess
- `claim_outcomes` — `source` field: `web` | `cli` | `backfill`. Filter platform metrics with `.not("claim_id", "is", null)` to exclude bulk imports
- `repair_checkpoints` — checkpoint system live in production

---

## Auth Flow Quirks

- **OAuth (Google):** `auth/callback/route.ts` exchanges code for session. New users (claims_count=0) → redirected to `/dashboard/new-claim`
- **Email confirm (magic link):** `auth/confirm/route.ts` verifies OTP. Currently redirects to `/dashboard` (NOT `/dashboard/new-claim`) — **inconsistency worth fixing**
- **Middleware** (`src/middleware.ts`) refreshes session on every `/dashboard/*` request. Server Components can't `setAll` cookies — that's fine, middleware handles it
- **Mobile WebView (`wv` user agent) breaks OAuth + file pickers** — Instagram/Facebook in-app browsers are a known funnel killer (April 2026 investigation)

---

## The 5 PDF Pipeline (mirrors local USARM)

1. Forensic Causation Report
2. Xactimate-Style Estimate
3. Scope Comparison Report (post-scope) / Pre-Scope (no #3)
4. Scope Clarification Letter
5. Cover Email

**Phases:** `pre-scope` (3 docs) | `post-scope` (5 docs)
**UPPA compliance:** check `compliance.user_role` before any carrier-facing language. Contractors CANNOT advocate. PAs/attorneys CAN.

---

## Email Rules (CRITICAL — Tom-confirmed)

1. Subject line = **claim number ONLY**
2. **BCC `claims@dumbroof.ai`** on ALL outbound emails
3. **CC company admin** (from `company_profiles.email`)
4. Say "**underscoped**" not "underpaid"
5. No advocacy language: "carrier must include" → "code-compliant installation requires"
6. Supplement Composer sends via **`/api/supplement-email/send`** directly — do NOT route through Claim Brain chat (tool approval loop doesn't complete)
7. Email poller only watches **`claims@dumbroof.ai`** — `hello@dumbroof.ai` is NOT picked up

---

## Stripe / Billing

- **Tiers:** Starter $0 (3 free lifetime) | Pro $499 (10/mo) | Growth $999 (30/mo) | Enterprise $2,999 (100/mo) | Sales Rep ($25/claim metered)
- **Coupon `FIRSTCLAIM50`** — 50% off first month, LIVE. Shows on claim detail after first claim completes for starter users
- Coupon names max **40 chars** in Stripe
- **Quota check:** `/api/billing/check-quota` (GET = check, POST = increment)
- New users have no `subscriptions` row → defaults to `starter` tier with 3 lifetime cap

---

## Common Commands

```bash
# Frontend dev
npm run dev                                    # localhost:3000
npm run build                                  # verify before push
git add -A && git commit -m "..." && git push  # → Vercel auto-deploy

# Backend (Railway)
cd backend && railway up -d                    # deploy
railway logs                                   # tail logs
railway run python -m noaa_weather --help      # run module in Railway env

# Supabase
npx supabase db push                           # apply migrations
# Or use mcp__claude_ai_Supabase__execute_sql / apply_migration

# Reprocess a stuck claim
curl -X POST https://dumbroof-backend-production.up.railway.app/api/reprocess/{claim_id}
```

---

## Companion Repos

| Repo | Purpose | Path |
|---|---|---|
| **USARM-Claims-Platform** | Local CLI brain (auto-loaded memory, slash commands, agents, carrier playbooks) | `~/USARM-Claims-Platform` |
| **dumbroof-marketing** | GTM strategy, ads, content calendar, brand guide, audience data | `~/dumbroof-marketing` |
| **USARM-Operations-Export** | Operations Platform (29 agents, MCP servers, 153K+ rows) | `~/USARM-Operations-Export` |

**The master brain is in `~/USARM-Claims-Platform/memory/MEMORY.md`** — 200+ lessons, error patterns, decisions, project tracker. When in doubt, reference it.

---

## When in this repo, prefer to:

- Stay in this directory for fast Glob/Grep on web code
- For carrier playbooks, error patterns, or any cross-cutting USARM knowledge → reference `~/USARM-Claims-Platform/memory/`
- For claim debugging → query Supabase directly (don't trust local files)
- Run `git push` after frontend changes (Vercel auto-deploys)
- Run `cd backend && railway up -d` after backend changes (Railway does NOT auto-deploy)

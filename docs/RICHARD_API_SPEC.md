# Richard API — Public Agent Endpoint Specification (v1)

**Status:** Draft (2026-04-26)
**Owner:** Tom Kovack Jr (CEO, Dumb Roof Technologies LLC)
**Audience:** Coinbase Agentic.market launch partners, agent developers, integration engineers

---

## Overview

Richard is DumbRoof's agentic insurance-claim engine — a tool-calling Claude agent that turns raw claim inputs (property address, EagleView measurements, damage photos) into a complete, carrier-ready supplement package: forensic causation report, Xactimate-style estimate, scope comparison, supplement letter, and cover email.

This spec exposes Richard as a **public, x402-callable endpoint** so any agent — running on Coinbase's Agentic.market, an enterprise CRM agent, a homeowner's personal AI, or another vertical SaaS — can pay-per-call to use Richard as a sub-task in a larger workflow. No login. No subscription. No human in the loop.

The agent IS the product. The API IS the UI.

---

## Authentication: x402

All endpoints require [HTTP 402 (Payment Required)](https://www.rfc-editor.org/rfc/rfc7231#section-6.5.2) authentication via the [x402 protocol](https://x402.org/) and Coinbase's [`coinbase/agentic-wallet-skills`](https://github.com/coinbase/agentic-wallet-skills) signing.

### Request flow

1. **Initial request without payment**
   ```http
   POST /v1/agent/process-claim HTTP/1.1
   Host: api.dumbroof.ai
   Content-Type: application/json
   ```
   ↓ Server responds:
   ```http
   HTTP/1.1 402 Payment Required
   WWW-Authenticate: x402 realm="api.dumbroof.ai",
                     network="base",
                     asset="USDC",
                     amount="50.00",
                     pay_to="0xDumbRoofWalletAddress",
                     resource="/v1/agent/process-claim",
                     expires_in="600"
   Content-Type: application/json
   {
     "error": "payment_required",
     "price_usd": 50.00,
     "asset": "USDC",
     "network": "base",
     "endpoint": "/v1/agent/process-claim",
     "docs": "https://api.dumbroof.ai/docs/x402"
   }
   ```

2. **Authorized request with payment proof**
   ```http
   POST /v1/agent/process-claim HTTP/1.1
   Host: api.dumbroof.ai
   Content-Type: application/json
   X-Payment: <base64-encoded x402 payment payload>
   ```
   The `X-Payment` header carries a signed payment commitment per the x402 spec — wallet address, amount, signature, nonce, and expiry. Server verifies on-chain (Base network), records the payment ID in the `x402_payments` table, and proceeds.

### Replay protection

Each `payment_id` is single-use. A duplicate `X-Payment` header returns `409 Conflict`. Successful payment IDs are persisted in Supabase for 90 days.

### Rate limits

- Per wallet: **100 requests / minute**, **5,000 requests / day**
- Burst protection: **10 requests / second** (token bucket)
- Limits enforced in Vercel Edge middleware before handler runs.

---

## Endpoints

### `POST /v1/agent/process-claim`

The flagship endpoint. Submits a claim for full processing. Returns a job ID; the package is built asynchronously (typical 90–180 seconds).

**Price:** $50.00 USDC

**Request body**
```json
{
  "property_address": "123 Main St, Albany, NY 12203",
  "carrier": "State Farm",
  "claim_number": "12-3456-7890",
  "date_of_loss": "2026-03-15",
  "eagleview_pdf_url": "https://signed.example.com/eagleview.pdf",
  "carrier_scope_pdf_url": "https://signed.example.com/scope.pdf",
  "photos": [
    {
      "url": "https://signed.example.com/photo01.jpg",
      "captured_at": "2026-03-20T14:32:11Z",
      "gps": {"lat": 42.6526, "lng": -73.7562, "heading": 180}
    }
  ],
  "user_role": "contractor",
  "callback_url": "https://your-agent.example.com/webhook/dumbroof"
}
```

**Required:** `property_address`, `eagleview_pdf_url` OR `measurements_inline`, `photos[]`
**Optional:** `carrier`, `claim_number`, `date_of_loss`, `carrier_scope_pdf_url`, `user_role` (defaults `contractor` for UPPA compliance), `callback_url`

**Response (202 Accepted)**
```json
{
  "job_id": "rch_01HXXXXXXXXXXXXXXXXXXXXXXX",
  "status": "queued",
  "estimated_seconds": 120,
  "poll_url": "/v1/agent/job/rch_01HXXXXXXXXXXXXXXXXXXXXXXX",
  "payment_id": "x402_01HYYYYYYYYYYYYYYYYYYYYYY",
  "amount_charged_usd": 50.00
}
```

If `callback_url` was supplied, the server `POST`s the same payload to that URL when the job reaches `succeeded` or `failed`.

---

### `GET /v1/agent/job/{job_id}`

Polls job status. **Free** — no x402 charge. Caller must supply the `job_id` returned by an earlier paid call (acts as opaque auth).

**Response — in progress**
```json
{
  "job_id": "rch_...",
  "status": "running",
  "progress": {"step": "extracting_measurements", "percent": 35},
  "started_at": "2026-04-26T14:00:00Z"
}
```

**Response — succeeded**
```json
{
  "job_id": "rch_...",
  "status": "succeeded",
  "completed_at": "2026-04-26T14:02:15Z",
  "outputs": {
    "claim_id": "clm_...",
    "forensic_report_url": "https://signed.dumbroof.ai/...?token=...",
    "estimate_url": "https://signed.dumbroof.ai/...?token=...",
    "scope_comparison_url": "https://signed.dumbroof.ai/...?token=...",
    "supplement_letter_url": "https://signed.dumbroof.ai/...?token=...",
    "cover_email_url": "https://signed.dumbroof.ai/...?token=...",
    "summary": {
      "carrier_rcv": 28450.12,
      "dumbroof_rcv": 47890.55,
      "variance_usd": 19440.43,
      "damage_score": 78,
      "approval_score": 64
    }
  },
  "expires_at": "2026-05-26T14:02:15Z"
}
```

**Response — failed**
```json
{
  "job_id": "rch_...",
  "status": "failed",
  "completed_at": "...",
  "error": {
    "code": "measurements_unreadable",
    "message": "EagleView PDF could not be parsed. Try re-uploading.",
    "refund_initiated": true,
    "refund_amount_usd": 50.00
  }
}
```

Signed URLs are valid for 30 days. After expiry, files are purged; caller must re-call `process-claim`.

---

### `POST /v1/agent/draft-supplement`

Lighter-weight call. Given a carrier scope already extracted (or a small payload), Richard returns a ready-to-send supplement letter draft.

**Price:** $5.00 USDC

**Request body**
```json
{
  "claim_id": "clm_...",  // optional: reference an existing job
  // OR provide payload inline:
  "carrier_scope": {
    "rcv": 28450.12,
    "line_items": [{"item": "RFG 240", "qty": 32, "unit": "SQ", "price": 268.00}]
  },
  "dumbroof_scope": {
    "rcv": 47890.55,
    "line_items": [...]
  },
  "carrier_name": "State Farm",
  "user_role": "contractor"
}
```

**Response (200 OK)**
```json
{
  "subject": "Supplement request — Claim 12-3456-7890",
  "body_html": "<p>Dear Adjuster Smith...</p>",
  "body_text": "Dear Adjuster Smith...",
  "differential_summary": {
    "missed_items": ["Underlayment", "Drip edge", "Ridge cap"],
    "underpriced_items": ["RFG 240"],
    "total_underpayment_usd": 19440.43
  },
  "carrier_playbook_used": "state_farm_v3"
}
```

---

### `POST /v1/agent/annotate-photo`

Single-photo damage annotation. Useful for streaming workflows where another agent already has photos and just needs the technical damage assessment.

**Price:** $0.50 USDC

**Request body**
```json
{
  "photo_url": "https://signed.example.com/photo.jpg",
  "context": {
    "address": "123 Main St",
    "date_of_loss": "2026-03-15",
    "expected_damage_type": "hail"  // optional: "hail", "wind", "tree", "any"
  }
}
```

**Response (200 OK)**
```json
{
  "annotation": "Hail impact, ~1.5 inch diameter, asphalt shingle granule loss with mat exposure. Severity: severe. Repairability: not repairable; full slope replacement indicated.",
  "tags": {
    "damage_type": "hail",
    "severity": "severe",
    "repairable": false,
    "slope": "south",
    "material": "asphalt_shingle"
  },
  "scoring": {
    "damage_score_contribution": 8.5,
    "evidence_strength": "high"
  }
}
```

---

### `GET /v1/agent/pricing`

Public, free, returns current pricing. Useful for agents that want to budget.

**Response (200 OK)**
```json
{
  "currency": "USD",
  "asset": "USDC",
  "network": "base",
  "endpoints": [
    {"path": "/v1/agent/process-claim", "price": 50.00, "unit": "per call"},
    {"path": "/v1/agent/draft-supplement", "price": 5.00, "unit": "per call"},
    {"path": "/v1/agent/annotate-photo", "price": 0.50, "unit": "per call"},
    {"path": "/v1/agent/job/{id}", "price": 0.00, "unit": "free polling"},
    {"path": "/v1/agent/pricing", "price": 0.00, "unit": "free"}
  ],
  "version": "v1.0",
  "last_updated": "2026-04-26"
}
```

---

## Error model

All errors follow this shape:
```json
{
  "error": "string_code",
  "message": "Human-readable description",
  "request_id": "req_01HZZZ...",
  "docs": "https://api.dumbroof.ai/docs/errors#string_code"
}
```

| HTTP | `error` code | When |
|---|---|---|
| 400 | `bad_request` | Missing required field, malformed JSON |
| 401 | `unauthenticated` | No `X-Payment` header on a paid endpoint |
| 402 | `payment_required` | x402 challenge response (initial call) |
| 402 | `payment_invalid` | Signature failed verification |
| 402 | `payment_expired` | Payment commitment past `expires_in` |
| 402 | `payment_underpaid` | Amount less than endpoint price |
| 409 | `payment_replay` | `payment_id` already used |
| 422 | `inputs_invalid` | EagleView unreadable, photos corrupt, etc. |
| 429 | `rate_limited` | Per-wallet rate limit hit; check `Retry-After` header |
| 500 | `internal_error` | Server-side failure; refund initiated automatically |
| 503 | `degraded` | Anthropic/Supabase upstream failure; retry with backoff |

---

## SLA

- **Availability target:** 99.5% monthly uptime (excluding scheduled maintenance).
- **`process-claim` p50 latency:** ≤ 120 seconds end-to-end.
- **`process-claim` p95 latency:** ≤ 300 seconds.
- **`draft-supplement` p50 latency:** ≤ 8 seconds.
- **`annotate-photo` p50 latency:** ≤ 4 seconds.
- **Refund policy:** any `failed` job with `error.refund_initiated: true` results in automatic on-chain refund within 24 hours.

---

## Security

- All endpoints HTTPS-only (TLS 1.3).
- Payment signatures verified against the Base network's USDC contract on-chain.
- Inputs sanitized; PDF/image uploads scanned for malicious payloads.
- Output signed URLs use short-lived JWTs (30-day expiry) with HMAC-SHA256 signing.
- No PII leakage between callers — each `job_id` is namespaced to its paying wallet.

---

## Sample integration (curl)

```bash
# 1. Get pricing
curl https://api.dumbroof.ai/v1/agent/pricing

# 2. Submit claim (initial unauthorized call to learn the price)
curl -X POST https://api.dumbroof.ai/v1/agent/process-claim \
  -H "Content-Type: application/json" \
  -d @claim_payload.json
# → 402 with x402 challenge

# 3. Sign payment with Coinbase agentic-wallet-skill, retry
curl -X POST https://api.dumbroof.ai/v1/agent/process-claim \
  -H "Content-Type: application/json" \
  -H "X-Payment: <signed-payload>" \
  -d @claim_payload.json
# → 202 with job_id

# 4. Poll
curl https://api.dumbroof.ai/v1/agent/job/rch_01HXXXX
# → 200 with status: succeeded + output URLs
```

---

## Sample integration (Coinbase agentic-wallet-skill)

```bash
# Install the skill (one-time)
npx skills add coinbase/agentic-wallet-skills

# In your agent code:
const result = await agent.callTool({
  name: "x402_call",
  endpoint: "https://api.dumbroof.ai/v1/agent/process-claim",
  body: { property_address: "123 Main St...", photos: [...] },
  max_price_usd: 50.00
});
// Wallet auto-pays, returns job_id
```

---

## Listing on Agentic.market

Submit listing at <https://agentic.market/list-service> with:

- **Service name:** Richard — DumbRoof Claim Brain
- **Category:** Insurance / Real Estate Services
- **Description:** "AI agent that turns property damage photos and a carrier scope into a complete supplement package. Used by US roofing contractors to recover an average of $19,440 per claim."
- **Pricing model:** Per-call x402 ($0.50 – $50)
- **API spec URL:** `https://api.dumbroof.ai/docs/openapi.json`
- **Sample agent integration:** GitHub repo with end-to-end example
- **Logo:** `dumbroof-web/public/dumbroof-icon-400.png`

---

## Roadmap (post-v1)

- **v1.1:** WebSocket / SSE streaming for `process-claim` progress (real-time tool-call narration).
- **v1.2:** Native bulk endpoint (`POST /v1/agent/process-claims-batch`) with volume discount.
- **v1.3:** Agent-to-agent webhook for inbound claims (carrier agents push directly).
- **v1.4:** Reverse direction — DumbRoof's Richard becomes a CALLER of other agentic services (e.g., title verification, weather verification).
- **v2.0:** Outcome-based pricing tier (lower fixed price + small % of supplement won, on-chain settled via x402 escrow).

---

## Changelog

- **2026-04-26 — v1.0 draft.** Initial public spec. Subject to revision before launch.

---

*This document is the canonical Richard public-API contract. For internal Richard architecture and tool catalog, see `~/USARM-Claims-Platform/CLAUDE.md` and `dumbroof-web/backend/claim_brain_tools.py`.*

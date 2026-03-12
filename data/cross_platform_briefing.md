# dumbroof.ai — Cross-Platform Briefing

> Paste into USARM-Claims-Platform terminal so the Operations Platform knows everything the Web Platform can do.

---

## What dumbroof.ai IS

Self-service web platform where contractors upload source docs (carrier scopes, EagleView, CompanyCam, photos) and receive the same 5-document PDF appeal package that USARM-Claims-Platform generates — fully automated, zero Claude Code interaction.

**Stack:** Next.js 15 (Vercel) + FastAPI (Railway) + Supabase (Auth/DB/Storage) + Claude API + Cloudflare (email routing)

**Live URLs:**
- Frontend: Vercel deployment (dumbroof.ai)
- Backend: `dumbroof-backend-production.up.railway.app`
- Email: `claims@dumbroof.ai` (Cloudflare → Gmail poller → AI analysis)

---

## Frontend Routes (12 pages)

| Route | Purpose |
|-------|---------|
| `/` | Landing page + beta signup + inspector application |
| `/login` | Supabase Auth |
| `/dashboard` | Claims list (5s status polling) |
| `/dashboard/claim/[id]` | Claim detail + PDF downloads |
| `/dashboard/new-claim` | Upload source docs → trigger processing |
| `/dashboard/new-repair` | Upload photos + leak notes → repair diagnosis |
| `/dashboard/repairs` | Repairs list |
| `/dashboard/repair/[id]` | Repair detail + PDF downloads |
| `/dashboard/analytics` | Portfolio analytics (pricing, settlement predictions) |
| `/dashboard/correspondence` | Carrier email threads + AI draft responses |
| `/dashboard/settings` | User preferences |
| `/admin` | Beta signups, user management |

---

## Backend API (30+ endpoints)

### Core Processing
- `POST /api/process/{claim_id}` — Trigger claim processing (async)
- `POST /api/reprocess/{claim_id}` — Re-process after new uploads
- `POST /api/process-repair/{repair_id}` — Trigger repair processing
- `POST /api/reprocess-repair/{repair_id}` — Re-process repair

### Analytics & Intelligence
- `GET /api/analytics/overview` — Portfolio-wide stats
- `GET /api/analytics/processing-costs` — Per-claim cost breakdown
- `GET /api/analytics/pricing` — Regional vs carrier vs settlement pricing
- `GET /api/analytics/photos` — Photo portfolio analytics
- `GET /api/analytics/predict` — Settlement range prediction (carrier + trades + state + area + hail)
- `GET /api/intelligence/carriers` — All carrier scores
- `GET /api/intelligence/carrier/{name}` — Detailed carrier intelligence
- `GET /api/intelligence/arguments/{name}` — Most effective arguments by trade
- `GET /api/intelligence/suggest/{name}` — Pre-claim argument suggestions

### Weather
- `POST /api/noaa-scan` — NOAA storm events near address (18-month lookback)

### Email Correspondence
- `POST /api/analyze-correspondence/{id}` — AI analysis of carrier email
- `GET /api/correspondence/{claim_id}` — All correspondence for claim
- `GET /api/drafts/{claim_id}` — Pending AI drafts
- `PUT /api/drafts/{id}` — Edit/approve/reject draft
- `POST /api/drafts/{id}/send` — Mark sent
- `POST /api/drafts/{id}/regenerate` — Regenerate with different strategy

### Forwarders & Edit Requests
- `GET/POST/DELETE /api/forwarders` — Authorized sales reps
- `GET/PUT /api/edit-requests/{id}` — User edit requests
- `POST /api/edit-requests/{id}/apply` — Apply edits to claim config

---

## Processing Pipeline

```
User uploads → Supabase Storage → Backend triggered
→ Download source docs (PDF, ZIP, EML, images)
→ Extract images (pdfimages, unzip, MIME parse)
→ Convert formats (HEIC, TIFF, BMP, RAW → JPEG)
→ Resize (max 1024px, 60% quality)
→ Claude: extract_measurements() from PDF
→ Claude: analyze_photos() in 5-photo batches
→ Build claim_config.json
→ usarm_pdf_generator.py → 5 PDFs
→ Upload PDFs to Supabase Storage
→ Status = "ready"
```

**Cost:** ~$0.18/claim (5 photos + measurement PDF) to ~$1.15 (100 photos)

---

## Trade Gating (CRITICAL — 2026-03-08 fix)

Siding and gutters are **opt-in via `estimate_request` checkboxes ONLY** — NOT from AI photo detection.

```python
_est_req = claim.get("estimate_request") or {}
trades = ["roofing"]  # Always included
if _est_req.get("siding"):
    trades.append("siding")
if _est_req.get("gutters"):
    trades.append("gutters")
```

**Why:** Claude photo analysis is non-deterministic — same photos produce different `trades_identified` across runs. User checkboxes are the source of truth.

---

## Repair AI Module

**22 diagnostic codes** for leak diagnosis:
- Chimney (4): CHM-FRONT, CHM-SIDE, CHM-BACK, CHM-MASONRY
- Roof-to-wall (4): WALL-STEP, WALL-KICKOUT, HEADWALL, STUCCO-ABOVE-ROOF
- Penetration (2): VENT-BOOT, VENT-METAL
- Skylight (2): SKYLIGHT-FLASH, SKYLIGHT-UNIT
- Valley (3): VALLEY-OPEN-METAL, VALLEY-CLOSED-CUT, VALLEY-DEBRIS-ICE
- Edge/weather (3): EAVE-ICE-DAM, EAVE-DRIP-EDGE, GUTTER-BACKUP
- Field (1): FIELD-SHINGLE | Fastener (1): NAIL-POP | Special (2): CONDENSATION, LOW-CONFIDENCE-VERIFY

**Pricing:** $250 diagnostic fee + $85/hr labor + 2x retail materials + 20% markup. Min job $450.
**Languages:** English + Spanish (field crew terminology)
**Skill levels:** Laborer (step-by-step) | Journeyman (professional) | Technician (checklist)

---

## Email Ingestion System

```
Carrier email → Cloudflare Email Routing → Worker (postal-mime)
→ Supabase Edge Function → Gmail poller matches to claim
→ AI analyzes stance → generates draft response → user reviews → sends via Nodemailer
```

**Matching logic (descending confidence):** Thread ID → claim number → address → carrier domain → subject keywords → manual fallback

**AI analysis:** Stance detection, argument extraction, weakness identification, Socratic rebuttal drafts

---

## Database (Supabase — 15+ tables)

| Table | Purpose |
|-------|---------|
| `claims` | Claim metadata, status, phase, estimate_request |
| `repairs` | Repair jobs with status and cost |
| `photos` | Forensic tags, fraud scores, EXIF, damage type, material, trade |
| `line_items` | Dual-sided scope (USARM vs carrier) with variance |
| `carrier_tactics` | Denial patterns, underpayment signals |
| `claim_outcomes` | Win/loss with settlement amounts |
| `pricing_benchmarks` | Regional pricing comparison |
| `processing_logs` | Cost tracking per step |
| `carrier_correspondence` | Inbound carrier emails, AI stance |
| `email_drafts` | AI response drafts with compliance role |
| `authorized_forwarders` | Sales rep email mapping |
| `edit_requests` | User edit requests for configs |
| `beta_signups` | Beta applicants |
| `inspector_applications` | HAAG-certified inspector apps |

**Storage bucket:** `claim-documents` — organized as `/{user_id}/{claim_id}/{source_docs,photos,output}/`

---

## AI Module Map

| Module | Model | Input | Output |
|--------|-------|-------|--------|
| Measurement extraction | Sonnet 4.6 | PDF (base64) | Roof area, pitches, walls |
| Photo analysis | Sonnet 4.6 | 5 images/batch | Damage types, findings, trades |
| Hail detection | Sonnet 4 | Single image | Hail vs blister vs mechanical vs wear |
| Chalk test validation | Sonnet 4 | Image | Soft metal compliance |
| Fraud detection | Vision API | Image | Editing flags, manipulation |
| Repair diagnosis | Opus 4.1 | Photos + notes | 22-code diagnosis + steps + price |
| Email analysis | Opus 4.1 | Email + claim | Stance, arguments, weaknesses |
| Draft generation | Opus 4.1 | Email + claim | Socratic/factual rebuttal options |

---

## Fraud Detection (Phase 1)

| Check | Method | Severity |
|-------|--------|----------|
| Duplicate photos | Perceptual hash (pHash) | warning |
| EXIF timestamp | Compare to claim dates | critical |
| Editing software | EXIF metadata | warning |
| GPS consensus | All photos ≤10mi from property | critical |
| GPS consistency | Photos ≤1km from median | warning |
| Manipulation | Claude Vision (artifacts, splicing) | warning |

Output: Per-photo fraud score (0-100) + aggregate claim status (clean | review_needed | critical)

---

## Business Logic (shared with USARM-Claims-Platform)

- **Financial formulas:** Same (Line Item Total → Tax → RCV → O&P → Total → Net Claim)
- **O&P rule:** 3+ trades = 10%+10%
- **Tax:** NY=8%, PA=0%, NJ=6.625%
- **Pricing:** NYBI26, PAPI26, NJBI26
- **UPPA compliance:** Same role-based gating (contractor=safe, PA/attorney=advocacy)
- **Siding always includes:** House wrap, wall flashing, shutters, window wraps
- **Roofing always includes:** Underlayment, I&W, drip edge, starter, ridge cap, flashing

---

## Integration Points with USARM-Claims-Platform

| Area | How they connect |
|------|-----------------|
| PDF generator | Same `usarm_pdf_generator.py` (shared codebase) |
| Claim configs | Same JSON schema (`claim_config.json`) |
| Carrier playbooks | Web platform reads from same playbook intelligence |
| Pricing tables | Same NYBI26/PAPI26 tables |
| NOAA weather | Same county+date+event-type query logic |
| Dashboard sync | Web claims sync to same Google Sheet via API |
| Fraud detection | Same module, callable from both platforms |
| Damage scoring | Same dual-score system (DS + TAS) |

---

## Key Operational Notes

- **Reprocess endpoint:** `POST /api/reprocess/{claim_id}` — resets to processing state
- **Railway deploys:** `git push` to main triggers deploy; restarts kill in-flight processing
- **Supabase bucket:** `claim-documents` (NOT `claim-files`)
- **Photo filtering:** Max 100 photos per claim; non-inspection images filtered from count
- **Rate limiting:** 3-retry exponential backoff (60s, 120s, 180s) on Claude API
- **Email polling:** Every 60s on `claims@dumbroof.ai`
- **Dashboard polling:** Every 5s for claim status updates

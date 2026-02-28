# DumbRoof.ai — Full Technical Audit
## From User Input to PDF Output: Complete Algorithm Walkthrough

**Prepared for:** META & McKinsey Technical Review
**Date:** February 28, 2026
**Platform:** dumbroof.ai (powered by USARM Claims Platform)

---

## System Architecture (30-Second Overview)

```
USER (browser)
  │
  ├─ Next.js Frontend (Vercel) ─── Supabase Auth + Storage + DB
  │                                       │
  │                                       │ polls every 10s
  │                                       ▼
  │                              FastAPI Backend (local)
  │                                       │
  │                              ┌────────┼────────┐
  │                              ▼        ▼        ▼
  │                          Claude AI  Fraud     PDF
  │                          (Sonnet)   Detection Generator
  │                              │        │        │
  │                              └────────┼────────┘
  │                                       │
  │                                       ▼
  └──────────────── 3 or 5 PDF Appeal Package ◄──────────
```

**Stack:** Next.js 14 + Supabase + FastAPI + Claude Sonnet 4.6 + Chrome Headless PDF

---

## STAGE 1: User Input & Submission

**File:** `src/app/dashboard/new-claim/page.tsx`

### 1.1 Form Fields

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Property Address | text | YES | HTML required only |
| Insurance Carrier | text | YES | HTML required only |
| Measurement Files | file (.pdf) | YES | Single file, extension check |
| Inspection Photos | file (.jpg/.png/.pdf/.heic) | YES | Multiple files, extension check |
| Carrier Scope | file (.pdf) | NO | Single file — **determines 3 vs 5 PDFs** |
| Weather Data | file (.pdf/.jpg/.png) | NO | Multiple files |
| Notes for AI | textarea | NO | Free-form context |

### 1.2 Phase Decision (Critical Fork)

```
IF carrier scope uploaded:
    phase = "post-scope"  → generates 5 PDFs (full appeal package)
ELSE:
    phase = "pre-scope"   → generates 3 PDFs (intro package for adjuster)
```

### 1.3 Upload Flow

```
1. Generate slug from address: "123 Main St" → "123-main-st-1709150400000"
2. Upload each file to Supabase Storage:
     Path: claim-documents/{user_id}/{slug}/{category}/{filename}
     Categories: measurements/, photos/, scope/, weather/
3. Insert claim record to Supabase DB:
     status: "uploaded"
     phase: "pre-scope" or "post-scope"
     file arrays: measurement_files[], photo_files[], scope_files[], weather_files[]
```

---

## STAGE 2: Backend Polling & Claim Pickup

**File:** `backend/main.py`

### 2.1 Polling Loop

```python
async def poll_for_claims():
    while True:
        result = sb.table("claims").select("id").eq("status", "uploaded").execute()
        for claim in result.data:
            await run_processing(claim["id"])
        await asyncio.sleep(10)
```

### 2.2 Status Transitions

```
uploaded ──(poller detects)──► processing ──(success)──► ready
                                    │
                                    └──(failure)──► error (with error_message)
```

### 2.3 Reprocess Flow (Revised Scope)

```
User clicks "Reprocess" on claim page
  → Frontend sets status = "uploaded" in Supabase
  → Poller picks it up within 10 seconds
  → Backend detects existing output_files → treats as revision
  → Diffs old vs new carrier scope
  → Regenerates all PDFs
  → If carrier movement ≥ 5% → auto-marks as WIN
```

---

## STAGE 3: File Download & Photo Extraction

**File:** `backend/processor.py`

### 3.1 Download from Supabase Storage

Files are downloaded with automatic retry (3 attempts with exponential backoff: 5s, 10s, 20s).

```
For each file category (measurements, photos, scope, weather):
    Download from: claim-documents/{file_path}/{category}/{filename}
    Save to: /tmp/dumbroof_XXXX/{category}/
```

### 3.2 Photo Extraction Decision Tree

```
FOR each photo file:
  IF file is .pdf (CompanyCam):
    TRY pdfimages (poppler):
      Extract all embedded JPEGs
      Skip files < 30KB (logos/UI elements)
    IF pdfimages fails OR extracts 0 images:
      FALLBACK to PyMuPDF (fitz):
        Extract via xref deduplication
        Skip < 400×300 px (thumbnails)
        Skip aspect ratio > 3:1 (banners)
        Skip < 50KB (icons)
        Convert CMYK → RGB if needed
  ELSE (direct .jpg/.png/.heic):
    Copy directly to photos directory
```

---

## STAGE 4: AI Analysis Pipeline (Claude Sonnet 4.6)

**File:** `backend/processor.py`

### 4.1 Stage Overview (Parallelized)

All five extraction steps run concurrently via `asyncio.gather()` + `asyncio.to_thread()`:

```
┌─────────────────────────────────────────────────────────┐
│             PARALLEL EXECUTION GROUP                     │
│                                                         │
│  1. Extract Measurements  ┐                             │
│     (1 API call, ~20s)    │                             │
│                           │                             │
│  2. Analyze Photos        ├──► asyncio.gather()         │
│     (2-4 API calls, 2-4m) │    all run concurrently     │
│                           │                             │
│  3. Photo Integrity       │                             │
│     (1 API call, ~30s)    │                             │
│                           │                             │
│  4. Extract Carrier Scope │                             │
│     (1 API call, ~40s)    │                             │
│                           │                             │
│  5. Extract Weather Data  ┘                             │
│     (1 API call, ~20s)                                  │
├─────────────────────────────────────────────────────────┤
│ 6. Web Search Weather   ← DuckDuckGo corroboration     │
│    (~20s)                                               │
├─────────────────────────────────────────────────────────┤
│ 7. Executive Summary    ← All findings → Claude         │
│    (1 API call, ~20s)                                   │
├─────────────────────────────────────────────────────────┤
│ 8. Conclusion Synthesis ← All findings → Claude         │
│    (1 API call, ~20s)                                   │
└─────────────────────────────────────────────────────────┘
Total: 8-10 Claude calls, ~3-4 minutes, ~70K tokens, ~$0.35/claim
```

### 4.2 Measurement Extraction

**Input:** EagleView/HOVER PDF (base64-encoded)
**Model:** claude-sonnet-4-6, 4096 max tokens

**Output:**
```json
{
  "property": { "address", "city", "state", "zip" },
  "structures": [{
    "roof_area_sf": 2000,
    "roof_area_sq": 20,
    "waste_factor": 1.10,
    "predominant_pitch": "6/12",
    "pitches": [{"pitch": "6/12", "area_sf": 2000, "percent": 100}],
    "facets": 6,
    "style": "hip | gable | combination"
  }],
  "measurements": { "ridge", "hip", "valley", "rake", "eave", "drip_edge" },
  "penetrations": { "pipes", "vents", "skylights", "chimneys" }
}
```

### 4.3 Photo Analysis

**Input:** Photos in batches of 5 (base64-encoded)
**Model:** claude-sonnet-4-6, 4096 max tokens per batch

**Output per batch (merged across all batches):**
```json
{
  "damage_summary": "Professional forensic summary...",
  "photo_annotations": { "photo_01": "Forensic observation..." },
  "shingle_type": "architectural laminated | 3-tab | slate | tile | metal | copper",
  "trades_identified": ["roofing", "gutters", "siding"],
  "key_findings": ["Finding 1...", "Finding 2..."],
  "code_violations": [{"code": "RCNYS R905.2.8.5", "description": "Missing drip edge"}],
  "damage_type": "hail | wind | combined",
  "severity": "minor | moderate | severe"
}
```

### 4.4 Photo Integrity / Fraud Detection

**Input:** Sample of up to 10 photos
**Purpose:** Proprietary fraud verification stamped on every PDF

**Output:**
```json
{
  "photo_integrity": {
    "total_analyzed": 10,
    "flagged": 0,
    "score": "100%",
    "stamp": "PHOTO INTEGRITY VERIFIED — 100% | 10 photos analyzed, 0 flagged"
  }
}
```

### 4.5 Carrier Scope Extraction (post-scope only)

**Input:** Carrier's insurance estimate PDF
**Output:**
```json
{
  "carrier": { "name", "claim_number", "policy_number", "adjuster_email", "inspection_date" },
  "carrier_rcv": 1500.00,
  "carrier_line_items": [
    { "item": "Remove shingles", "carrier_amount": 74.00, "qty": 12, "unit": "SQ" }
  ],
  "carrier_arguments": ["Damage is cosmetic", "Age exceeds life expectancy"],
  "carrier_acknowledged_items": ["Hail damage on front slope"]
}
```

### 4.6 Weather Data & Corroboration

**Input:** HailTrace PDF + DuckDuckGo web search
**Output:**
```json
{
  "hail_size": "1.75",
  "storm_date": "2025-07-03",
  "storm_description": "Severe hailstorm with 40+ mph winds",
  "nws_reports": ["NWS Storm Report 2025-07-03"],
  "corroborating_sources": [
    {"title": "NOAA Storm Events", "url": "...", "source_type": "NOAA"}
  ]
}
```

---

## STAGE 5: Config Building & Line Item Pricing

**File:** `backend/processor.py`

### 5.1 Config Assembly

All extracted data from Stage 4 is merged into a single `claim_config.json`.

### 5.2 External Pricing System

All Xactimate prices are loaded from `backend/pricing/nybi26.json` at module startup. To update prices, edit the JSON file — no code changes needed.

### 5.3 Financial Calculation Engine

```
Line Total    = Σ(qty × unit_price)
Tax           = Line Total × tax_rate
RCV           = Line Total + Tax
O&P           = Line Total × 0.10 × 2  (if 3+ trades, else 0)
Total         = RCV + O&P
Net Claim     = Total - Deductible
Variance      = Total - Carrier RCV
```

**Tax rates:** NY=8%, PA=0%, NJ=6.625%. Unknown states log warning and default to 8%.

---

## STAGE 6: Fraud Detection Pipeline (Phase 1 MVP)

**File:** `fraud_detection/` (11 Python modules)

### 6.1 Four-Check Pipeline

| Check | What It Does | Tier If Flagged |
|-------|-------------|-----------------|
| EXIF Timestamp | Photo date within 90 days of reference | T1: 90-180 days, T2: 180+ or future |
| GPS Distance | Photo location vs. property address (Haversine) | T1: 0.25-0.5mi, T2: 0.5-2mi, T3: >2mi |
| Editing Software | Photoshop/Lightroom/GIMP in EXIF | T2: editing software detected |
| Duplicate Detection | Perceptual hash cross-claim match (indexed in SQLite) | T2: near-match, T3: exact duplicate |

### 6.2 Three-Tier Flagging System

| Tier | Severity | Action |
|------|----------|--------|
| TIER 1 | Informational (Yellow) | Accepted with note |
| TIER 2 | Review Required (Orange) | Held from reports, admin review |
| TIER 3 | Critical (Red) | Reports suspended, legal review |

---

## STAGE 7: PDF Generation (5-Document Package)

**File:** `usarm_pdf_generator.py` (2,250 lines)

### 7.1 Generation Pipeline

```
claim_config.json
    │
    ├──► build_forensic_report()    → HTML → Chrome Headless → 01_FORENSIC_CAUSATION_REPORT.pdf
    ├──► build_xactimate_estimate() → HTML → Chrome Headless → 02_XACTIMATE_ESTIMATE.pdf
    ├──► build_supplement_report()  → HTML → Chrome Headless → 03_SUPPLEMENT_REPORT.pdf
    ├──► build_appeal_letter()      → HTML → Chrome Headless → 04_DENIAL_APPEAL_LETTER.pdf
    └──► build_cover_email()        → HTML → Chrome Headless → 05_COVER_EMAIL.pdf
```

Chrome headless conversion includes:
- 180-second timeout with explicit error on timeout
- Return code validation
- Blank PDF detection (< 1KB = error, not silent success)
- Config validation before generation (checks all required fields)

### 7.2 Role-Based Language System (4 tiers)

| Role | Trigger | Tone | Regulatory Citations |
|------|---------|------|---------------------|
| ADVOCATE | `user_role == "public_adjuster"` | Formal demand | Yes (§2601, NYCRR) |
| CONTRACTOR_AOB | contractor + has_aob | Firm request | Yes |
| CONTRACTOR | contractor, no AOB | Professional request | No (liability) |
| HOMEOWNER | default | Simplified request | No |

---

## STAGE 8: Revision Detection & Win Tracking

### 8.1 Scope Diffing Algorithm

```
1. Load previous carrier data (from DB or local config)
2. Normalize all line item descriptions (lowercase, trim)
3. Compare old vs new carrier line items:
   - ADDED: In new scope but not old
   - INCREASED: Same item, amount increased > 5%
   - REMOVED: In old scope but not new
4. Send diff to Claude → map each change to USARM argument that drove it
5. Calculate movement: new_rcv - old_rcv
```

### 8.2 Win Detection

```
IF movement > 0 AND movement_pct >= 5%:
    status = "won"
    phase = "Settled"
    carrier_current = new_rcv
```

---

## STAGE 9: Output Upload & User Delivery

### 9.1 Error Handling

Processing errors are stored with a descriptive message in the claims table (`error_message` column). Users see the specific error on the claim detail page instead of a generic "Processing failed" message.

### 9.2 Dashboard Sync

```
1. Upload PDFs to Supabase Storage
2. Copy PDFs to ~/USARM-Claims-Platform/claims/{slug}/pdf_output/
3. Save claim_config.json locally
4. Update carrier playbook
5. Run: python3 sync_dashboard.py --update-html
6. Git commit + push → live dashboard at GitHub Pages
7. Sync to Google Sheet via Zapier MCP API
```

---

## PERFORMANCE PROFILE

| Metric | Value |
|--------|-------|
| **Processing time** | 3-5 min (parallelized, down from 5-10 min) |
| **Claude API calls** | 8-10 per claim |
| **Token usage** | ~70,000 tokens/claim |
| **Cost per claim** | ~$0.35 (Claude Sonnet) |
| **Photo capacity** | 30+ photos per claim |
| **PDF size** | 5-25 MB per package |
| **Fraud DB** | 1,057 photos indexed, 21+ claims |

---

## ISSUES ADDRESSED (2026-02-28 Audit)

| # | Issue | Fix Applied |
|---|-------|-------------|
| 1 | Chrome timeout = silent blank PDF | Error handling: timeout catch, returncode check, blank detection (< 1KB) |
| 2 | Hardcoded NYBI26 pricing | External `backend/pricing/nybi26.json` — JSON edit, no code changes |
| 3 | No config schema validation | `validate_config()` checks all required sections and fields before generation |
| 4 | Error details not stored | `error_message` column in claims table, displayed on claim detail page |
| 5 | Sequential Claude calls | `asyncio.gather()` + `asyncio.to_thread()` for 5 parallel extraction steps |
| 6 | No retry on file download | 3-retry with exponential backoff (5s, 10s, 20s) |
| 10 | Slug collision | Timestamp appended to slug: `123-main-st-1709150400000` |
| 12 | SQLite no index on phash | Already existed: `CREATE INDEX idx_phash ON photo_hashes(phash)` |
| 15 | 3-state tax rates only | Warning logged for unknown states instead of silent 8% default |

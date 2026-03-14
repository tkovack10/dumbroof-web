# Meta / Facebook Ads — Setup Reference for dumbroof.ai

> Created 2026-03-14 by Operations Platform AI.
> This doc explains the full Meta ad infrastructure so any agent working on dumbroof.ai knows how to access and create ads.

---

## Ad Account

All ads run under the **USA Roof Masters** Meta ad account (single account for both USARM roofing brand and dumbroof.ai tech brand).

### How to Get Into Ads Manager
1. Go to **adsmanager.facebook.com**
2. Log in as Tom: `tkovack@usaroofmasters.com`
3. You'll see the USA Roof Masters ad account — this is correct, dumbroof.ai ads run here too
4. Click "+ Create" to start a new campaign

### Who Has Access
- **Tom Kovack Jr.** (tkovack@usaroofmasters.com) — full admin
- **Kirstin Gonzaga** (kirstin@usaroofmasters.com) — admin
- **Nobody else.** Verified clean after LB Capital forensic audit. Do NOT add anyone without Tom's explicit approval.

### API Access (for Claude agents)
- **Method:** Zapier MCP tool `facebook_custom_audiences_api_request_beta`
- **Graph API:** `https://graph.facebook.com/v21.0/`
- **Auth:** OAuth handled automatically by Zapier
- **Account discovery:** `GET me/adaccounts` (account ID is censored by Zapier, use campaign IDs directly)
- **Gotcha:** Nested insights queries return nulls — query each campaign's `/insights` endpoint individually

---

## dumbroof.ai Pixel + Conversion Tracking (ALREADY INSTALLED)

The Meta pixel is installed on this website (dumbroof-web):

| Setting | Value |
|---------|-------|
| **Pixel ID** | `766657346239697` |
| **CAPI Token** | In `.env.local` → `FACEBOOK_CAPI_TOKEN` |
| **Tracks** | Beta signups, page views |
| **Implementation** | Next.js env vars, server-side CAPI |

This means any ads pointing to dumbroof.ai will automatically track conversions.

---

## Target Audiences (UPLOADED / READY)

### Seed Audience: "Roofing Company Owners" (469 people)
- **Source:** Extracted from Mike Coday's "Roofing Company Owners" Facebook group
- **Data location:** `/Users/thomaskovackjr/dumbroof-marketing/fb-group-data/`
- **Full analysis:** `/Users/thomaskovackjr/dumbroof-marketing/fb-group-data/audience-intelligence.md`

**To upload as Custom Audience in Ads Manager:**
1. Go to Ads Manager > Audiences > Create Audience > Custom Audience
2. Select "Customer list"
3. Upload the CSV (columns: fn, ln, ct, st, country)
4. Expected match rate: 15-25% (name-only matching)

**Segments:**
| Segment | Count | Who |
|---------|-------|-----|
| A — Storm/Insurance Restoration | 26 | Storm Warrior Roofing, HailCo, Summit Roofing — WARMEST |
| B — General Roofing Owners | 183 | Core roofing company owners |
| C — Exteriors/Siding/Construction | 46 | Adjacent trades |
| D — Unknown | 171 | No company listed |

### Lookalike Audiences (Create After Upload)
Once the seed audience is uploaded:
- **1% Lookalike** (~2.3M people) — primary prospecting, create this first
- **3% Lookalike** (~6.9M people) — scale when 1% is working
- **5% Lookalike** (~11.5M people) — broad awareness only

### Interest Targeting (Fully Mapped)
All targeting layers documented in: **`/Users/thomaskovackjr/dumbroof-marketing/ads/facebook/expanded-targeting.md`**

**High-intent software interests (use these first):**
- AccuLynx (10K-30K audience) — **highest intent, these are our exact users**
- JobNimbus (15K-40K)
- CompanyCam (20K-50K)
- EagleView (30K-80K)
- Xactimate (40K-100K)
- RoofSnap (10K-25K)

**Manufacturer interests (broader reach):**
- GAF (200K-500K), CertainTeed (100K-300K), Owens Corning (300K-600K)

**Distributor interests:**
- ABC Supply (150K-300K), SRS/QXO (50K-120K), Beacon (80K-200K)

---

## Campaign Structure ($4,000/month Plan)

Full budget allocation in: **`/Users/thomaskovackjr/dumbroof-marketing/ads/facebook/audience-config.md`**

| Campaign | Budget | Purpose |
|----------|--------|---------|
| Core Prospecting | $2,000/mo (50%) | Vendor stack + manufacturers + lookalikes |
| Geographic Conquest | $800/mo (20%) | DFW, Houston, Atlanta, PA/NY, Hail Belt |
| Adjacent Audiences | $400/mo (10%) | Public adjusters, insurance attorneys |
| Employee Influence | $400/mo (10%) | Sales reps, estimators at roofing companies |
| Retargeting | $400/mo (10%) | Website visitors, video viewers, seed audience |

---

## Ad Creatives (Ready to Build)

Full copy + specs in: **`/Users/thomaskovackjr/dumbroof-marketing/ads/facebook/ad-copy.md`**

| Creative | Format | Message | CTA |
|----------|--------|---------|-----|
| "The Impossible Choice" | 30-sec video | "5 forensic-grade documents in 15 minutes" | Sign Up Free |
| "The Number" | Static image | "$20,469 → $943,233. Same claim." | Learn More |
| "15 Minutes" | 5-card carousel | Old way → Outsourcing → AI → Results → CTA | Get Started |

**Brand colors:** Signal Blue #2563EB, dark backgrounds, white text

---

## USA Roof Masters Active Campaigns (for reference)

The USARM roofing brand has 14 campaigns running in the same ad account:
- 4 active Binghamton NY campaigns ($200/day total)
- 10 legacy PA/NJ campaigns (lifetime budgets)
- Monitored hourly via `/fb-ads` agent in Operations repo
- **Do not pause or modify USARM campaigns** — they're managed by the Operations platform

---

## File Map

| What You Need | Where It Lives |
|---------------|---------------|
| Log into Ads Manager | adsmanager.facebook.com (Tom's Google login) |
| Pixel ID + CAPI token | `dumbroof-web/.env.local` |
| Seed audience CSV (469 owners) | `dumbroof-marketing/fb-group-data/` |
| Audience analysis + segments | `dumbroof-marketing/fb-group-data/audience-intelligence.md` |
| Full targeting taxonomy | `dumbroof-marketing/ads/facebook/expanded-targeting.md` |
| Ad copy + creative specs | `dumbroof-marketing/ads/facebook/ad-copy.md` |
| Campaign budget plan | `dumbroof-marketing/ads/facebook/audience-config.md` |
| FB group scraping pipeline | `dumbroof-marketing/ads/facebook/fb-group-pipeline.md` |
| USARM ad monitoring | `USARM-Operations-Export/.claude/commands/fb-ads.md` |
| USARM ad account details | `USARM-Operations-Export/memory/facebook-ads-account.md` |

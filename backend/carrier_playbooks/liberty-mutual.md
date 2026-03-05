# Liberty Mutual — Playbook

> Updated after each completed claim. Patterns become predictable by claim #5-10.

## Overview
- **Claims processed:** 2
- **Win rate:** Pending (2 active)
- **Average underpayment ratio:** Claim 1 full denial ($0), Claim 2 partial scope (4.1x underpayment)
- **Claims email:** claims@libertymutual.com
- **Typical adjuster response time:** Unknown

## Known Tactics

### Full Denial Strategy (Claim #1)
- Liberty Mutual issued a **complete denial** on the first claim — no scope, no Xactimate, $0 RCV
- Denial letter stated "no insurance coverage is available" without specifying a coverage exclusion or policy provision
- Carrier did not provide an adjuster inspection scope, damage assessment, or line-item breakdown
- Denial contradicted HailTrace-confirmed hail event at the exact property coordinates on the claimed date of loss
- **Key pattern:** Liberty Mutual may prefer blanket denials over underpaid scopes — forces the insured to build the entire case from scratch rather than supplement against a carrier scope

### Partial Scope with Non-Standard Pricing (Claim #2 — NEW PATTERN)
- Liberty Mutual issued a partial scope of $18,472.87 RCV — first time they issued a scope instead of a denial
- **Cotality Data Driven USDC pricing database** — NOT Xactimate NYBI. Unit prices systematically 20-36% below NYBI26 market rates
  - Drip edge: $3.05/LF vs $4.25 NYBI (28% below)
  - Felt/underlayment: $25.23/SQ vs $32.00 NYBI (21% below)
  - Ridge cap: $4.81/LF vs $7.49 NYBI (36% below)
  - House wrap: $0.43/SF vs $0.64 NYBI (33% below)
- **ITEL shingle pricing split**: Supply ($131.60/SQ) + Install ($157.75/SQ) = $289.35 combined vs $337.78 NYBI R&R rate
- **Siding gauge mismatch**: Used 0.019" aluminum at $6.55/SF instead of 0.024" at $12.47/SF — wrong material spec
- **Partial siding scope**: Scoped 727 SF (1 area) on a 2,405 SF property — house wrap corner rule forces all elevations
- **Detached structure spot repair**: Scoped 6 individual shingles ($169.68) on a 4.38 SQ roof — per-EA pricing vs per-SQ
- **EPDM flat roof omitted**: 102 SF flat section with visible punctures completely excluded despite estimator inspecting the property
- **Missing code components**: No ice & water barrier, no step flashing, no counter flashing, no pipe boots, no high roof charges, no window wraps
- **Estimator vs adjuster**: Lisa Magaw (estimator) wrote the scope; Chelsea Weidman is the adjuster. Separate roles.

### Denial Letter Format
- Simple denial letter (not a detailed scope or Xactimate estimate)
- Adjuster name provided: LaQuanta McCann
- No inspector company or third-party inspection company identified in denial
- No test squares, no FieldAssist/Accurence, no third-party engineering report referenced

## Inspector / Third-Party Patterns
- **Claim #1 (213 Wright Rd):** No third-party inspector identified. Unclear if Liberty Mutual conducted an on-site inspection or denied based on desk review / satellite imagery
- **Claim #2 (43 Telegraph St):** In-house estimator Lisa Magaw conducted on-site inspection November 10, 2025. No third-party firm (FieldAssist, Accurence, etc.) identified. Adjuster Chelsea Weidman handled claim separately from estimator.
- **Watch for:** Liberty Mutual may use in-house adjusters, EagleView desk reviews, or third-party inspection firms (Hancock Claims Consultants, Crawford & Company) — document which method on future claims
- If Liberty Mutual denies without an on-site inspection, this is a strong argument: "Carrier denied coverage without conducting a physical inspection of the property"

## Effective Counter-Arguments

### Against Full Denial (Primary Strategy)
1. **HailTrace weather verification** — independent forensic weather data confirming hail at exact property coordinates on date of loss. Carrier cannot dispute meteorological evidence.
2. **Soft metal corroboration** — hail dents on metal components (gutters, vents, metal roofing, HVAC) provide irrefutable physical evidence of hailstone impact. Metal denting cannot be caused by aging, wear, or foot traffic.
3. **Photo volume** — 76 inspection photographs documenting pervasive hail damage across all roof slopes. Omnidirectional distribution pattern eliminates mechanical damage or foot traffic as alternate explanations.
4. **HAAG Engineering forensic standards** — circular indentations with granule displacement and mat fracture constitute functional damage requiring full replacement, not repair.
5. **RCNYS code compliance** — once full replacement is triggered, all code-required components must be included (ice barrier R905.1.2, underlayment R905.1.1, drip edge R905.2.8.5, flashing R903.2/R905.2.8).
6. **Differentiation analysis** — systematic elimination of non-storm causes (foot traffic, aging, manufacturing defect) through forensic comparison of observed damage characteristics vs. expected patterns for each potential cause.

### Insurance Law Citations (NY)
- **11 NYCRR 216.4(b)** — carrier must respond to pertinent communications within 15 business days
- **11 NYCRR 216.6(c)** — after proof of loss, carrier must accept/reject within 15 business days
- **NY Insurance Law § 2601** — unfair claim settlement practices

## Pricing Patterns
- **Claim #1 (213 Wright Rd):** No carrier scope — full denial with $0 RCV
- **Claim #2 (43 Telegraph St):** Uses **Cotality Data Driven USDC** pricing database — NOT Xactimate NYBI
  - Systematically 20-36% below NYBI26 across all line items
  - Splits shingle R&R into separate Supply + Install (ITEL pricing) — combined still below NYBI R&R rate
  - Uses wrong siding gauge (0.019" vs 0.024") at lower price point
  - Per-shingle (per-EA) pricing on detached structure instead of per-SQ
- **Key argument:** Cotality/USDC is not the industry-standard pricing database for insurance claims in NY. Xactimate NYBI is the standard. Non-standard pricing artificially deflates carrier RCV.

## Claim History

### Claim #1: 213 Wright Rd, Vestal, NY 13850 (February 2026)
- **Insured:** Cindy Ligouri (homeowner)
- **Carrier RCV:** $0.00 (full denial)
- **Our RCV:** $18,448.28
- **Variance:** +$18,448.28 (infinite — denial vs. full scope)
- **Trades:** roofing, gutters (2 trades, no O&P)
- **Structures:** 2 (main dwelling 1,387 SF + detached 97 SF = 1,484 SF total, 17.66 SQ with waste)
- **Shingle type:** 3-tab composition (25-year)
- **Storm:** July 3, 2025 — 0.75" hail + March 16, 2025 — 73 mph wind
- **Carrier tactics:** Full denial — "no insurance coverage available." No scope, no inspection report, no Xactimate estimate provided. Adjuster LaQuanta McCann.
- **Our arguments:**
  - HailTrace forensic weather verification (Report wAb8BqvQ) confirming 0.75" hail at property coordinates
  - 76 inspection photos documenting pervasive hail damage across all 10 facets
  - Soft metal corroboration on corrugated metal porch roof and aluminum wind turbine
  - HAAG Engineering mat fracture standard
  - RCNYS code-required components (6 code sections cited)
  - Differentiation analysis eliminating non-storm causes
- **Outcome:** Pending — appeal package submitted
- **Key takeaway:** Liberty Mutual's full denial strategy means we must build the ENTIRE case — weather data, photo documentation, forensic analysis, code citations, and full Xactimate scope — without any carrier baseline to supplement against. The appeal package must be airtight because there is no carrier scope to cross-reference or argue line-by-line.

### Claim #2: 43 Telegraph St, Binghamton, NY 13903 (February 2026)
- **Insured:** Kristine Walter (homeowner)
- **Carrier RCV:** $18,472.87
- **Our RCV:** $94,143.24
- **Variance:** +$75,670.37 (5.1x)
- **Trades:** Laminate comp shingle roofing, aluminum siding & window wraps, gutters & downspouts, EPDM flat roofing, detached garage/shed roofing, detached structure flat roofing (6 trades — O&P applies)
- **Structures:** 2 (main dwelling 1,941 SF roof + detached 438 SF = 2,379 SF total)
- **Shingle type:** Laminated composition (architectural)
- **Storm:** July 3, 2025 — 1.5-1.75" hail confirmed at property coordinates
- **Carrier tactics:**
  - Non-standard Cotality/USDC pricing database (20-36% below NYBI26)
  - Partial siding scope: 727 SF of 2,405 SF total (30%)
  - Detached structure: 6-shingle spot repair ($169.68) on 4.38 SQ roof
  - EPDM flat roof (102 SF) completely omitted despite open punctures
  - Missing ice & water barrier, step/counter flashing, pipe boots, high roof charges
  - Siding gauge mismatch: 0.019" vs 0.024" actual
  - Estimator: Lisa Magaw | Adjuster: Chelsea Weidman
- **Our arguments:**
  - Non-standard Cotality/USDC pricing — 20-36% below NYBI26 market rates
  - HAAG standard — 20+ impacts per test square (2.5x replacement threshold)
  - Soft metal corroboration — satellite dish, cupola cap, exhaust vent, gutters all dented
  - House wrap corner rule (RCNYS R703.1/R703.2) — partial siding forces full perimeter
  - Logical inconsistency — full roof replacement on main but 6-shingle spot repair on detached
  - EPDM flat roof omission — open punctures visible in photos
  - 7 code-required components missing from carrier scope
  - Siding gauge mismatch violates like-kind-and-quality standard
- **Outcome:** Pending — appeal package submitted
- **Key takeaway:** Liberty Mutual's 2nd claim reveals a partial scope strategy (vs full denial on Claim #1). The Cotality/USDC pricing database is a new tactic — systematically deflates all unit prices. Combined with partial siding, spot repair on detached, and omitted flat roof, the carrier's scope captured only 20% of the actual damage. The non-standard pricing database argument is unique to Liberty Mutual so far.

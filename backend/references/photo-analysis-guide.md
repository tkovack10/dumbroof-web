# Photo Analysis Quick-Reference Guide

> Read this when writing photo annotations in claim_config.json during /new-claim Step 7.
> This ensures consistent, forensic-quality annotations across all claims.
> For detailed material-specific information, see the linked reference files.

---

## Annotation Rules

1. **Clinical, professional tone** — write like a forensic engineer, not a salesperson
2. **Be specific** — measurements, counts, compass directions, material types
3. **Name the damage mechanism** — "hail impact," "wind-lift," "granule displacement," not just "damage"
4. **Reference standards** — cite HAAG, ASTM D3462, RCNYS codes where applicable
5. **Separate storm damage from wear** — document both but clearly distinguish them
6. **Include scale reference** — note ruler, coin, or known object size when visible in photo

---

## Step 1: Identify the Product

Before annotating damage, identify what you're looking at.
→ Full guide: `references/products-and-materials.md`

| If You See... | Identify As... | Note... |
|---|---|---|
| Flat, uniform shingles with keyway slots | 3-tab shingle | Manufacturer by tab width/shadow pattern |
| Thick, dimensional shingles with random edge pattern | Laminate/architectural | Manufacturer by profile/color blend |
| Heavy, multi-layer shingle with dramatic shadow | Designer/luxury | Likely CertainTeed Grand Manor or GAF Camelot |
| Flat panels with raised seams | Standing seam metal | Note gauge if identifiable |
| Panels with exposed screws on ribs | Screw-down/exposed fastener metal | Note gauge, rib spacing |
| Gray/black stone tiles | Natural slate | Note if uniform (quarry) or mixed |
| Barrel-shaped or flat clay pieces | Clay tile | Check for Ludowici markings |
| Long horizontal panels with lock edges | Vinyl siding | Note profile/exposure width for matching |
| Horizontal panels, metallic appearance | Aluminum siding | Likely discontinued — flag for matching |
| Measure shingle exposure (butt-to-butt) | Exposure width determines repairability | 5" = pre-metric (unrepairable), 5-5/8" = metric (current), 5-7/8" = IKO Advantage |

**Exposure measurement — do this for EVERY shingle roof:** When you identify any asphalt shingle
(3-tab OR laminate/architectural), measure the visible exposure (butt edge to butt edge of adjacent
courses). A 5" exposure is the strongest unmatchability argument available — it proves the shingles
are pre-metric and dimensionally incompatible with ALL currently manufactured products. No carrier
rebuttal survives a tape measure. → Full protocol: `references/shingle-exposure-repairability.md`

---

## Step 2: Identify Installation Method

How it was installed affects scope and repairability.
→ Full guide: `references/installation-techniques.md`

| If You See... | It Is... | Scope Impact |
|---|---|---|
| Valley with one clean cut line | Closed-cut valley | Underlying side requires removing overlapping shingles |
| Valley with alternating woven shingles | Woven valley | **Cannot spot-repair** — must re-weave section |
| Metal channel visible in valley | Open metal valley (W-style) | Easiest to spot-repair; metal may also need replacement |
| Larger plane running through valley | California cut | Same as closed-cut |
| Metal L-pieces at wall-to-roof junction | Step flashing | If replacing: siding removal/re-install added to scope |
| Metal tucked into mortar joint at chimney | Counter flashing (proper) | Mortar work needed if replacing |
| Metal caulked to chimney face | Counter flashing (improper) | Already failed — include proper replacement in scope |
| No diverter behind chimney | Missing cricket/saddle | Code upgrade if chimney > 30" wide |

---

## Step 3: Annotate Damage — Use These Patterns

→ Full guide: `references/damage-identification.md`

### Hail Damage on Asphalt Shingles
**Annotate with:**
> "Circular granule displacement measuring approximately [X] inches in diameter with underlying
> mat fracture at [location]. Per HAAG Engineering forensic standards, mat fracture constitutes
> functional damage. [Count] impacts identified within this test area."

**Key terms:** granule displacement, mat fracture, bruising, indentation, exposed mat fibers

### Hail Damage on Metal
**Annotate with:**
> "Circular dent measuring approximately [X] inches in diameter on [gauge] [material] panel.
> Paint/coating system [intact / fractured] at impact point. [If fractured:] Compromised coating
> exposes substrate to corrosion — this is functional damage."

### Hail Damage on Vinyl Siding
**Annotate with:**
> "Impact fracture/crack on vinyl siding panel at [location], [elevation] elevation.
> [If cold weather:] Storm occurred at approximately [X]°F — vinyl becomes brittle below 40°F,
> resulting in shattering rather than denting from hail impact."

### Hail Damage on Aluminum (Siding, Gutters, Window Wraps, Fascia)
**Annotate with:**
> "Multiple permanent dents measuring approximately [X] inches observed on [component],
> [elevation/location]. [Count] dents per [linear foot / panel / section]. Dent pattern and
> directional concentration corroborate hail event reported on [date]."

### Wind Damage
**Annotate with:**
> "Shingle exhibits [lifted tab / sharp crease at nail line / missing tab / broken seal strip]
> consistent with wind-lift damage at [location]. The compromised seal strip renders this shingle
> non-functional regardless of current position."

### Pre-Existing Wear (Document Separately)
**Annotate with:**
> "Pre-existing [granule erosion / UV degradation / curling / moss growth / seal strip failure]
> consistent with normal aging on a [X]-year-old [material] system. Note: this pre-existing
> condition does not negate covered storm damage also present on this roof."

### Code Violations Found
**Annotate with:**
> "[Component] does not meet current RCNYS [code section] requirements. [Describe deficiency.]
> This constitutes a code upgrade that must be addressed during any re-roofing per RCNYS."

---

## Hail Damage Decision Tree

Use this decision tree when evaluating any suspected hail damage in photos.

```
Is the mark a DEPRESSION (concave) or PROTRUSION (convex)?
│
├─ PROTRUSION (raised, convex) ──→ Likely BLISTER
│   └─ Confirm: crusty edges? exposed fibers from below? no soft metal dents?
│       ├─ YES to all ──→ BLISTER (not storm damage)
│       └─ Mixed indicators ──→ Needs microscope/field verification
│
├─ DEPRESSION (concave, pushed in) ──→ Possible HAIL or MECHANICAL
│   │
│   ├─ Is it CIRCULAR or OVAL?
│   │   ├─ YES ──→ Strong hail indicator
│   │   │   │
│   │   │   ├─ Mat fractured beneath? (soft spot test)
│   │   │   │   ├─ YES ──→ FUNCTIONAL HAIL DAMAGE (HAAG standard)
│   │   │   │   └─ NO ──→ Cosmetic hail impact (still covered under most policies)
│   │   │   │
│   │   │   ├─ Soft metals also dented?
│   │   │   │   ├─ YES ──→ CONFIRMED hail event
│   │   │   │   └─ NO ──→ Check other collateral evidence
│   │   │   │
│   │   │   ├─ Directional pattern? (windward > leeward)
│   │   │   │   ├─ YES ──→ CONFIRMED storm pattern
│   │   │   │   └─ NO / uniform ──→ May be mechanical or multi-directional storm
│   │   │   │
│   │   │   └─ Oxidation state of exposed asphalt?
│   │   │       ├─ FRESH (dark, sharp) ──→ Recent damage (< 6 months)
│   │   │       ├─ GRAYING ──→ 6-18 months old
│   │   │       └─ WEATHERED ──→ 2+ years old — check storm history
│   │   │
│   │   └─ NO (irregular shape) ──→ Possible MECHANICAL damage
│   │       └─ Confirm: near access path? tool-shaped? granules powdered?
│   │           ├─ YES to any ──→ Likely MECHANICAL
│   │           └─ NO ──→ Needs field verification
│   │
│   └─ Distribution pattern?
│       ├─ Random within directional pattern ──→ HAIL
│       ├─ Concentrated near edges/HVAC/paths ──→ MECHANICAL
│       └─ Concentrated on south/west exposures ──→ BLISTERING or heat damage
```

---

## CRITICAL: Chalk Test Language Rules

**Chalk test = SOFT METALS ONLY.** Never describe shingle damage as a "chalk test."

| Surface Type | Correct Term | WRONG Term |
|---|---|---|
| Metal gutters, downspouts, window wraps, fascia | "Chalk test revealing hail dents" | — |
| Asphalt shingles with chalk circles | "Impact location identified" or "Circled for reference" | ~~"Chalk test"~~ |
| Asphalt shingles with chalk marks | "Marked for documentation purposes" | ~~"Chalk test result"~~ |

**Why:** Chalk test is a specific forensic technique where chalk is drawn across a metal surface to reveal dents (chalk skips over depressions). Chalk circles drawn around shingle impacts are visual markers, not a "chalk test." Using the wrong term undermines credibility.

---

## Shingle Annotation Language Standards

When describing hail damage on shingles, focus on these forensic indicators:
- **Impact marks** — circular depressions, indentations
- **Granule displacement/crushing** — granules pushed outward from impact center
- **Mat bruising/fracture** — soft spot beneath impact, exposed fiberglass mat
- **Loss of water shedding capability** — functional damage per HAAG standards
- **Loss of functional service life** — accelerated deterioration from exposed mat

**Wind damage indicators:**
- Creased shingles — sharp fold line at or near nail line
- Missing shingles + un-rusted nail heads = **recent** damage indicator (rust develops within months)
- Lifted tabs with broken seal strips

**Hail splatter on surfaces** = proof of recent hail event within the last year (splatter patterns weather away relatively quickly)

**Close-up shingle photos are NOT duplicates** — each one documents:
1. Impact location on the specific shingle
2. Granule loss pattern (radial displacement vs. uniform erosion)
3. Mat condition (fractured vs. intact vs. bruised)
4. Differentiation from blistering (blisters = smooth rounded surfaces with no granule displacement pattern; hail = sharp-edged crater with displaced granules pushed outward)

---

## Chalk Protocol — Mandatory for All Soft Metals

**Every hail claim inspection MUST include the chalk protocol on ALL soft metal surfaces.**

### Technique
1. Use standard carpenter's chalk (red, blue, or yellow — any color that contrasts with the metal)
2. Lay chalk **sideways** against the metal surface
3. Draw across with light, even pressure in ONE direction
4. Chalk skips over dents — dents appear as unmarked circles against the chalked background
5. Photograph immediately

### Complete Surface Checklist
Every surface below MUST be chalked and photographed:

| Surface | Location | Priority |
|---|---|---|
| Gutters — front face | All elevations | **Critical** |
| Gutters — top lip | All elevations | **Critical** |
| Gutters — inside trough | All elevations (from ladder) | High |
| Downspouts — windward face | Storm-facing side | **Critical** |
| Window wraps — sills | All elevations | **Critical** (commonly missed) |
| Window wraps — jambs | All elevations | High |
| Fascia metal | All elevations | High |
| Chimney flashing | Step, counter, cap | High |
| Valley metal | If open metal valley | Medium |
| Attic fan covers | Top surface | Medium |
| Pipe boot collars | Metal ring/base | Medium |
| Drip edge | Exposed face at eave | Medium |
| Exhaust vent caps | Top and windward face | Medium |
| Aluminum siding | If present, windward elevation | High |

### Photo Documentation Requirements
For EACH chalked surface:
1. **Close-up shot** — shows individual dent detail, chalk contrast, size reference (ruler or coin)
2. **Wide shot** — shows the surface in context (which elevation, which component)
3. **Before/after** (optional but powerful) — same surface, first unchalked (dents invisible), then chalked (dents obvious)

### AI Flag: Incomplete Documentation
If soft metal surfaces appear in inspection photos WITHOUT chalk applied, the hail detection AI will flag this as:
> **INCOMPLETE DOCUMENTATION** — Soft metal surface [component] visible in photo but no chalk applied. Dents may be present but are not visually enhanced for documentation purposes. Re-inspect with chalk protocol.

---

## Step 4: Check Corroborating Evidence

For EVERY hail claim, document the 12-point soft metals checklist.
→ Full checklist: `references/damage-identification.md` → Collateral & Soft Metals Test Points

**Minimum corroboration to document:**
- [ ] Gutters — dents on front face, top edge
- [ ] Downspouts — windward face dents
- [ ] Window wraps — sill dents (most exposed)
- [ ] HVAC condenser — top surface dents
- [ ] Directional pattern — windward vs. leeward comparison

---

## Step 5: Flag Scope Expansion Triggers

→ Full table: `references/installation-techniques.md` → Scope Expansion Triggers

When you identify any of these, note them in the forensic findings:
- Woven valley (cannot spot-repair)
- Discontinued product (cannot match — forces full replacement)
- Step flashing behind siding (siding removal added to scope)
- No drip edge on existing roof (RCNYS R905.2.8.5 code upgrade)
- No ice & water shield (RCNYS R905.1.2 code upgrade)
- Two or more existing roof layers (RCNYS R908.3.1.1(3) — full tear-off required)
- Deteriorated decking found (RCNYS R908.2 — replace regardless of cause)
- House wrap must wrap corners (RCNYS R703.1/R703.2 — forces full elevation siding)

---

## Photo Ordering Strategy

Organize photos in the forensic report in this order for maximum persuasive impact:

1. **Primary Damage Observations (trophy_photos)** — Best 2-3 damage shots that immediately establish severity. These appear BEFORE threshold analysis.
2. **Collateral/Soft Metal Evidence** — Mailbox dents, hail splatter on downspouts, gutter dents, window screen holes, siding fractures. Establishes storm event BEFORE showing roof.
3. **Roof Documentation (slope-by-slope)** — Systematic shingle documentation organized by slope/elevation. Each test square and close-up tells a story.
4. **Code Violations** — Missing components documented with code references.
5. **Interior Damage** (if applicable) — Water intrusion evidence.

**Key principle:** The adjuster should be convinced of the storm event's severity BEFORE they see a single roofing photo. Collateral evidence is irrefutable — mailbox dents don't lie.

---

## Executive Summary Writing Style

The executive summary is the first narrative section the adjuster reads. Write it like a world-class forensic engineering firm:

- **Flowing, clear, persuasive** — not bullet points, not clinical lists
- **Make complex technical findings accessible** — an adjuster with no engineering background should understand the severity
- **Lead with the strongest finding** — don't bury the lead
- **Reference specific evidence** — "14 confirmed mat fractures across 4 slopes" not "multiple impacts found"
- **Professional confidence** — state findings as facts supported by evidence, not opinions
- **Bridge to the conclusion** — the executive summary should make the conclusion feel inevitable

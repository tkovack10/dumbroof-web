# Wind Damage Identification Guide

> Comprehensive reference for identifying, grading, and documenting wind damage in storm damage insurance claims.
> Companion to `damage-identification.md` (which covers hail). Load this when processing wind-primary or combined claims.

---

## Forensic Standards for Wind Damage

### Industry Standards
- **HAAG Engineering — Wind Damage to Asphalt Shingles**: Defines functional wind damage as any condition that impairs the shingle's ability to shed water or resist future wind events. A creased shingle with broken seal strip = functional damage requiring replacement, regardless of whether the tab is currently lying flat.
- **ASTM D3161**: Standard test method for wind-resistance of steep slope roofing products (Fan-Induced Method). Tests at 60 mph and 110 mph.
- **ASTM D7158**: Standard test method for wind resistance using the uplift force/uplift resistance method. Class D = 90 mph, Class G = 120 mph, Class H = 150 mph.
- **UL 2390**: Tests wind resistance at 110 mph for standard products.
- **FM Global 4470/4474**: Factory Mutual testing for commercial/low-slope applications.

### Key Legal/Insurance Principles
- A shingle that has been wind-creased is **permanently damaged** even if it returns to a flat position. The crease has fractured the mat fibers and broken the seal strip bond. It will lift again in the next wind event at a lower threshold speed.
- Wind damage is **directional** — damage concentrated on windward faces with reduced damage on leeward faces is the forensic signature of a wind event. Uniform damage across all faces suggests aging, not wind.
- **Seal strip failure from wind** is distinct from **seal strip failure from aging**. Wind breaks the bond mechanically (sudden force); aging degrades the adhesive chemically (gradual UV/heat cycling).

---

## Asphalt Shingle Wind Damage Patterns

### 1. Creased Tabs (The #1 Wind Indicator)
The single most important wind damage pattern. Wind catches the leading (exposed) edge of a shingle tab and lifts it upward. The tab pivots at or near the nail line (1-2 inches above the self-seal strip), creating a horizontal crease/fold line.

**What to look for in photos:**
- **Sharp horizontal crease line** running across the full width of the tab, located 1-2 inches above the bottom of the overlying shingle course (near the nail line)
- **Visible granule disruption** along the crease line — granules are crushed or displaced at the fold
- **Broken seal strip** below the crease — the adhesive bond between the lifted tab and the course below is broken. Even if the tab has settled back flat, the seal is permanently broken
- **Lighter-colored line** where the crease has exposed fresh asphalt mat at the fold
- **Shadow line** visible when the tab is slightly raised from the crease

**Crease vs. Curl distinction (CRITICAL):**

| Feature | Wind Crease | Age Curl |
|---|---|---|
| Line shape | Sharp, angular fold at a specific point | Gradual, rounded upturn starting from edges |
| Location | At nail line (1-2" from bond) | Starts at exposed edges, progresses inward |
| Crease line | Distinct, you can see the exact fold | No distinct line — smooth curve |
| Granule condition | Disrupted/crushed AT the crease line | Gradual weathering, no concentrated line |
| Seal strip | Mechanically broken (clean separation) | Chemically degraded (dry, crumbling) |
| Distribution | Random on windward faces | Uniform across ALL faces |
| Surrounding shingles | Mix of creased and intact | All show similar curling |

### 2. Missing Shingles / Complete Tab Blow-Off
Wind tears the entire tab or full shingle away from the roof surface.

**What to look for in photos:**
- **Exposed nail heads** — check for rust: **No rust / bright nails = RECENT** blow-off; **Rusted nail heads = OLDER** blow-off
- **Torn mat fibers** at the nail holes — indicates forcible removal by wind
- **Exposed underlayment or deck** — the condition of what is beneath tells the story

### 3. Lifted Seal Strips / Adhesive Failure from Wind Uplift
Wind lifts the tab enough to break the factory-applied self-seal adhesive strip, but does not fully remove or crease the tab.

**What to look for:**
- **Tab lifts freely** when inspector touches the leading edge
- **Clean adhesive separation** — the seal strip surface shows a clean break, not crumbling/powdering of age-degraded adhesive
- **Selective pattern** — some tabs lift, others do not. If ALL tabs lift across ALL slopes, likely age-related

### 4. Turned-Back Leading Edges
Wind catches the bottom exposed edge and curls it backward (upward and over toward the ridge). The tab folds back on itself at or near the nail line.

### 5. Ridge Cap Blow-Off
Ridge caps sit at the highest point of the roof with maximum wind exposure on both sides. They are the most wind-vulnerable component on any shingle roof.

**What to look for:**
- **Missing ridge cap pieces** — complete blow-off, exposed nail heads at the ridge board
- **Scalloped lifting pattern** — multiple pieces lift at alternating points along the ridge

**Forensic significance:** If ridge caps are damaged, field shingles on windward faces should be inspected for creasing and seal strip failure — the same wind that hit the ridge hit the field.

### 6. Debris Impact Marks
Wind-driven debris (tree limbs, foreign objects) strikes the roof surface.

**What to look for:**
- **Linear or irregular marks/gouges** — unlike the circular pattern of hail
- **Granule displacement** following the path of the debris impact
- **Punctures** through the shingle into the underlayment or deck

---

## Metal Roofing Wind Damage

### Standing Seam Metal
- **Panel uplift**: Wind gets under a panel edge and lifts/peels it from the deck
- **Seam separation**: Snap-lock or mechanical seam connections fail under wind uplift
- **Ridge cap displacement**: Metal ridge caps blown off, shifted, or bent

### Exposed Fastener Metal (R-Panel, Corrugated, 5V-Crimp)
- **Fastener pullout**: Wind uplift pulls screws through the panel — elongated holes
- **Panel displacement**: Panels shift from original position, exposing laps

### CRITICAL: Wind vs. Hail on Metal Roofs (#1 Correction Pattern)

| Feature | Wind Damage on Metal | Hail Damage on Metal |
|---|---|---|
| Shape of mark | Linear, along seams/edges | Circular dent/depression |
| Location | Seams, edges, ridge, eave (wind-catch points) | Random across panel face |
| Coating loss | Along seam lines from panel movement | At circular dent impact points |
| Panel displacement | Yes — shifted, lifted, peeled | No — panel stays in position |

**When you see coating stripped at rib seams on metal panels, check whether the damage is at the HIGH POINTS of ribs (= likely hail impact) or at SEAM JOINTS between panels (= possibly wind displacement). Users have consistently corrected `wind_crease` tags on metal to `hail` when the damage was circular indentation pattern at rib crests.**

---

## Siding Wind Damage

### Vinyl Siding
- **Panel blow-off**: Complete panel detachment — exposed house wrap, empty J-channel
- **Panel separation at lock joint**: Wind disengages the bottom lock from the course below
- **Buckled/bowed panels**: Wind pressure deforms the panel face
- **Cracked panels**: Wind-driven debris or extreme flexing. Cold-weather storms are worse (vinyl brittle below 40F)

### Aluminum Siding
- **Bent/creased panels**: Aluminum deforms permanently — wind bending is not circular like hail dents
- **Panel displacement**: Shifted from interlocking position

### Directional Pattern on Siding
Same as roofing — windward elevations show the most damage, leeward show minimal. Compare all 4 elevations.

---

## Soffit, Fascia, and Trim Wind Damage

### Soffit
- **Panel displacement from J-channel**: Wind pushes up under the overhang
- **Soffit damage is almost always wind, not hail** — hail cannot reach the underside of the overhang

### Fascia
- **Peeled/pulled away**: Wind catches the fascia board or wrap and pulls it from rafter tails

---

## Flat Roofing Wind Damage (EPDM/TPO/PVC)

- **Edge uplift / peeling**: Wind enters at the roof edge and peels the membrane from the substrate. Perimeter is always most vulnerable
- **Seam separation**: Wind stress opens field or perimeter seams
- **Membrane billowing**: Wind gets under the membrane — even if it settles back, adhesive bond may be permanently broken
- **Ballast displacement**: On ballast-over-membrane systems, wind scours gravel or pavers from the surface

---

## Directional Pattern Analysis

Wind damage follows the storm's wind direction. This is the forensic signature.

### Wind Damage Distribution Model
```
                    WIND DIRECTION -->
                    
          [LEEWARD: Minimal damage]
                    |
     [LEFT SIDE:   |   [RIGHT SIDE:
      Moderate     |    Moderate
      damage at    |    damage at
      corners]     |    corners]
                    |
          [WINDWARD: Maximum damage]
```

Corner/Edge amplification zones:
- Eave corners: 1.5x wind speed multiplier
- Ridge ends: 1.3x multiplier
- Rake edges: 1.2x multiplier
- Field center: 1.0x (base wind speed)

---

## Wind Speed Correlation

### Asphalt Shingles
| Observed Damage | Estimated Minimum Wind Speed | Notes |
|---|---|---|
| Seal strip failure on aged shingles (10+ years) | 45-57 mph | Old adhesive fails first |
| Seal strip failure on newer shingles (< 5 years) | 58-74 mph | Stronger adhesive |
| Tab creasing (field shingles) | 58-74 mph | Depends on age and quality |
| Limited missing shingles (1-3 per slope) | 58-74 mph | Weakest shingles blow off first |
| Ridge cap blow-off | 55-70 mph | Highest exposure point |
| Significant missing shingles (4+ per slope) | 75-95 mph | Broad-field wind damage |
| Large section blow-off (multiple courses) | 90-110 mph | Near-total system failure |
| Deck exposure over large areas | 95+ mph | Catastrophic wind event |

### Metal Roofing
| Observed Damage | Estimated Minimum Wind Speed |
|---|---|
| Fastener pullout (exposed fastener panels) | 70-85 mph |
| Seam separation (standing seam) | 80-100 mph |
| Ridge cap displacement | 65-80 mph |

### Siding
| Observed Damage | Estimated Minimum Wind Speed |
|---|---|
| Vinyl panel unlocking at joints | 60-75 mph |
| Complete panel blow-off | 75-90 mph |
| Aluminum panel deformation | 70-85 mph |

---

## Severity Grading System

| Grade | Description | Typical Damage |
|---|---|---|
| **Level 1** (Cosmetic) | Minor, may not trigger coverage | Creased tabs still sealing, minor debris marks |
| **Level 2** (Functional) | Triggers coverage — replacement required | Broken seals, creased tabs, 1-3 missing shingles |
| **Level 3** (Severe) | Full slope/system replacement | 4+ missing shingles, ridge blow-off, exposed deck |
| **Level 4** (Catastrophic) | Emergency repair needed | Large sections missing, structural damage, water intrusion |

---

## Wind Damage vs. NOT Wind Damage

### Normal Aging / Curling — NOT Wind
- Gradual, uniform upturn of shingle edges across ALL roof faces
- No sharp crease line. Edges curl smoothly. ALL faces affected equally

### Thermal Splitting / Cracking — NOT Wind
- Straight, clean crack lines running vertically through shingle tabs
- Wind tears are IRREGULAR with ragged edges

### Foot Traffic Scuffs — NOT Wind
- Linear scuff marks following logical walking paths (valleys, near HVAC)
- Wind damage is random or directional with wind

### Manufacturer Defect (Adhesive Failure) — NOT Wind
- Tabs lift freely across the ENTIRE roof, regardless of face or exposure
- Uniform across ALL faces, no directional pattern

### Paint Failure on Metal or Trim — NOT Wind
- Paint peeling/discoloration is UV/moisture cycling, not mechanical force

### Coating Loss on Metal at Rib Crests from Hail — NOT Wind
- Coating stripped at the HIGH POINTS of metal ribs in circular patterns = HAIL
- Wind abrasion would affect seam joints and edges, not rib crests randomly

---

## Wind Damage Decision Tree

```
Is the shingle MISSING or still in place?
|
+-- MISSING (complete blow-off)
|   |
|   +-- Are exposed nail heads RUSTY?
|   |   +-- YES --> OLD blow-off (pre-dates recent storm)
|   |   +-- NO (bright/clean nails) --> RECENT blow-off
|   |       +-- Torn mat at nail holes?
|   |           +-- YES --> WIND tear (forcible removal)
|   |           +-- NO --> Adhesive failure (check directional pattern)
|
+-- STILL IN PLACE but shows damage
    |
    +-- Is there a SHARP CREASE LINE?
    |   +-- YES --> WHERE is the crease?
    |       +-- 1-2" above bond (near nail line) --> WIND CREASE (functional damage)
    |       +-- At exposed tab edge --> MECHANICAL or debris impact
    |       +-- Multiple parallel lines --> THERMAL cracking
    |
    +-- NO crease -- is the tab CURLED?
    |   +-- Gradual curl, all faces uniformly --> AGING (not wind)
    |   +-- Curl on windward face only --> Possible WIND uplift
    |
    +-- Is the SEAL STRIP broken?
        +-- Clean mechanical separation --> WIND broke the seal
        +-- Dry, powdery, crumbling --> AGE degradation
```

---

## Carrier Denial Tactics and Rebuttals

### "That's normal wear, not wind damage"
**Rebuttal**: Normal wear produces UNIFORM degradation across ALL roof faces. This property shows [X] damaged shingles on the [windward] slope and [Y] on the [leeward] slope — a directional differential that is the forensic signature of a wind event.

### "The shingles were already old and prone to lifting"
**Rebuttal**: A shingle's age does not disqualify it from covered wind damage. The PROXIMATE CAUSE was the [date] wind event with [speed] mph winds documented by NOAA. The carrier cannot deny coverage because the insured material was old — the policy covers the property AS-IS.

### "We only see a few missing shingles, not enough for full replacement"
**Rebuttal**: Additionally, [count] shingles on the [slope] face show creased tabs with broken seal strips — per HAAG Engineering standards, these are FUNCTIONALLY DAMAGED and will fail in the next wind event.

### "The seal strips failed from age, not wind"
**Rebuttal**: Wind-broken seal strips show CLEAN mechanical separation. Age-failed seals show dry, powdery, crumbling adhesive. Furthermore, the seal failures concentrate on the [windward] face — if aging caused them, they would be uniform across all faces.

---

## Few-Shot Annotation Examples

### Example 1: Creased Tab
**CORRECT**: "Laminate shingle: Wind-creased tab with visible fold line at bond strip. Seal adhesion permanently broken — functional damage per HAAG."

### Example 2: Missing Shingle
**CORRECT**: "3-tab shingle: Complete tab blow-off exposes rust-free nail heads and intact underlayment. Recent storm event confirmed."

### Example 3: Directional Pattern Overview
**CORRECT**: "South slope: 8+ wind-creased shingles on windward face vs 1 on leeward north. Directional pattern confirms wind event."

### Example 4: Ridge Cap Blow-Off
**CORRECT**: "Ridge cap: 3 consecutive pieces missing with exposed ridge board. Remaining caps show lifted edges — full ridge replacement required."

### Example 5: Seal Strip Failure
**CORRECT**: "Architectural shingle: Seal strip cleanly broken from wind uplift — tab lifts freely. Age-related failure shows crumbling, not clean break."

### Example 6: Siding Wind Damage
**CORRECT**: "Vinyl siding: Panel blown off at windward elevation exposes house wrap. Adjacent panels unlocked at joints from wind pressure."

### Example 7: Debris Impact
**CORRECT**: "Laminate shingle: Linear gouge from wind-driven tree limb. Granule displacement follows debris path — distinct from circular hail pattern."

### Example 8: Metal Roof Wind vs. Hail (Correction Pattern)
**CORRECT**: "Standing seam metal: Chalk test reveals circular dent pattern across rib crests. Hail impacts — not wind abrasion."

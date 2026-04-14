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

## Wind Speed Amplification at the Roof Surface (CRITICAL Forensic Argument)

> **"My shingles are rated to 110 mph. The storm was only 65 mph. Why did they fail?"**
>
> Because the 65 mph was measured at GROUND LEVEL. The actual wind velocity at the roof surface is significantly higher.

### The Bernoulli Effect on Buildings

When ground-level wind encounters a building, it is forced to accelerate up and over the structure. Per Bernoulli's principle, as the wind velocity increases over the roof surface, the air pressure drops — creating **negative pressure (suction)** that lifts shingles from underneath.

The wind does NOT simply blow across the roof at the same speed it was traveling at ground level. The building's geometry forces the airflow to compress and accelerate, particularly at:
- **Eaves and rake edges** — wind is forced to change direction sharply
- **Ridge lines** — wind accelerates over the peak
- **Building corners** — wind wraps around and creates vortices with dramatically amplified velocities
- **Roof penetrations** — chimneys, vents, and skylights create localized turbulence

### ASCE 7 Roof Zone Velocity Multipliers

ASCE 7 (Minimum Design Loads and Associated Criteria for Buildings and Other Structures) — the governing standard for structural wind design in the US — defines three roof zones with increasing wind pressure coefficients (GCp values):

| Roof Zone | Location | Velocity Pressure Coefficient | Effective Multiplier vs Ground | Example: 65 mph Ground Wind |
|---|---|---|---|---|
| **Zone 1** (Field) | Center of roof, away from edges | GCp ≈ -0.9 to -1.0 | ~1.3-1.4x | **~85-90 mph** |
| **Zone 2** (Perimeter) | Within 4-10 ft of eaves, rakes, ridges | GCp ≈ -1.8 to -2.0 | ~1.5-1.7x | **~98-110 mph** |
| **Zone 3** (Corner) | Within 4-10 ft of roof corners | GCp ≈ -2.8 to -3.0 | ~1.8-2.2x | **~117-143 mph** |

**This means a 65 mph ground wind can generate 117-143 mph effective wind force at roof corners** — well above any shingle's 110 mph or 130 mph wind rating.

### Why This Matters for Claims

Carriers routinely deny wind damage claims using this logic:
> "NOAA records show the storm produced 65 mph winds. Your shingles are rated to 110 mph per ASTM D7158 Class G. Therefore the wind could not have caused the damage."

This argument is **engineering malpractice**. The 65 mph figure is:
1. Measured at ground level (typically 10 meters / 33 feet above ground per NOAA standard)
2. Measured at a weather station that may be miles from the property
3. An AVERAGE sustained speed — gusts can be 30-50% higher
4. NOT the velocity at the roof surface, which is amplified by building geometry

The correct engineering analysis:
- **Ground gust speed**: 65 mph sustained × 1.3 gust factor = **~85 mph gust**
- **Roof edge velocity**: 85 mph × 1.5-1.7x edge amplification = **~128-145 mph at the roof edge**
- **Corner velocity**: 85 mph × 1.8-2.2x corner amplification = **~153-187 mph at corners**

A 110 mph-rated shingle was NEVER designed to withstand 153 mph uplift at the corner. The engineering proves the wind event was sufficient to cause the observed damage.

### How to Use This in a Supplement

When the carrier argues "wind wasn't strong enough":

1. **Cite NOAA storm data** for the ground-level wind speed and gust speed
2. **Apply the ASCE 7 zone multipliers** to calculate roof-level velocities
3. **Map the observed damage to the zones** — damage at eaves/rakes/corners (Zone 2-3) at lower ground speeds is EXPECTED per engineering standards
4. **Note the directional pattern** — damage concentrated on windward faces at Zone 2-3 locations is the textbook signature of wind amplification
5. **Reference the shingle's ASTM test methodology** — ASTM D7158 tests wind resistance on a FLAT test deck, not on a building with Zone 2-3 amplification. The rated speed is a laboratory value, not a real-world performance guarantee.

### Example Calculation for a Real Claim

**Scenario:** NOAA reports 58 mph sustained winds with 78 mph gusts for the date of loss. Carrier scoped shingles are rated ASTM D7158 Class G (120 mph). Carrier denies claim.

| Parameter | Value |
|---|---|
| NOAA sustained | 58 mph |
| NOAA gust | 78 mph |
| Shingle rating | 120 mph (ASTM D7158 Class G) |
| Zone 1 (field) | 78 × 1.35 = **105 mph** — below rating |
| Zone 2 (edge) | 78 × 1.6 = **125 mph** — EXCEEDS 120 mph rating |
| Zone 3 (corner) | 78 × 2.0 = **156 mph** — far exceeds rating |

**Result:** The claim is valid. Damage at edges and corners is engineering-consistent with the storm event. The carrier's denial based on ground-level wind speed ignores the fundamental physics of wind loading on buildings.

### Engineering Studies Supporting This

- **ASCE 7-22, Chapter 26-30** — defines the velocity pressure exposure coefficients and internal/external pressure coefficients for buildings of all categories
- **HAAG Engineering Research and Education Foundation** — multiple studies documenting roof-level wind amplification on residential structures
- **Institute for Business & Home Safety (IBHS)** — full-scale wind testing at their research center demonstrates shingle failure at ground wind speeds well below the rated capacity due to roof geometry amplification
- **FM Global Research Campus** — wind tunnel testing showing 1.5-2.5x velocity amplification at roof edges and corners for typical residential geometries

---

## Wind Speed Correlation

> **Important:** The wind speeds in the tables below are GROUND-LEVEL measurements (NOAA standard).
> Actual roof-surface velocities are higher per the amplification factors above.

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

### "The wind wasn't strong enough — your shingles are rated to 110/120/130 mph"
**Rebuttal**: The carrier is comparing ground-level wind speed (NOAA measurement at 10m/33ft above ground) to the shingle's ASTM laboratory test rating. Per ASCE 7, the actual wind velocity at the roof surface is 1.3-2.2x higher than ground level due to building geometry amplification (Bernoulli effect). Specifically:
- Zone 1 (field): ~1.35x ground speed
- Zone 2 (edges/eaves/rakes): ~1.6x ground speed
- Zone 3 (corners): ~2.0x ground speed

The NOAA-reported [speed] mph sustained / [gust] mph gust translates to [gust × 1.6] = [value] mph at the roof edge and [gust × 2.0] = [value] mph at corners — which EXCEEDS the shingle's [rating] mph ASTM rating. The observed damage pattern (concentrated at eaves, rakes, and corners = Zone 2-3) is engineering-consistent with this amplified velocity. Furthermore, the ASTM test methodology (D3161 / D7158) evaluates shingle performance on a FLAT test deck in controlled laboratory conditions — not on a real building where geometry, age, fastener condition, and thermal cycling degrade the installed performance below the rated value.

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

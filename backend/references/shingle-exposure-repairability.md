# Shingle Exposure & Repairability — Deep Technical Reference

> Load on-demand when building forensic reports, evaluating repairability, or responding to carrier "just repair it" arguments.

---

## The Imperial-to-Metric Transition

The entire asphalt shingle industry transitioned from imperial ("standard" / "English") to metric sizing. This affects **both 3-tab AND laminate/architectural shingles**, making any pre-transition roof product physically unrepairable with current materials.

### Three-Tab Shingles

| Era | Dimensions | Exposure | Status |
|-----|-----------|----------|--------|
| Pre-2000 standard | 36" × 12" | **5"** | Discontinued by all manufacturers |
| Metric (current) | 39-3/8" × 13-1/4" | **5-5/8"** | Industry standard |
| Transitional metric | ~36" × 12" | **5-1/8"** | Brief 1980s-1990s variant, discontinued |

**Timeline:** Most manufacturers transitioned 3-tabs by 2000-2010. GAF discontinued ALL 3-tab products (Royal Sovereign) in 2023. CertainTeed XT25/XT30 discontinued 2019. TAMKO and IKO were among the last holdouts.

### Laminate/Architectural Shingles

| Era | Dimensions | Exposure | Shingles/SQ | Status |
|-----|-----------|----------|-------------|--------|
| Old standard | 36" × 12" | **5"** | 80 | **Discontinued by ALL manufacturers** |
| Metric (current) | 39-3/8" × 13-1/4" | **5-5/8"** | ~64-66 | Industry standard |
| IKO "Advantage" | 40-7/8" × 13-3/4" | **5-7/8"** | ~60 | IKO proprietary (Cambridge, Nordic, Dynasty) |

**Timeline:** Transition more gradual than 3-tabs. GAF Timberline 30 (English size: 12" × 36-15/16") discontinued ~2007-2008 during GAF-Elk merger. TAMKO was the last manufacturer making 5" exposure laminates, stopped ~2010-2012. **No manufacturer currently produces a 5" exposure laminate shingle.**

### Current Manufacturer Dimensions (Confirmed via Technical Data Sheets)

| Manufacturer | Product | Dimensions (L × W) | Exposure | Size Class |
|---|---|---|---|---|
| GAF | Timberline HDZ | 39-3/8" × 13-1/4" | 5-5/8" | Metric |
| GAF | Timberline HD (disc.) | 39-3/8" × 13-1/4" | 5-5/8" | Metric |
| Owens Corning | TruDefinition Duration | 39-3/8" × 13-1/4" | 5-5/8" | Metric |
| Owens Corning | Oakridge | 39-3/8" × 13-1/4" | 5-5/8" | Metric |
| CertainTeed | Landmark | 38-3/4" × 13-1/4" | 5-5/8" | Metric |
| CertainTeed | Landmark PRO | 38-3/4" × 13-1/4" | 5-5/8" | Metric |
| TAMKO | Heritage | 39-3/8" × 13-1/4" | 5-5/8" | Metric |
| TAMKO | Heritage Vintage | Standard size | 5-1/8" | Standard variant (rare exception) |
| IKO | Cambridge / Nordic / Dynasty | 40-7/8" × 13-3/4" | 5-7/8" | Advantage (LARGER than metric) |
| IKO | Royal Estate | 40" × 13-1/4" | 5-5/8" | Metric |
| Malarkey | Vista / Legacy | 40" × 13-1/4" | 5-5/8" | Metric |
| Atlas | Pinnacle Pristine | ~38-13/16" × 13-1/8" | 6" | Metric variant |

**Key observation:** Even within metric sizing, there are dimensional differences between manufacturers. A CertainTeed Landmark (38-3/4" long) is a different length than a GAF Timberline HDZ (39-3/8"), which is different from an IKO Cambridge (40-7/8"). Cross-manufacturer spot repair is physically problematic even within "metric" sizing.

---

## Why Exposure Mismatch Makes Repair Impossible

### 1. Nailing Zone Misalignment

The "common bond" area — the overlapping double-layer portion where nails must be placed — is positioned differently on standard (5") vs metric (5-5/8") shingles. When a metric replacement shingle is installed on a standard-exposure roof:

- The nailing zone of the replacement shingle does not align with the nailing zone of adjacent existing shingles
- Nails placed correctly for the new shingle may penetrate the wrong zone of the underlying shingle
- **GAF publishes separate nail placement documents: SS-TS-03 (English size) vs SS-TS-03a (Metric size)** — the existence of two separate documents proves the nailing patterns are dimensionally incompatible

### 2. Sealant Line Displacement

Self-sealing adhesive strips are positioned relative to the shingle's exposure. When exposures don't match:
- The sealant line of the overlapping shingle won't contact the sealant strip of the shingle below
- This compromises wind resistance — the shingle may lift in wind events
- IKO notes self-sealing tabs begin at approximately 6-1/8" from the lower edge; exposure variations directly affect seal engagement

### 3. Compounding Course Line Error

A 5/8" difference per course accumulates across the roof slope:

| Courses | Cumulative Offset |
|---------|------------------|
| 5 | 3-1/8" |
| 10 | 6-1/4" |
| 15 | 9-3/8" |
| 20 | **12-1/2"** |
| 25 | 15-5/8" |

After just 10 courses, the replacement shingles are over 6" out of alignment with the existing roof — **more than an entire course of difference.** This creates visible waviness, misaligned cutout patterns, and aesthetically unacceptable results.

### 4. Cutting Shingles — The Insurance Company's False Solution

Insurance adjusters commonly tell policyholders to "just cut the shingles to match." This is unacceptable for five independent technical reasons:

**Problem 1 — Nailing Zone Misalignment:** Every shingle has a manufacturer-engineered nailing zone positioned 5-1/2" to 6-1/2" from the bottom edge. Cutting a shingle to change its effective height shifts the nailing zone relative to the course below. Nails that should anchor through two overlapping layers may only anchor through one, drastically reducing wind uplift resistance. Owens Corning's SureNail Technology places a reinforced fabric strip at a precise location — cutting the shingle repositions where this zone falls, defeating the engineering. ARMA specifies nails must be placed below the sealant strip but above the visible exposure area; cutting compresses or eliminates this zone.

**Problem 2 — Sealant Strip Displacement:** The factory-applied thermally activated adhesive strip is positioned at a precise distance from the bottom edge. Cutting the headlap moves the adhesive relative to the covering shingle. The seal may form at the wrong location, creating channels for wind-driven rain. IKO states directly: "Improper exposure makes it difficult, if not impossible, to properly position the nails and the self-sealing adhesive to achieve the best wind resistance."

**Problem 3 — Wind Resistance Rating Invalidation:** Shingles are tested to ASTM D7158 (incorporating UL 2390 and ASTM D6381) for wind classifications: Class D (115 mph), Class G (150 mph), or Class H (190 mph). ASTM D3462 states the standard is "designed for the evaluation of products as manufactured" — testing occurs "immediately after packaging" on unmodified products. **A field-cut shingle is no longer "as manufactured." No wind test has been performed on the modified product.** The rated wind resistance does not apply. Haag Engineering's wind testing of trimmed metric shingles on 36-inch roofs showed **catastrophic failure — shingles torn at fasteners during wind testing.**

**Problem 4 — Water Infiltration Pathways:** Cutting creates multiple leak pathways: reduced headlap (less overlap protecting fasteners and deck), potentially exposed fasteners, shifted water channels creating aligned gaps where water flows directly to nails, and deformation at transition zones where cut shingles meet uncut originals. IKO notes that when shingles of different exposures are installed above one another, the bottom shingles create "an uneven surface for the top shingles, which may deform and affect their ability to seal properly." Cut edges also expose the fiberglass mat with no granule protection — a point of accelerated weathering.

**Problem 5 — Manufacturer Warranty Voidance:** Every major manufacturer's limited warranty requires installation "in accordance with the application instructions." Cutting a shingle to a non-standard dimension is not in ANY manufacturer's application instructions. **No manufacturer will provide a written letter confirming that cutting their shingle to match a different exposure preserves the warranty.** Request this letter — when they refuse (and they will), send the refusal to the adjuster with a scope for full replacement.

### The "Shingles Are Cut All the Time" Counterargument

Adjusters will point out that shingles are routinely cut during installation (starters, rakes, valleys, courses). This is true but misleading:

- **End cuts and starter courses** — Cutting the *end* of a shingle to offset courses does NOT change the nailing zone position, sealant strip location, or exposure. The shingle's height remains at manufacturer specification.
- **Height cuts to change exposure** — Cutting the *top* (headlap) or *bottom* of a shingle to change its effective height is a fundamentally different modification. It changes the relationship between nailing zone, sealant strip, headlap, and exposure — the exact relationship wind resistance testing validated.

**The distinction: End cuts maintain manufacturer geometry. Height cuts destroy it.**

### 5. Wind Resistance Compromise

Laminate shingles derive much of their wind resistance from the precise overlap of the laminate layers and the engagement of the sealant strip. Any deviation from the manufacturer's specified exposure:
- Changes the sealant strip engagement area
- Alters the wind uplift profile
- May result in the repair area being the first to fail in a subsequent wind event
- Haag's May 2024 wind testing confirmed this with documented catastrophic failures

---

## Manufacturer Bulletins & Technical Documents

### GAF

| Document | Title | Key Content |
|----------|-------|-------------|
| **SS-TS-03** | Timberline Nail Placement — Standard/English Size | Nail placement for 36" × 12" shingles |
| **SS-TS-03a** | Timberline Nail Placement — Metric Size | Nail placement for 39-3/8" × 13-1/4" shingles |
| **R-126** | Replacement of Storm Damaged Shingles | Granule loss is NOT just cosmetic; loose granule repair with asphalt cement is unacceptable; recommends full replacement when damage is significant |
| **R-129** | Shingle Color Code Explained | Establishes "Do Not Mix" principle — bundles must match in plant code, color code, AND version letter to be considered mixable |

**Significance of SS-TS-03 vs SS-TS-03a:** The manufacturer created two entirely separate technical documents because the nailing patterns are fundamentally different between standard and metric shingles. This is the single strongest piece of evidence that mixing sizes is not an engineered solution.

**GAF installation notes:** "When installing Metric dimensioned shingles, you must trim 5 inches off the first WeatherBlocker starter strip or 3 inches off the first ProStart starter strip." This confirms metric shingles require different installation procedures from the first course.

### Haag Engineering (May 2024)

**"Repairing an Existing 36-inch Laminated Asphalt Shingle with Metric-Sized Laminated Asphalt Shingles"**

- Published by Haag Research & Testing, the most respected independent roofing forensics firm in the United States
- Specifically studied whether "a reliable roof repair can be made to an old roof using larger, modern day laminated shingles"
- Evaluated: nailing patterns, overlaps, alignments, and wind resistance
- Found concerns about: "mismatched nailing patterns, misalignments, aesthetic issues, exposed nails and unsightly overlaps"
- Identified potential impacts on: "roof leaks or diminish the wind resistance of the roof"
- Also found: "an unexpected consequence when old, but otherwise new shingles still in their bundle packaging are installed" (old stock of standard-size shingles that have been warehoused may have degraded sealant)
- Available at: https://haageducation.com/s/product/36inch-laminated-asphalt-shingle-repair-study/01tQr000004ZQF3IAO

### CertainTeed

- **NailTrak Technology** (introduced 2004) — three separately defined nailing lines
- Installation instructions specify ALL shingles must be exposed at **5-5/8 inches (143mm)**
- Warning: "Installing shingles too high or too low compared to the previous course can affect the exposure, which in turn would affect the aesthetics, wind performance and seal strength of the roof"

### IKO

- Explicitly states traditional strip shingle dimensions were 12" × 36" as the original standard
- Notes architectural shingle "dimensions may vary from one manufacturer to another"
- **Warns against installing shingles with different exposures over existing shingles** — "creates uneven surfaces that may cause deformation and compromise sealing capability"

### ARMA (Asphalt Roofing Manufacturers Association)

- Confirms both standard and metric dimensions are manufactured
- Standard shingles: 320 nails/square (80 shingles × 4 nails)
- Metric shingles: 260 nails/square (65 shingles × 4 nails)
- The different nail count per square proves different coverage and fastening patterns

---

## The Forensic Argument — "Method of Repair Analysis"

This section belongs AFTER damage analysis and code compliance in the forensic report, right before the conclusion. By the time the reader reaches this section, they have already accepted that damage exists. Now we close the trap: the damage cannot be repaired with current materials.

### Argument Structure

1. **Exposure Measurement** — "Field measurement of the existing shingle exposure revealed [X] inches, consistent with [pre-metric 3-tab / pre-metric laminate / standard-size architectural] shingles manufactured prior to [year]."

2. **Product Identification** — "Based on visual characteristics, this appears to be a [manufacturer] [product line] [type] shingle. [This product was discontinued in YEAR / This product type is no longer manufactured in these dimensions by any manufacturer]."

3. **Current Availability** — "All currently manufactured [3-tab / laminate / architectural] shingles utilize metric dimensions with a 5-5/8 inch exposure. No manufacturer currently produces shingles with a [5-inch / 5-1/8-inch] exposure in [3-tab / laminate] configuration."

4. **Why Repair Is Not Feasible** — "Repair-in-kind using current metric-dimension shingles is not a viable method of repair for the following reasons:
   - The nailing zones of metric shingles do not align with those of the existing standard-size shingles (ref: GAF Technical Details SS-TS-03 vs SS-TS-03a)
   - The self-sealing adhesive strips are positioned for 5-5/8 inch exposure and will not properly engage when installed at 5-inch exposure
   - A 5/8-inch per-course offset compounds to [X] inches over the [Y]-course slope, creating visible misalignment
   - Haag Engineering's May 2024 study on this exact repair scenario identified mismatched nailing patterns, exposed nails, and compromised wind resistance
   - Field-cutting shingles to approximate the original dimensions is not manufacturer-approved, voids warranty, and does not resolve nailing zone incompatibility"

5. **Conclusion** — "As repair-in-kind is not feasible due to product unavailability and dimensional incompatibility, full replacement of the [roof system / affected slopes] is the only method of repair that restores the property to its pre-loss condition in compliance with manufacturer installation requirements and applicable building codes."

### For 3-Tab Shingles (Strongest Case)

3-tabs are the easiest case because:
- ALL manufacturers have discontinued 3-tab lines (GAF was the last in 2023)
- Even if old stock exists, it may have degraded sealant (Haag study finding)
- No current production 3-tab has 5" exposure — period

### For Laminate/Architectural Shingles (Equally Strong)

Laminates with 5" exposure are equally unrepairable because:
- TAMKO was the last manufacturer making 5" exposure laminates (~2010-2012)
- The laminate overlay pattern creates additional alignment issues beyond just exposure
- Laminate shingles have more complex nailing zones than 3-tabs, making misalignment even more impactful

### For IKO "Advantage" Size Roofs

IKO's proprietary larger dimensions (5-7/8" exposure) create a unique situation:
- An IKO Cambridge roof cannot be repaired with ANY other manufacturer's shingles
- Even current IKO products may not match if the installed product has been discontinued
- This is a manufacturer-specific incompatibility on top of the general metric incompatibility

---

## Exposure Measurement Protocol for Field Inspections

### How to Measure

1. **Locate an undamaged, flat area** of the roof slope
2. **Measure from the lower edge** (butt edge) of one shingle course to the lower edge of the course above
3. **Take 3 measurements** across the width of the slope (left, center, right)
4. **Average the measurements** — this is the installed exposure
5. **Photograph the tape measure** against the shingle for documentation

### Reference Values

| Measurement | Indicates | Repairability |
|------------|-----------|---------------|
| 5" (±1/8") | Pre-metric standard (3-tab or laminate) | **Unrepairable** — no current products match |
| 5-1/8" (±1/8") | Transitional metric (1980s-1990s) | **Unrepairable** — rare variant, no current match |
| 5-5/8" (±1/8") | Current metric standard | Repairable IF exact product available |
| 5-7/8" (±1/8") | IKO Advantage size | Repairable ONLY with current IKO products |
| 6" (±1/8") | Atlas variant or specialty product | Limited repairability — must match exact manufacturer |

### Photo Documentation Requirements

- Close-up of tape measure against shingle exposure (showing measurement clearly)
- Wide shot showing consistent exposure across multiple courses
- Edge detail showing shingle dimensions if accessible (rake or eave)

---

## Cross-Reference: State Matching Laws

Many states require replacement materials to match in quality, color, and **size**:

- **NAIC Model Dwelling Fire Policy (MDL-902):** Requires insurer to restore property to pre-loss condition with materials of "like kind and quality"
- **New York:** Insurance Regulation 68 (11 NYCRR § 216) — fair settlement practices require functional and aesthetic restoration
- **Pennsylvania:** PA Code Title 31, Chapter 146 — unfair claim settlement practices
- **New Jersey:** NJAC 11:2-17 — fair claims settlement practices

When a matching-size shingle is unavailable from any manufacturer, the insurer must fund full replacement to achieve "like kind and quality" restoration. A spot repair with mismatched-dimension shingles does not satisfy this standard.

**States WITH enforceable matching statutes:** Alaska, California, Connecticut, Florida, Iowa, Kentucky, Minnesota, Nebraska, Ohio (3901-1-54), Rhode Island, Tennessee, Utah. In these states, the matching statute layers ON TOP of the contract argument.

---

## The Complete Supplement Argument Chain

When presenting exposure incompatibility in a supplement or appeal, deploy these in sequence:

1. **Measure & document** — Tape measure on existing exposure showing [X] inches. Photograph. Take 3 measurements (left, center, right of slope). Average.

2. **Identify the product** — Visual identification + NTS report if needed. Document manufacturer, product line, dimensions, discontinuation status.

3. **Cite C.A.R.** — The replacement product is not **Compatible** (different size, different exposure, different nailing zone). The original product is not **Available** (discontinued / not manufactured in imperial size). The repair is not **Reparable** without compromising the roofing system.

4. **Cite engineering standards** — ASTM D3462 compliance and ASTM D7158 wind ratings apply to the product "as manufactured." A field-cut shingle has no rated wind resistance. No test has been performed on the modified product.

5. **Cite Haag** — Haag Engineering's May 2024 study specifically tested metric-on-36-inch repair scenarios. Wind testing showed catastrophic failure — shingles torn at fasteners.

6. **Get the manufacturer letter** — Contact the shingle manufacturer and request written confirmation of whether cutting their shingle to a non-standard exposure voids the warranty. When they confirm it does (and they will), include that letter.

7. **Cite applicable matching law** — If the state has a matching statute, cite it. If not (NY/PA/NJ), cite NAIC MDL-902 as industry evidence of what "like kind and quality" contractually means.

8. **Scope full replacement** — Full roof (or minimum full slope) as the only installation method that complies with manufacturer specs, maintains warranty, preserves wind resistance ratings, and meets building code.

---

## Sources

- GAF Technical Detail SS-TS-03: Timberline Series Shingle Nail Placement — Standard/English Size
- GAF Technical Detail SS-TS-03a: Timberline Series Shingle Nail Placement — Metric Size
- GAF Technical Bulletin R-126: Replacement of Storm Damaged Shingles
- GAF Technical Bulletin R-129: Shingle Color Code Explained
- Haag Engineering, "Repairing an Existing 36-inch Laminated Asphalt Shingle with Metric-Sized Laminated Asphalt Shingles" (May 2024)
- CertainTeed Landmark Installation Instructions (NailTrak system)
- IKO Technical Blog: "What is the Correct 3-Tab and Architectural Shingle Exposure?"
- IKO Technical Blog: "IKO Shingle Dimensions"
- ARMA Frequently Asked Questions
- Atlas Roofing: "Shingle Installation Mistakes That Cause Major Problems"
- Haag Engineering: Shingle Gauge update (4/09 → 1/12) confirming dimensional changes
- InspectAPedia: Roof Shingle Exposure Standards
- ASTM D3462: Standard Specification for Asphalt Shingles Made from Glass Felt ("designed for the evaluation of products as manufactured")
- ASTM D7158: Standard Test Method for Wind Resistance of Sealed Asphalt Shingles (Class D/G/H ratings)
- ARMA: Nail Application of Asphalt Strip Shingles for New and Recover Roofing
- Owens Corning: SureNail Technology — engineered nailing target specifications
- Owens Corning: How to Nail Roofing Shingles (nail placement requirements)
- Contractor Talk Forum: "Insurance adjuster wants us to cut shingles to match old shingles" (Thread #442840 — real-world adjuster behavior)
- John Senac / Master Your Craft: C.A.R. Framework (Compatibility, Availability, Reparability)
- RoofersCoffeeShop: "The Correct Roof Shingle Exposure for 3-Tab and Laminate Shingles"
- Professional Roofing: "Understanding asphalt shingle standards" (Feb 2021)
- Malarkey Roofing: Vista/Legacy shingle specifications
- TAMKO: Heritage data sheet (metric dimensions confirmed)

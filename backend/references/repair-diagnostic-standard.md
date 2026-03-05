# DumbRoof Repair AI — Diagnostic Standard & Scope Library

> Master reference for the diagnostic engine. Loaded as AI context during every diagnosis.
> Source: roof_leak_ai_handbook.pdf, roof_decision_tree.csv, roof_repair_scope_library.csv
> Training data: 10 real USARM repair jobs (2024)

---

## Decision Tree — Systematic Leak Triage

**Rule: Details FIRST, field shingles SECOND.** The most common diagnostic error is blaming field shingles when the real source is a detail (chimney, wall, penetration, valley, edge). The decision tree forces you to rule out every detail before diagnosing field shingle damage.

### Step-by-Step Triage

| Step | Question | If YES | If NO |
|------|----------|--------|-------|
| S1 | Moisture pattern linked to rain, snowmelt, or wind-driven rain? | Go to S2 | CONDENSATION or interior moisture path |
| S2 | Can interior leak be mapped to a specific roof plane and upslope zone? | Inspect nearest upslope detail in that zone | LOW-CONFIDENCE-VERIFY |
| S3 | Is there a chimney in the mapped upslope zone? | Chimney branch (S3A-S3D) | Go to S4 |
| S4 | Is there a sidewall, dormer wall, stucco wall, or wall front? | Wall branch (S4A-S4D) | Go to S5 |
| S5 | Is there a plumbing vent, exhaust, or skylight? | Penetration branch (S5A-S5C) | Go to S6 |
| S6 | Is the leak aligned with a valley or water concentration path? | Valley branch (S6A-S6C) | Go to S7 |
| S7 | Is the leak low on slope near exterior wall/edge, especially freeze-thaw? | Edge/weather branch (S7A-S7C) | Go to S8 |
| S8 | Is there visible field shingle or fastener damage after details excluded? | FIELD-SHINGLE or NAIL-POP | Go to S9 |
| S9 | Evidence still conflicting? | LOW-CONFIDENCE-VERIFY | — |

### Chimney Branch (S3)
| Sub-Step | Question | If YES |
|----------|----------|--------|
| S3A | Source above roof line or in masonry? | CHM-MASONRY |
| S3B | Downhill face (apron) failed? | CHM-FRONT |
| S3C | Side flashing failed? | CHM-SIDE |
| S3D | Ponding, debris, or no cricket behind chimney? | CHM-BACK |

### Wall Branch (S4)
| Sub-Step | Question | If YES |
|----------|----------|--------|
| S4A | Failure at bottom of wall where runoff should enter gutter? | WALL-KICKOUT |
| S4B | Leak along sidewall courses? | WALL-STEP |
| S4C | Leak at front wall or dormer face? | HEADWALL |
| S4D | Wall cladding or stucco above roof shows drainage failure? | STUCCO-ABOVE-ROOF |

### Penetration Branch (S5)
| Sub-Step | Question | If YES |
|----------|----------|--------|
| S5A | Round plumbing vent boot failed? | VENT-BOOT |
| S5B | Other metal vent or roof jack failed? | VENT-METAL |
| S5C | Skylight flashing vs unit failure? | SKYLIGHT-FLASH or SKYLIGHT-UNIT |

### Valley Branch (S6)
| Sub-Step | Question | If YES |
|----------|----------|--------|
| S6A | Open metal valley defect? | VALLEY-OPEN-METAL |
| S6B | Closed-cut or woven valley defect? | VALLEY-CLOSED-CUT |
| S6C | Debris or ice backup driving the issue? | VALLEY-DEBRIS-ICE |

### Edge/Weather Branch (S7)
| Sub-Step | Question | If YES |
|----------|----------|--------|
| S7A | Ice-dam pattern? | EAVE-ICE-DAM |
| S7B | Drip-edge or unsupported overhang defect? | EAVE-DRIP-EDGE |
| S7C | Gutter overflow or standing water? | GUTTER-BACKUP |

---

## 8 Leak Families (Priority Order)

1. **Chimney** — CHM-FRONT, CHM-SIDE, CHM-BACK, CHM-MASONRY
2. **Roof-to-Wall** — WALL-STEP, WALL-KICKOUT, HEADWALL, STUCCO-ABOVE-ROOF
3. **Penetration** — VENT-BOOT, VENT-METAL
4. **Skylight** — SKYLIGHT-FLASH, SKYLIGHT-UNIT
5. **Valley** — VALLEY-OPEN-METAL, VALLEY-CLOSED-CUT, VALLEY-DEBRIS-ICE
6. **Edge / Weather** — EAVE-ICE-DAM, EAVE-DRIP-EDGE, GUTTER-BACKUP
7. **Field Shingle** — FIELD-SHINGLE
8. **Fastener** — NAIL-POP

**Special codes (not leak families):**
- **CONDENSATION** — Non-roof moisture source (attic condensation, exhaust venting, air sealing failure)
- **LOW-CONFIDENCE-VERIFY** — Evidence conflicting; requires water test, exploratory tear-up, or senior review

---

## 22 Repair Codes — Full Scope Library

### CHIMNEY FAMILY

#### CHM-FRONT — Chimney Apron/Front Face Failure
- **Trigger:** Leak at downhill face of chimney; failed apron or heavy mastic repair
- **Exterior Cues:** Apron metal loose, rusted, short, or sealed with surface mastic only
- **Interior Cues:** Stain or active drip downslope of chimney
- **Standard Scope:** Remove tie-in shingles at chimney base. Install leak barrier up chimney. Install new apron flashing and reshingle tie-in courses.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per chimney base reflashing
- **Complexity Adders:** Steep pitch, laminated shingles, deck rot, multiple flues
- **Escalation:** Masonry defects above flashing; rotten deck; active wall leak
- **Closeout Verification:** Photos of stripped area, new leak barrier, apron, reshingle tie-in, water test if feasible
- **Homeowner Summary:** We found water entering where the lower edge of the chimney meets the shingles. We will remove the tie-in shingles, install new waterproof membrane and metal apron flashing, and reinstall matching shingles.
- **Cost Range:** $400-$700

#### CHM-SIDE — Chimney Sidewall Step/Counter Flashing Failure
- **Trigger:** Leak at chimney sidewalls; failed step flashing or counterflashing
- **Exterior Cues:** Missing one-piece-per-course step flashing, loose counterflashing, rust, caulk-only side detail
- **Interior Cues:** Stain near side of chimney chase or sidewall of fireplace room
- **Standard Scope:** Remove shingles along chimney sides. Install leak barrier. Install new step flashing one piece per course. Install or replace counterflashing with at least 2 inches overlap. Reshingle.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per side or per chimney reflashing assembly
- **Complexity Adders:** Stone veneer, reglet cutting, chimney shape, steep pitch
- **Escalation:** Mason if reglet, mortar, or crown work is required
- **Closeout Verification:** Photos of step flashing sequence, counterflashing overlap, finished tie-in
- **Homeowner Summary:** We found the side flashing system at the chimney has failed. We will rebuild the side flashing so each shingle course has its own metal step flashing and the chimney counterflashing properly covers it.
- **Cost Range:** $500-$900

#### CHM-BACK — Chimney Back Pan/Cricket Failure
- **Trigger:** Leak from upslope side of chimney; ponding, debris, or ice backup
- **Exterior Cues:** No cricket, damaged back pan, debris trap, ponding marks
- **Interior Cues:** Leak often appears after heavy rain or freeze-thaw and may travel downslope before showing
- **Standard Scope:** Remove upslope and side tie-in shingles. Install leak barrier. Install or rebuild back pan and cricket where required. Replace related step flashing and reshingle.
- **Crew Skill:** Lead repair crew
- **Pricing Basis:** Per chimney back-pan/cricket rebuild
- **Complexity Adders:** Width over 24 inches, pitch over 6:12, snow climate, sheathing rot
- **Escalation:** Framing or deck repair if cricket area is deteriorated
- **Closeout Verification:** Photos of stripped area, cricket framing or metal back pan, finished shingle flow lines
- **Homeowner Summary:** We found water backing up behind the chimney. We will rebuild the upslope flashing area so water is diverted around the chimney instead of collecting behind it.
- **Cost Range:** $700-$1,200

#### CHM-MASONRY — Chimney Masonry Failure Above Roofline
- **Trigger:** Leak source is chimney cap, crown, mortar joints, or porous masonry above roof line
- **Exterior Cues:** Cracked crown, missing cap, open mortar, water staining on masonry faces
- **Interior Cues:** Leak may mimic roof leak near chimney but roof flashing can be intact
- **Standard Scope:** Document roof condition. Perform protective roofing tie-in only if needed. Refer for masonry or chimney repair before promising leak elimination.
- **Crew Skill:** Diagnostic / roof + masonry coordination
- **Pricing Basis:** Diagnostic plus temporary protection or coordinated repair
- **Complexity Adders:** Severe masonry deterioration, multiple water paths
- **Escalation:** Chimney / masonry specialist required
- **Closeout Verification:** Photos of crown, cap, joints, and roof flashing showing why primary source is masonry
- **Homeowner Summary:** The leak is being driven by defects in the chimney masonry above the roof line, not only by the roof shingles. This requires chimney repair in addition to any roof tie-in work.
- **Cost Range:** $250-$500 (roof-side only) + masonry referral

### ROOF-TO-WALL FAMILY

#### WALL-STEP — Sidewall Step Flashing Failure
- **Trigger:** Sidewall leak where roof meets wall or dormer cheek wall
- **Exterior Cues:** Missing step flashing, continuous L metal on shingle roof, cladding too tight to roof
- **Interior Cues:** Leak at wall line or near dormer side
- **Standard Scope:** Remove shingles along wall. Install leak barrier. Install one piece of step flashing per shingle course and integrate with wall weather barrier or counterflashing. Reshingle.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per linear foot of sidewall or per sidewall section
- **Complexity Adders:** Stucco, stone, siding removal, wall rot
- **Escalation:** Envelope trade if WRB or stucco termination is defective
- **Closeout Verification:** Photos of stripped wall line, step flashing sequence, finished wall tie-in
- **Homeowner Summary:** We found the sidewall flashing has failed. We will remove the tie-in shingles, install new waterproof membrane and step flashing at each shingle course, and rebuild the wall-to-roof connection.
- **Cost Range:** $350-$600 (without siding) / $500-$900 (with siding)

#### WALL-KICKOUT — Kickout Diverter Failure
- **Trigger:** Leak or rot at bottom of roof-wall intersection near gutter end
- **Exterior Cues:** Missing, undersized, or ineffective kickout diverter; staining at wall end
- **Interior Cues:** Leak near exterior wall end; often wind-driven rain related
- **Standard Scope:** Open lower roof-wall intersection. Install kickout diverter integrated with step flashing and WRB. Repair localized shingles and wall tie-in as needed.
- **Crew Skill:** Lead repair crew
- **Pricing Basis:** Per kickout diverter repair
- **Complexity Adders:** Stucco removal, concealed rot, gutter conflicts
- **Escalation:** Envelope trade if cladding or WRB repair is required
- **Closeout Verification:** Photos showing diverter discharge into gutter and new integration with flashing system
- **Homeowner Summary:** We found the roof runoff is being directed into the wall instead of into the gutter. We will install a diverter flashing at the bottom of the wall so water is thrown into the gutter correctly.
- **Cost Range:** $400-$700

#### HEADWALL — Headwall/Dormer Front Flashing Failure
- **Trigger:** Leak at front wall of dormer or wall face where roof terminates into wall
- **Exterior Cues:** Failed apron or headwall flashing, caulk-only joint, cladding too low
- **Interior Cues:** Stain below dormer front or wall front intersection
- **Standard Scope:** Remove roof-to-wall tie-in shingles. Install leak barrier and new apron/headwall flashing extending up wall and over shingles. Reshingle and maintain cladding clearance.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per headwall section
- **Complexity Adders:** Wide wall front, stucco, trim removal
- **Escalation:** Envelope work if siding/stucco termination is defective
- **Closeout Verification:** Photos of apron flashing height and finished tie-in
- **Homeowner Summary:** We found the front wall flashing where the roof runs into the wall has failed. We will replace that wall flashing and reinstall the shingles so water sheds over the metal.
- **Cost Range:** $350-$600

#### STUCCO-ABOVE-ROOF — Wall Drainage Failure Above Roofline
- **Trigger:** Water enters from stucco, EIFS, or wall drainage failure above roof line
- **Exterior Cues:** Cracked stucco, failed sealant joints, no visible WRB integration, low termination to roof
- **Interior Cues:** Leak often appears near wall line but roof shingles may look serviceable
- **Standard Scope:** Document roof and wall conditions. Coordinate diverter flashing, step flashing, WRB patching, and proper wall termination above roof. Roofing-only patch is not represented as final fix.
- **Crew Skill:** Roof + envelope coordination
- **Pricing Basis:** Coordinated repair scope
- **Complexity Adders:** Hidden wall damage, cladding removal, multiple trades
- **Escalation:** Stucco / envelope specialist required
- **Closeout Verification:** Photos of wall termination, WRB tie-in, diverter, and repaired cladding
- **Homeowner Summary:** The roof is receiving water from defects in the stucco or wall waterproofing above it. This requires a combined roof and wall repair, not just a shingle patch.
- **Cost Range:** $500-$1,200+ (coordinated)

### PENETRATION FAMILY

#### VENT-BOOT — Plumbing Vent Boot/Collar Failure
- **Trigger:** Cracked plumbing vent collar or failed boot flashing
- **Exterior Cues:** Split rubber, lifted flange, exposed fasteners, cracked shingles around pipe
- **Interior Cues:** Localized stain below vent line
- **Standard Scope:** Remove surrounding shingles as needed. Install 20x20 inch leak barrier patch. Replace boot or flashing. Install shingles in proper sequence with flange under upslope courses and over downslope courses.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per pipe boot
- **Complexity Adders:** Brittle shingles, multiple pipes in cluster, steep pitch
- **Escalation:** Deck repair if penetration has long-term rot
- **Closeout Verification:** Photos of stripped area, new patch, new boot, final flange integration
- **Homeowner Summary:** We found the flashing around the plumbing vent has failed. We will replace the vent flashing and reinstall the shingles in the correct waterproof sequence.
- **Cost Range:** $250-$400

#### VENT-METAL — Metal Vent/Roof Jack Failure
- **Trigger:** Leak at metal roof jack, exhaust hood, or non-plumbing round penetration
- **Exterior Cues:** Corroded or punctured flange, poor shingle tie-in, loose hood assembly
- **Interior Cues:** Leak aligned with vent or hood penetration
- **Standard Scope:** Remove tie-in shingles. Replace vent flashing or jack. Patch underlayment around penetration. Reshingle and seal per manufacturer instructions.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per penetration
- **Complexity Adders:** Dryer or bath vent routing issues, code corrections, wide hood flange
- **Escalation:** HVAC or appliance trade if vent termination is wrong
- **Closeout Verification:** Photos of new jack/flashing, tie-in, and finished vent termination
- **Homeowner Summary:** We found the metal vent flashing has failed. We will replace the flashing assembly and rebuild the shingle tie-in around that roof penetration.
- **Cost Range:** $250-$450

### SKYLIGHT FAMILY

#### SKYLIGHT-FLASH — Skylight Flashing Failure
- **Trigger:** Leak at otherwise serviceable skylight due to flashing failure
- **Exterior Cues:** Debris at upslope edge, failed backer flashing, missing side step flashing, bottom apron patched with caulk
- **Interior Cues:** Leak at top corners or along skylight shaft after rain
- **Standard Scope:** Strip shingles around skylight. Install leak barrier up curb sides. Install side step flashing, bottom apron, and upslope backer flashing. Reinstall shingles.
- **Crew Skill:** Lead repair crew
- **Pricing Basis:** Per skylight reflashing
- **Complexity Adders:** Unit age, curb rot, wide unit, brittle shingles
- **Escalation:** Skylight replacement if glazing, frame, or curb is failed
- **Closeout Verification:** Photos of curb membrane, side flashing, backer flashing, finished shingle tie-in
- **Homeowner Summary:** We found the skylight flashing has failed. We will rebuild the flashing system around the skylight so water drains around the unit instead of into the home.
- **Cost Range:** $400-$700

#### SKYLIGHT-UNIT — Failed Skylight Unit/Curb
- **Trigger:** Leak source is failed skylight unit, gasket, glazing seal, or rotten curb
- **Exterior Cues:** Glass seal failure, cracked frame, rotten curb, recurrent leak despite proper flashing
- **Interior Cues:** Water between panes, staining not tied to flashing path, curb deterioration
- **Standard Scope:** Replace skylight unit or curb and install new flashing system during reinstallation.
- **Crew Skill:** Lead repair crew / replacement crew
- **Pricing Basis:** Per skylight replacement
- **Complexity Adders:** Interior finish tie-in, shaft work, custom size
- **Escalation:** Carpentry if curb or interior shaft is rotten
- **Closeout Verification:** Photos of removed unit, new unit or curb, and full reflashing
- **Homeowner Summary:** The skylight itself has failed, so reflashing alone would not be a durable repair. We recommend replacing the skylight and installing a new flashing system at the same time.
- **Cost Range:** $800-$2,000+

### VALLEY FAMILY

#### VALLEY-OPEN-METAL — Open Metal Valley Failure
- **Trigger:** Leak in open metal valley due to corrosion, puncture, or fastener placement
- **Exterior Cues:** Corroded metal, holes, exposed fasteners, cracked tie-in shingles, debris track
- **Interior Cues:** Leak aligned with valley run, often after heavy rain
- **Standard Scope:** Strip shingles from both sides as needed. Install leak barrier. Install new valley metal of proper width. Reinstall tie-in shingles with fasteners out of water path.
- **Crew Skill:** Lead repair crew
- **Pricing Basis:** Per linear foot of valley or per valley section
- **Complexity Adders:** Long valley, steep pitch, crosswash, woven tie-in removal
- **Escalation:** Deck replacement if rot follows valley line
- **Closeout Verification:** Photos of stripped valley, new membrane, new metal, nail placement, finished valley line
- **Homeowner Summary:** We found the open valley metal has failed. We will replace the valley metal and rebuild the shingles on both sides so concentrated water stays in the designed water course.
- **Cost Range:** $300-$500

#### VALLEY-CLOSED-CUT — Closed-Cut/Woven Valley Failure
- **Trigger:** Leak in closed-cut or woven valley due to bad cut, exposed nails, or underlayment failure
- **Exterior Cues:** Improper cut line, exposed fasteners near centerline, lumpy or bridged courses, old patching
- **Interior Cues:** Leak aligned with valley, sometimes intermittent depending on storm volume
- **Standard Scope:** Strip valley tie-ins from both sides. Install leak barrier. Rebuild closed-cut or approved valley assembly to product standard. Replace damaged shingles.
- **Crew Skill:** Lead repair crew
- **Pricing Basis:** Per linear foot of valley or per valley rebuild
- **Complexity Adders:** Architectural shingles, multiple roof planes, steep pitch
- **Escalation:** Deck replacement if rot is present
- **Closeout Verification:** Photos of rebuilt valley, cut line, and fastener exclusion zone
- **Homeowner Summary:** We found the valley where two roof planes meet has been installed or aged in a way that is allowing water through. We will rebuild that valley assembly correctly.
- **Cost Range:** $500-$900

#### VALLEY-DEBRIS-ICE — Valley Debris/Ice Backup
- **Trigger:** Debris dam or ice buildup causing temporary backup in otherwise repairable valley zone
- **Exterior Cues:** Leaves, branches, sediment, or ice accumulation restricting flow
- **Interior Cues:** Leak happens during backups or thaw events
- **Standard Scope:** Clear valley and related gutter obstruction. Repair damaged low courses if needed. Add membrane and rebuild local tie-in if assembly has been compromised.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Service repair plus local valley repair
- **Complexity Adders:** Tree cover, repeated maintenance issue, damaged gutter system
- **Escalation:** Gutter or ventilation recommendations if recurrence risk remains high
- **Closeout Verification:** Before/after debris photos, repaired tie-in, and discharge path
- **Homeowner Summary:** We found runoff is backing up in the valley because water cannot exit properly. We will clear the obstruction and repair any roofing materials damaged by that backup.
- **Cost Range:** $250-$400

### EDGE / WEATHER FAMILY

#### EAVE-ICE-DAM — Ice Dam Leak
- **Trigger:** Leak near exterior wall during snow, thaw, or refreeze conditions
- **Exterior Cues:** Ice line at eave, damaged lower courses, staining at soffit edge, snow pattern
- **Interior Cues:** Leak near exterior wall line after snow or freeze-thaw rather than ordinary rain
- **Standard Scope:** Repair damaged eave courses. Install membrane beyond warm wall where scope permits. Document attic heat loss, air sealing, and ventilation corrections needed for durable prevention.
- **Crew Skill:** Repair crew plus recommendation
- **Pricing Basis:** Per eave section
- **Complexity Adders:** Long eave runs, insulation problems, chronic recurrence
- **Escalation:** Attic ventilation / insulation trade recommendation
- **Closeout Verification:** Photos of eave repair and documentation of contributing attic conditions
- **Homeowner Summary:** We found water backing up from ice formation at the roof edge. We will repair the roof edge and document the attic or ventilation conditions that need to be corrected to prevent repeat leakage.
- **Cost Range:** $300-$800 (repair) / $1,000-$3,000 (permanent with insulation)

#### EAVE-DRIP-EDGE — Drip Edge/Edge Failure
- **Trigger:** Leak at roof edge due to missing or failed drip edge or unsupported shingle overhang
- **Exterior Cues:** Reverse-lapped or missing drip edge, excessive shingle overhang, edge cracking
- **Interior Cues:** Localized edge leak, often near fascia or soffit line
- **Standard Scope:** Remove lower edge shingles as needed. Install or correct drip edge. Replace starter and first-course shingles where damaged. Re-establish proper overhang.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per linear foot of eave or rake
- **Complexity Adders:** Gutter removal/reset, rotten fascia, multiple layers
- **Escalation:** Fascia or gutter repair if substrate is damaged
- **Closeout Verification:** Photos of new drip edge sequencing and final shingle overhang
- **Homeowner Summary:** We found the roof edge is not shedding water correctly. We will rebuild the drip-edge and starter area so water drops away from the roof edge properly.
- **Cost Range:** $250-$500

#### GUTTER-BACKUP — Gutter Overflow/Standing Water
- **Trigger:** Leak caused by gutter overflow or standing water at edge condition
- **Exterior Cues:** Clogged gutter, poor pitch, standing water, water staining behind gutter
- **Interior Cues:** Leak near edge during heavy rain, especially when gutter is full
- **Standard Scope:** Clear or correct gutter condition and repair any adjacent eave or wall flashing damage created by backup.
- **Crew Skill:** Repair / gutter crew
- **Pricing Basis:** Service call plus local roof repair
- **Complexity Adders:** Undersized gutter, wall rot, hidden edge damage
- **Escalation:** Gutter replacement recommendation if system is undersized or failing
- **Closeout Verification:** Photos of corrected gutter flow and repaired edge roofing
- **Homeowner Summary:** We found the leak is being caused by water backing up at the gutter rather than by an isolated shingle defect. We will correct the runoff issue and repair any roofing materials damaged by it.
- **Cost Range:** $200-$500

### FIELD SHINGLE FAMILY

#### FIELD-SHINGLE — Field Shingle Damage
- **Trigger:** Leak from punctured, creased, slipped, or missing field shingles
- **Exterior Cues:** Visible shingle damage, blow-off, puncture, or lifted unsealed tabs
- **Interior Cues:** Leak maps to open field after details above are excluded
- **Standard Scope:** Remove damaged shingles. Inspect deck and underlayment. Install replacement shingles and reseal disturbed surrounding courses.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per shingle repair area
- **Complexity Adders:** Discontinued color, brittle roof, wide damage area
- **Escalation:** Replacement recommendation if repeated field failures are widespread
- **Closeout Verification:** Photos of removed damage, deck condition, and finished shingle match
- **Homeowner Summary:** We found the leak is coming from damaged shingles in the open field of the roof. We will replace the damaged shingles and restore the waterproof tie-in around them.
- **Cost Range:** $250-$400

### FASTENER FAMILY

#### NAIL-POP — Fastener Failure
- **Trigger:** Leak from raised, exposed, angled, or poorly driven fastener
- **Exterior Cues:** Popped nail head, torn overlying shingle, exposed fastener head
- **Interior Cues:** Small, localized leak path with otherwise serviceable shingles
- **Standard Scope:** Lift overlying shingle, remove bad fastener, renail in correct position, seal old hole, replace torn shingle as needed, hand-seal disturbed seal strip.
- **Crew Skill:** Repair crew
- **Pricing Basis:** Per fastener repair area
- **Complexity Adders:** Multiple nail pops, brittle seal strips, poor installation pattern across slope
- **Escalation:** Replacement recommendation if fastener errors are systemic
- **Closeout Verification:** Photos of exposed fastener, repaired hole, and resealed course
- **Homeowner Summary:** We found the leak is coming from a failed fastener rather than a major flashing defect. We will correct the fastener location, seal the old hole, and repair the affected shingle area.
- **Cost Range:** $250-$400

### SPECIAL CODES

#### CONDENSATION — Non-Roof Moisture
- **Trigger:** Moisture present without rain, broad deck wetness, rusted nails, wet insulation
- **Exterior Cues:** Little or no correlating roof defect; may coincide with venting or air-sealing issues
- **Interior Cues:** Moisture pattern broad or recurring in cold weather; bathroom or dryer vent discharge may be visible
- **Standard Scope:** Do not sell as roof leak repair only. Document conditions. Recommend correcting moisture source, ventilation imbalance, and air leakage. Perform roofing repairs only if separate liquid entry defect is confirmed.
- **Crew Skill:** Diagnostic / ventilation recommendation
- **Escalation:** HVAC, insulation, or building-science specialist as needed
- **Closeout Verification:** Photos of wet insulation, rusted nails, vent discharge, and lack of active liquid entry
- **Homeowner Summary:** The moisture pattern points to attic condensation rather than a direct rain leak through the roof. The durable fix is to correct the moisture and ventilation conditions, not just patch shingles.
- **Cost Range:** $250-$500 (diagnostic) + specialist referral

#### LOW-CONFIDENCE-VERIFY — Unresolved/Conflicting Evidence
- **Trigger:** Evidence is conflicting, inaccessible, or does not support a confident single source
- **Exterior Cues:** Multiple suspect details or insufficient visibility
- **Interior Cues:** Leak path cannot be mapped reliably from available evidence
- **Standard Scope:** Do not issue final paid repair without controlled water test, limited exploratory tear-up, or additional evidence package.
- **Crew Skill:** Senior diagnostic
- **Escalation:** Senior tech or destructive verification required
- **Closeout Verification:** Document why confidence is low and what evidence is still needed
- **Homeowner Summary:** We have narrowed the problem area but the current evidence is not strong enough to promise a final repair outcome. The next step is controlled testing or limited exploratory opening.
- **Cost Range:** $250-$500 (diagnostic visit)

---

## Key Diagnostic Rules

1. **Details first, field shingles second.** Always rule out chimney, wall, penetration, valley, and edge details before diagnosing field shingle damage.
2. **Interior leak location maps to upslope zone.** Water enters upslope from where it shows inside. Trace the path.
3. **Weather timing matters.** Rain = liquid entry. Freeze-thaw = ice dam. No-rain moisture = condensation.
4. **One code per diagnosis.** If multiple issues exist, use the PRIMARY code and note secondaries in the escalation/notes field.
5. **Confidence below 0.60 = LOW-CONFIDENCE-VERIFY.** Never commit to a paid repair without adequate evidence.
6. **Escalation flags are mandatory** when the repair requires a trade outside roofing (mason, HVAC, envelope, carpenter).

---

## Real Repair Training Examples (USARM 2024)

These are actual repair jobs completed by USARM field crews. Use them to calibrate diagnosis patterns.

### Example 1: 6418 Wild Cherry Dr, Coopersburg PA
- **Roofer Notes:** "Chimney leak. Chimney flashing replaced - Shingles, Step flashing, Trim Metal"
- **Diagnosis:** CHM-SIDE (chimney step flashing failure)
- **Scope:** Full chimney reflashing — step flashing, counterflashing, shingle tie-in
- **Photos:** 11 photos documenting stripped area and rebuilt flashing

### Example 2: 829 Tulip Ave, Croydon PA
- **Roofer Notes:** "Chimney step flashing replaced"
- **Diagnosis:** CHM-SIDE
- **Scope:** Chimney step flashing replacement
- **Photos:** 7 photos

### Example 3: 115 Laurel Rd, Southampton PA
- **Roofer Notes:** "Pipe collar replacement"
- **Diagnosis:** VENT-BOOT
- **Scope:** Single pipe boot replacement
- **Photos:** 3 photos — minimal but sufficient for a straightforward boot swap

### Example 4: 11 Sawmill Rd, Medford NJ
- **Roofer Notes:** "Hole in the copper cone"
- **Diagnosis:** VENT-METAL (copper cone = specialty metal penetration)
- **Scope:** Metal penetration flashing repair/replacement
- **Photos:** 16 photos — extensive documentation of copper detail work

### Example 5: 15 Smith Dr, Allentown NJ
- **Roofer Notes:** "Looks like someone stepped on the hips causing them to rip through the nails"
- **Diagnosis:** NAIL-POP / FIELD-SHINGLE (mechanical damage to hip caps — fastener-driven failure)
- **Scope:** Hip cap repair — reseat or replace torn caps, correct fastener placement
- **Photos:** 7 photos

### Example 6: 111 Stevers Mill Rd, North Wales PA
- **Roofer Notes:** "Window Leaking - Caulk"
- **Diagnosis:** STUCCO-ABOVE-ROOF or HEADWALL (window-related wall leak, not roof)
- **Scope:** Caulk/sealant repair at window — may escalate to flashing
- **Photos:** 4 photos
- **Key Learning:** "Window leak" often means wall drainage failure, not roof

### Example 7: 2 Jasmine Rd, Levittown PA
- **Roofer Notes:** "Window leak"
- **Diagnosis:** HEADWALL or WALL-STEP (roof-to-wall intersection near window)
- **Scope:** Wall flashing investigation and repair
- **Photos:** 11 photos

### Example 8: 404 Woodbine Ave, Feasterville PA
- **Roofer Notes:** "Window and wall issues, not roof"
- **Diagnosis:** STUCCO-ABOVE-ROOF (roofer already identified non-roof source)
- **Scope:** Coordinate wall repair; roofing-only patch not the final fix
- **Photos:** 5 photos
- **Key Learning:** When roofer says "not roof" — trust them. Code as STUCCO-ABOVE-ROOF or CONDENSATION.

### Example 9: 130 Avondale Rd, Norristown PA
- **Roofer Notes:** "Expose walls - Caulking"
- **Diagnosis:** WALL-STEP or HEADWALL (wall exposure = flashing investigation)
- **Scope:** Wall-to-roof junction repair
- **Photos:** 6 photos

### Example 10: 11 Elm Ln, Levittown PA
- **Roofer Notes:** "Weird situation with the front porch ceiling"
- **Diagnosis:** LOW-CONFIDENCE-VERIFY (ambiguous — porch ceiling could be wall, gutter, or flat roof issue)
- **Scope:** Diagnostic visit, further investigation needed
- **Photos:** 3 photos
- **Key Learning:** "Weird situation" = escalate to LOW-CONFIDENCE-VERIFY. Don't guess.

---

## Industry References

1. GAF Pro Field Guide for Steep-Slope Roofs (RESGN103) — Primary scope standard
2. CSIA Chimney Flashing Best Practices — Chimney family standard
3. BASC Step and Kick-Out Flashing Guide — Wall family standard
4. BASC Flashing at Roof-Wall Intersections (Existing Homes)
5. Sto EIFS Diverter Flashing Detail (DTL_53s.62) — Stucco/EIFS wall-to-roof detail
6. GAF Vent Pipe Leak Prevention Guide — Penetration family
7. GAF Technical Bulletin R-116: Ice Dams — Edge/weather family
8. GAF Technical Bulletin R-141: Drip Edges and Shingles — Edge family
9. GAF Technical Bulletin R-117: Improperly Driven Nails — Fastener family
10. IRC R905, R903, R703 — Building code requirements for roofing, flashing, exterior walls

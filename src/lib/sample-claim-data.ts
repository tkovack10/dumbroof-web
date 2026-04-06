/**
 * Sample claim data for the public demo dashboard at /sample/dashboard.
 *
 * This is a REAL claim USARM won — 21 McNamara Ave, Binghamton, NY. The
 * carrier's first scope was $37,668.97 and USARM recovered a final
 * settlement of $80,962.89 (+$43,293.92, +115%). The primary winning
 * argument was the house wrap corner rule (RCNYS R703.1/R703.2) which
 * forced the carrier to expand siding from left-elevation-only (741 SF)
 * to all 4 elevations (3,078 SF).
 *
 * PII SCRUBBED per Tom's directive 2026-04-06:
 *   - No homeowner name
 *   - No adjuster name, email, phone
 *   - No real claim number (replaced with DEMO-XXXXX)
 *   - No policy number
 *   - No inspector personal info
 * The public street address is kept since it matches the story and
 * county records are already public.
 *
 * Source: ~/USARM-Claims-Platform/claims/21-mcnamara-ave/claim_config.json
 * Anchor: USARM-Claims-Platform funnel investigation 2026-04-06 +
 *         Tom's "WE SHOULD USE 21 MCNAMAERA" directive.
 */

import type {
  ScopeComparisonRow,
  CarrierLineItem,
  ScopeComparisonResponse,
  ScopeComparisonFinancials,
  ScopeComparisonSummary,
} from "@/types/scope-comparison";

export const SAMPLE_CLAIM_ID = "demo-21-mcnamara";

export const SAMPLE_CLAIM_META = {
  id: SAMPLE_CLAIM_ID,
  address: "21 McNamara Ave, Binghamton, NY 13903",
  carrier: "State Farm",
  /** Anonymized — real claim number withheld */
  claim_number: "DEMO-2026-ROOF-001",
  date_of_loss: "July 3, 2025",
  status: "won",
  phase: "settled",
  squares: 19.09,
  roof_material: "Laminated comp shingle (architectural)",
  siding_sf: 3078,
  photo_count: 47,
  /** Real win amounts from the closed claim */
  first_scope_rcv: 37668.97,
  won_scope_rcv: 80962.89,
  win_delta: 43293.92,
  win_pct: 1.15, // +115%
} as const;

/* ----------------------------------------------------------------------------
 * Comparison rows — the 10 most impactful items from the 27-row carrier scope
 *
 * Ordered to tell the story: roofing underscoping first (small deltas), then
 * the siding explosion (biggest delta, RCNYS R703.2 code argument), then the
 * garage + window wraps that followed.
 * ------------------------------------------------------------------------- */

export const SAMPLE_COMPARISON_ROWS: ScopeComparisonRow[] = [
  // ─── Roofing — area understated ──────────────────────────────────────────
  {
    checklist_desc: "Tear off laminated comp shingles",
    usarm_desc: "Remove laminated comp shingle rfg - w/out felt",
    usarm_amount: 1688.29, // 22.53 SQ × $74.94
    ev_qty: 22.53,
    ev_unit: "SQ",
    ev_formula: "(eagleview_area + waste_factor)",
    xact_code: "RFG 240R",
    xact_unit_price: 74.94,
    carrier_desc: "Tear off, haul and dispose of comp shingles - Laminated",
    carrier_amount: 1419.24,
    carrier_qty: 17.58,
    carrier_unit: "SQ",
    carrier_unit_price: 80.73,
    carrier_notes: "Carrier used 17.58 SQ — EagleView measured 19.09 SQ base area before waste",
    matched_by: "description",
    status: "under",
    note: "Carrier area understates EagleView by 1.51 SQ before waste factor. USARM includes full 22.53 SQ with waste.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "EagleView measured area is 19.09 SQ. With standard 13.8% waste factor, install SQ = 22.53. Carrier's 17.58 SQ figure has no documented basis.",
    carrier_trick: "area_understatement",
    trick_flag: "medium",
    qty_variance: "+4.95 SQ",
    price_variance: "",
    unit_mismatch: "",
    category: "removal",
    trade: "roofing",
  },
  {
    checklist_desc: "Ice & water barrier (RCNYS R905.1.2)",
    usarm_desc: "Ice & water barrier - full eaves + valleys",
    usarm_amount: 4388.16, // 1959 SF × $2.24
    ev_qty: 1959,
    ev_unit: "SF",
    ev_formula: "(eaves_lf × 6) + (valley_lf × 3)",
    xact_code: "RFG IWS",
    xact_unit_price: 2.24,
    carrier_desc: "Ice & water barrier (1,207.64 SF)",
    carrier_amount: 3064.99,
    carrier_qty: 1207.64,
    carrier_unit: "SF",
    carrier_unit_price: 2.54,
    carrier_notes: "Carrier underscoped by 751 SF",
    matched_by: "description",
    status: "under",
    note: "RCNYS R905.1.2 requires ice barrier extending 24 inches beyond the interior wall line — 2 courses at eaves (6 ft width), not 1.",
    code_citation: {
      code_tag: "RCNYS",
      section: "R905.1.2",
      title: "Ice barriers",
      requirement:
        "An ice barrier that consists of not fewer than two layers of underlayment cemented together, or of self-adhering polymer modified bitumen sheet, shall be used in lieu of normal underlayment and extend from the lowest edges of all roof surfaces to a point not less than 24 inches inside the exterior wall line.",
      supplement_argument:
        "Binghamton NY is an ice-barrier jurisdiction. RCNYS R905.1.2 mandates 24 inches INSIDE the exterior wall — that's 2 courses (6 ft width), not 1. Carrier's 1,207 SF figure is only 1 course wide.",
      manufacturer_specs: [],
      has_warranty_void: false,
      jurisdiction: "Binghamton, NY (RCNYS 2020)",
    },
    irc_code: "RCNYS R905.1.2",
    supplement_argument: "2-course minimum per code. Carrier used 1-course width.",
    carrier_trick: "code_short_width",
    trick_flag: "high",
    qty_variance: "+751 SF",
    price_variance: "",
    unit_mismatch: "",
    category: "underlayment",
    trade: "roofing",
  },
  {
    checklist_desc: "Drip edge (RCNYS R905.2.8.5)",
    usarm_desc: "R&R Drip edge - eaves + rakes",
    usarm_amount: 1629.27,
    ev_qty: 387,
    ev_unit: "LF",
    ev_formula: "eaves_lf + rakes_lf",
    xact_code: "RFG DRIP",
    xact_unit_price: 4.21,
    carrier_desc: "Drip edge (245.51 LF)",
    carrier_amount: 1026.13,
    carrier_qty: 245.51,
    carrier_unit: "LF",
    carrier_unit_price: 4.18,
    carrier_notes: "Carrier scoped 246 LF vs 387 LF required — missing rakes",
    matched_by: "description",
    status: "under",
    note: "RCNYS R905.2.8.5 requires drip edge at BOTH eaves AND rake edges. Carrier only scoped eaves.",
    code_citation: {
      code_tag: "RCNYS",
      section: "R905.2.8.5",
      title: "Drip edge",
      requirement:
        "A drip edge shall be provided at eaves and rake edges of shingle roofs. Adjacent segments of drip edge shall be overlapped a minimum of 2 inches.",
      supplement_argument:
        "Drip edge is mandatory at eaves AND rakes per RCNYS R905.2.8.5. Carrier's 246 LF covers eaves only. Adding 141 LF of rake drip edge is code-compliance, not optional.",
      manufacturer_specs: [],
      has_warranty_void: false,
      jurisdiction: "Binghamton, NY (RCNYS 2020)",
    },
    irc_code: "RCNYS R905.2.8.5",
    supplement_argument: "Required at eaves AND rakes per code.",
    carrier_trick: "code_partial_coverage",
    trick_flag: "high",
    qty_variance: "+141 LF",
    price_variance: "",
    unit_mismatch: "",
    category: "flashing",
    trade: "roofing",
  },
  {
    checklist_desc: "Starter course shingle",
    usarm_desc: "Asphalt starter - universal starter course",
    usarm_amount: 739.32,
    ev_qty: 303,
    ev_unit: "LF",
    ev_formula: "eaves_lf",
    xact_code: "RFG STARTR",
    xact_unit_price: 2.44,
    carrier_desc: "Asphalt starter - universal starter course (230.35 LF)",
    carrier_amount: 634.38,
    carrier_qty: 230.35,
    carrier_unit: "LF",
    carrier_unit_price: 2.75,
    carrier_notes: "Carrier underscoped starter by 73 LF",
    matched_by: "description",
    status: "under",
    note: "Carrier scoped 230 LF — should match full eaves measurement of 303 LF per EagleView. GAF Timberline HDZ requires factory starter strips at all eaves; cut shingles void warranty.",
    code_citation: {
      code_tag: "MFR",
      section: "GAF Timberline HDZ Installation Guide",
      title: "Factory starter strip requirement",
      requirement:
        "Factory-made starter strips are required at all eaves. Cut shingles are NOT an approved substitute and will void the GAF Golden Pledge warranty.",
      supplement_argument:
        "GAF manufacturer specs require universal starter course at the FULL eave length (303 LF), not the carrier's reduced 230 LF. Failing to install code-required starter at the entire eave voids the manufacturer warranty and breaches RCNYS R905.2.7.",
      manufacturer_specs: [
        {
          manufacturer: "GAF",
          document: "Timberline HDZ Installation Guide",
          requirement: "Factory starter at all eaves",
          warranty_void: true,
          warranty_text: "Cut shingles in lieu of factory starter voids the Golden Pledge warranty.",
        },
      ],
      has_warranty_void: true,
      jurisdiction: "Binghamton, NY (RCNYS 2020) + manufacturer spec",
    },
    irc_code: "RCNYS R905.2.7",
    supplement_argument: "Manufacturer-mandated factory starter at full eaves length.",
    carrier_trick: "manufacturer_omission",
    trick_flag: "high",
    qty_variance: "+73 LF",
    price_variance: "",
    unit_mismatch: "",
    category: "flashing",
    trade: "roofing",
  },
  {
    checklist_desc: "Hip/Ridge cap shingles",
    usarm_desc: "R&R Hip/Ridge cap - Standard profile",
    usarm_amount: 2525.67, // 211 LF × $11.97
    ev_qty: 211,
    ev_unit: "LF",
    ev_formula: "hips_lf + ridges_lf",
    xact_code: "RFG RIDGC",
    xact_unit_price: 11.97,
    carrier_desc: "R&R Hip/Ridge cap - Standard profile (187.36 LF)",
    carrier_amount: 2482.81,
    carrier_qty: 187.36,
    carrier_unit: "LF",
    carrier_unit_price: 13.25,
    carrier_notes: "",
    matched_by: "description",
    status: "under",
    note: "Carrier scoped 187 LF — should be 211 LF per EagleView.",
    code_citation: null,
    irc_code: "",
    supplement_argument: "",
    carrier_trick: "",
    trick_flag: "",
    qty_variance: "+24 LF",
    price_variance: "",
    unit_mismatch: "",
    category: "material",
    trade: "roofing",
  },
  {
    checklist_desc: "Step flashing (R&R, not reset)",
    usarm_desc: "Step flashing - R&R (not reset)",
    usarm_amount: 849.7, // 58 LF × $14.65
    ev_qty: 58,
    ev_unit: "LF",
    ev_formula: "wall_abutment_lf",
    xact_code: "RFG FLASHST",
    xact_unit_price: 14.65,
    carrier_desc: "",
    carrier_amount: 0,
    carrier_qty: 0,
    carrier_unit: "",
    carrier_unit_price: 0,
    carrier_notes: "",
    matched_by: "missing",
    status: "missing",
    note: "Step flashing must be R&R when shingles are removed — cannot be re-embedded to code.",
    code_citation: null,
    irc_code: "RCNYS R903.2",
    supplement_argument: "",
    carrier_trick: "",
    trick_flag: "",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "flashing",
    trade: "roofing",
  },
  {
    checklist_desc: "Counterflashing / apron flashing",
    usarm_desc: "R&R Counterflashing - Apron flashing",
    usarm_amount: 685.08, // 44 LF × $15.57
    ev_qty: 44,
    ev_unit: "LF",
    ev_formula: "abutment_lf",
    xact_code: "RFG FLASHCT",
    xact_unit_price: 15.57,
    carrier_desc: "",
    carrier_amount: 0,
    carrier_qty: 0,
    carrier_unit: "",
    carrier_unit_price: 0,
    carrier_notes: "",
    matched_by: "missing",
    status: "missing",
    note: "Apron flashing at chimney + wall abutments — omitted from carrier scope.",
    code_citation: null,
    irc_code: "RCNYS R903.2",
    supplement_argument: "",
    carrier_trick: "",
    trick_flag: "",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "flashing",
    trade: "roofing",
  },
  {
    checklist_desc: "Additional charge — steep roof (7/12 to 9/12)",
    usarm_desc: "Additional charge for steep roof - 7/12 to 9/12 slope",
    usarm_amount: 1223.10, // 19.09 SQ × $64.07
    ev_qty: 19.09,
    ev_unit: "SQ",
    ev_formula: "steep_area_sq",
    xact_code: "RFG STEEP",
    xact_unit_price: 64.07,
    carrier_desc: "Additional charge for steep roof 7/12-9/12 (17.58 SQ)",
    carrier_amount: 1389.81,
    carrier_qty: 17.58,
    carrier_unit: "SQ",
    carrier_unit_price: 79.06,
    carrier_notes: "",
    matched_by: "description",
    status: "under",
    note: "Area understated (17.58 SQ vs EagleView 19.09 SQ).",
    code_citation: null,
    irc_code: "",
    supplement_argument: "",
    carrier_trick: "",
    trick_flag: "",
    qty_variance: "+1.51 SQ",
    price_variance: "",
    unit_mismatch: "",
    category: "labor",
    trade: "roofing",
  },
  {
    checklist_desc: "Pipe jack / flashing",
    usarm_desc: "R&R Pipe boot/jack",
    usarm_amount: 136.0,
    ev_qty: 2,
    ev_unit: "EA",
    ev_formula: "pipe_count",
    xact_code: "RFG PIPBOOT",
    xact_unit_price: 68.0,
    carrier_desc: "Flashing - pipe jack (2 EA)",
    carrier_amount: 153.64,
    carrier_qty: 2,
    carrier_unit: "EA",
    carrier_unit_price: 76.82,
    carrier_notes: "",
    matched_by: "description",
    status: "match",
    note: "Quantities match carrier scope.",
    code_citation: null,
    irc_code: "",
    supplement_argument: "",
    carrier_trick: "",
    trick_flag: "",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "flashing",
    trade: "roofing",
  },

  // ─── Siding — THE HERO (drove most of the $43K recovery) ─────────────────
  {
    checklist_desc: "Aluminum siding — all 4 elevations",
    usarm_desc: "R&R Aluminum siding .024\" - all 4 elevations",
    usarm_amount: 38582.18, // 3094 SF × $12.47
    ev_qty: 3094,
    ev_unit: "SF",
    ev_formula: "total_wall_area_sf (all elevations)",
    xact_code: "SDG ALUMS",
    xact_unit_price: 12.47,
    carrier_desc: "R&R Siding - .014\" metal - LEFT ELEVATION ONLY (741 SF)",
    carrier_amount: 8282.89,
    carrier_qty: 741,
    carrier_unit: "SF",
    carrier_unit_price: 11.18,
    carrier_notes:
      "MAJOR DISCREPANCY: Carrier scoped only LEFT elevation (741 SF / 24% of total). Used .014\" thin-gauge pricing instead of .024\" standard.",
    matched_by: "description",
    status: "under",
    note: "HOUSE WRAP CORNER RULE: RCNYS R703.2 requires continuous water-resistive barrier. House wrap cannot terminate at a corner post — if one elevation is replaced, the WRB behind the adjacent elevations must be penetrated to maintain continuity, which requires removal of those sidings. All 4 elevations become mandatory. This single code argument drove the carrier to expand from 741 SF → 3,078 SF.",
    code_citation: {
      code_tag: "RCNYS",
      section: "R703.2",
      title: "Water-resistive barrier (House wrap corner rule)",
      requirement:
        "A minimum of one layer of No. 15 asphalt felt, free from holes and breaks, complying with ASTM D 226 or other approved water-resistive barrier, shall be applied over studs or sheathing of all exterior walls. The water-resistive barrier shall be applied horizontally, with the upper layer lapped over the lower layer not less than 2 inches. Where joints occur, the water-resistive barrier shall be lapped not less than 6 inches.",
      supplement_argument:
        "The house wrap corner rule (R703.1 + R703.2) is the MOST IMPORTANT siding supplement argument. Water-resistive barrier must be CONTINUOUS — it physically cannot terminate at a corner post. If siding is replaced on one elevation, the existing WRB on adjacent elevations is compromised at the corner and must be re-lapped. Re-lapping requires removing adjacent siding. Therefore, partial-elevation siding replacement is not code-compliant. The only code-compliant scope is all four elevations.",
      manufacturer_specs: [],
      has_warranty_void: false,
      jurisdiction: "Binghamton, NY (RCNYS 2020)",
    },
    irc_code: "RCNYS R703.1 / R703.2",
    supplement_argument:
      "House wrap corner rule: WRB must be continuous, cannot terminate at corners. Forces all-4-elevation replacement.",
    carrier_trick: "left_elevation_only",
    trick_flag: "critical",
    qty_variance: "+2,353 SF (all 4 elevations vs 1)",
    price_variance: "+$1.29/SF (.024\" vs .014\" gauge)",
    unit_mismatch: "",
    category: "material",
    trade: "siding",
  },
  {
    checklist_desc: "House wrap / WRB (RCNYS R703.2)",
    usarm_desc: "R&R House wrap (air/moisture barrier)",
    usarm_amount: 1980.16, // 3094 SF × $0.64
    ev_qty: 3094,
    ev_unit: "SF",
    ev_formula: "total_wall_area_sf",
    xact_code: "SDG HWRP",
    xact_unit_price: 0.64,
    carrier_desc: "R&R House wrap - LEFT ELEVATION ONLY (741 SF)",
    carrier_amount: 480.17,
    carrier_qty: 741,
    carrier_unit: "SF",
    carrier_unit_price: 0.65,
    carrier_notes:
      "House wrap must be continuous per RCNYS R703.2 — cannot terminate at corner post.",
    matched_by: "description",
    status: "under",
    note: "This is the code argument that won the whole claim. House wrap is a continuous weather-resistive barrier — partial replacement violates R703.2.",
    code_citation: {
      code_tag: "RCNYS",
      section: "R703.2",
      title: "Water-resistive barrier (continuous coverage)",
      requirement: "See row above — same code citation drove the full siding expansion.",
      supplement_argument:
        "House wrap is a SYSTEM, not a siding accessory. The system functions only when continuous around the entire structure. Once breached at a corner, water intrusion risk propagates to adjacent walls. Code-compliant repair mandates full replacement.",
      manufacturer_specs: [],
      has_warranty_void: false,
      jurisdiction: "Binghamton, NY (RCNYS 2020)",
    },
    irc_code: "RCNYS R703.2",
    supplement_argument: "Continuous WRB requirement — no partial replacement allowed.",
    carrier_trick: "code_continuity_ignored",
    trick_flag: "critical",
    qty_variance: "+2,353 SF",
    price_variance: "",
    unit_mismatch: "",
    category: "underlayment",
    trade: "siding",
  },
  {
    checklist_desc: "Fanfold insulation board — all elevations",
    usarm_desc: "R&R Fanfold insulation board",
    usarm_amount: 2475.2, // 3094 SF × ~$0.80
    ev_qty: 3094,
    ev_unit: "SF",
    ev_formula: "total_wall_area_sf",
    xact_code: "SDG FANFD",
    xact_unit_price: 0.8,
    carrier_desc: "",
    carrier_amount: 0,
    carrier_qty: 0,
    carrier_unit: "",
    carrier_unit_price: 0,
    carrier_notes: "",
    matched_by: "missing",
    status: "missing",
    note: "Fanfold is installed between the house wrap and the siding panels. If the house wrap is replaced, the fanfold behind it is destroyed and must be replaced.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "Fanfold insulation board is installed as part of the siding system. Removing siding and WRB necessarily destroys the fanfold. Carrier omitted this entirely despite scoping the underlying siding/WRB replacement.",
    carrier_trick: "system_component_omission",
    trick_flag: "high",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "underlayment",
    trade: "siding",
  },
  {
    checklist_desc: "Aluminum window wraps",
    usarm_desc: "R&R Aluminum window wraps (all windows)",
    usarm_amount: 1650.0,
    ev_qty: 10,
    ev_unit: "EA",
    ev_formula: "window_count",
    xact_code: "SDG WWRP",
    xact_unit_price: 165.0,
    carrier_desc: "",
    carrier_amount: 0,
    carrier_qty: 0,
    carrier_unit: "",
    carrier_unit_price: 0,
    carrier_notes: "",
    matched_by: "missing",
    status: "missing",
    note: "When aluminum siding is removed from around a window, the existing window wrap/capping is cut and damaged. Must be replaced with new aluminum-trim cappings.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "Window wraps are a labor-intensive finishing item that's destroyed when adjacent siding is removed. Carrier omitted this line item entirely — industry standard includes window capping on any full-elevation R&R.",
    carrier_trick: "labor_omission",
    trick_flag: "medium",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "trim",
    trade: "siding",
  },

  // ─── Detached garage — was DENIED entirely ───────────────────────────────
  {
    checklist_desc: "Garage aluminum corrugated roofing",
    usarm_desc: "R&R Aluminum corrugated panel roofing - garage",
    usarm_amount: 2850.0,
    ev_qty: 380,
    ev_unit: "SF",
    ev_formula: "garage_roof_area_sf",
    xact_code: "RFG ALUMC",
    xact_unit_price: 7.5,
    carrier_desc: "",
    carrier_amount: 0,
    carrier_qty: 0,
    carrier_unit: "",
    carrier_unit_price: 0,
    carrier_notes: "Carrier DENIED the detached garage roof entirely",
    matched_by: "missing",
    status: "missing",
    note: "Photos showed hail denting on corrugated panels + ridge cap damage. Carrier originally denied; USARM provided photo proof and carrier acknowledged in revision.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "Hail damage to detached garage roofing was documented in photos (dent pattern consistent with main house). Carrier's denial had no photographic basis — once proof was surfaced, carrier reversed.",
    carrier_trick: "outright_denial",
    trick_flag: "high",
    qty_variance: "",
    price_variance: "",
    unit_mismatch: "",
    category: "material",
    trade: "detached metal roof",
  },

  // ─── Gutters — scoped partially ──────────────────────────────────────────
  {
    checklist_desc: "Gutters + downspouts — all elevations",
    usarm_desc: "R&R Gutter/downspout - aluminum up to 5\"",
    usarm_amount: 5883.05, // 485 LF × $12.13
    ev_qty: 485,
    ev_unit: "LF",
    ev_formula: "eave_lf × 1.6",
    xact_code: "SDG GTRS",
    xact_unit_price: 12.13,
    carrier_desc: "R&R Gutters (front/right/rear/left) + downspouts LEFT ONLY",
    carrier_amount: 2511.02,
    carrier_qty: 192,
    carrier_unit: "LF",
    carrier_unit_price: 13.08,
    carrier_notes:
      "Gutters scoped by individual elevation (underscoped total). Downspouts scoped on LEFT elevation only.",
    matched_by: "description",
    status: "under",
    note: "Carrier scoped downspouts on left elevation only despite expanding gutters to all 4. Downspouts follow the gutter system — cannot replace gutters without replacing downspouts.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "Gutter formula: eave LF × 1.6 captures both gutters AND downspouts. Carrier fragmented the line items to hide undercoverage.",
    carrier_trick: "fragmented_line_items",
    trick_flag: "medium",
    qty_variance: "+293 LF",
    price_variance: "",
    unit_mismatch: "",
    category: "material",
    trade: "gutters",
  },

  // ─── Dumpster — undersized ───────────────────────────────────────────────
  {
    checklist_desc: "Dumpster load — full roof + siding tear-off",
    usarm_desc: "Dumpster load",
    usarm_amount: 850.0,
    ev_qty: 1,
    ev_unit: "EA",
    ev_formula: "based on scope volume",
    xact_code: "DMO DUMPS",
    xact_unit_price: 850.0,
    carrier_desc: "Dumpster load - 12 yards",
    carrier_amount: 532.46,
    carrier_qty: 1,
    carrier_unit: "EA",
    carrier_unit_price: 532.46,
    carrier_notes: "12-yard dumpster insufficient for full roof + siding + garage tear-off",
    matched_by: "description",
    status: "under",
    note: "Full roof + all-4-elevation siding + detached garage roof debris exceeds 12-yard capacity. Industry standard for this scope is 20-yard minimum.",
    code_citation: null,
    irc_code: "",
    supplement_argument:
      "Debris calculation: 19.09 SQ roof shingles + 3,094 SF siding + 380 SF garage roof + fanfold + gutters + window wraps ≈ 18-22 cubic yards. 12-yard dumpster forces 2+ loads or pickup overflow, neither of which is standard industry practice.",
    carrier_trick: "undersized_dumpster",
    trick_flag: "low",
    qty_variance: "",
    price_variance: "+$317.54",
    unit_mismatch: "",
    category: "disposal",
    trade: "roofing",
  },
];

/* ----------------------------------------------------------------------------
 * Carrier line items (for reference on the Carrier Scope tab)
 * ------------------------------------------------------------------------- */

export const SAMPLE_CARRIER_LINE_ITEMS: CarrierLineItem[] = [
  { item: "Tear off laminated comp shingles", carrier_desc: "Tear off, haul and dispose of comp shingles - Laminated (17.58 SQ)", qty: 17.58, unit: "SQ", unit_price: 80.73, carrier_amount: 1419.24, xact_code: "RFG 240R", notes: "Area understated" },
  { item: "Laminated shingles - ITEL ASP", carrier_desc: "Laminated comp shingle rfg - ITEL ASP @ $333.37/SQ (20.00 SQ)", qty: 20, unit: "SQ", unit_price: 333.37, carrier_amount: 7200.79, xact_code: "RFG 300S", notes: "ITEL pricing used instead of standard Xactimate catalog" },
  { item: "Ice & water barrier", carrier_desc: "Ice & water barrier (1,207.64 SF)", qty: 1207.64, unit: "SF", unit_price: 2.54, carrier_amount: 3064.99, xact_code: "RFG IWS", notes: "Underscoped by 751 SF — only 1 course at eaves" },
  { item: "Starter course", carrier_desc: "Asphalt starter - universal starter course (230.35 LF)", qty: 230.35, unit: "LF", unit_price: 2.75, carrier_amount: 634.38, xact_code: "RFG STARTR", notes: "Underscoped by 73 LF vs EagleView eaves" },
  { item: "Drip edge", carrier_desc: "Drip edge (245.51 LF)", qty: 245.51, unit: "LF", unit_price: 4.18, carrier_amount: 1026.13, xact_code: "RFG DRIP", notes: "Missing rake edges" },
  { item: "Ridge cap", carrier_desc: "R&R Hip/Ridge cap - Standard profile (187.36 LF)", qty: 187.36, unit: "LF", unit_price: 13.25, carrier_amount: 2482.81, xact_code: "RFG RIDGC", notes: "Underscoped by 24 LF" },
  { item: "Siding left elevation only", carrier_desc: "R&R Siding - .014\" metal - LEFT ELEVATION ONLY (741 SF)", qty: 741, unit: "SF", unit_price: 11.18, carrier_amount: 8282.89, xact_code: "SDG ALUMS", notes: "MAJOR: only 24% of total siding scoped, .014\" thin gauge pricing" },
  { item: "House wrap left elevation only", carrier_desc: "R&R House wrap - LEFT ELEVATION ONLY (741 SF)", qty: 741, unit: "SF", unit_price: 0.65, carrier_amount: 480.17, xact_code: "SDG HWRP", notes: "Violates RCNYS R703.2 continuity requirement" },
  { item: "Dumpster", carrier_desc: "Dumpster load - 12 yards (1 EA)", qty: 1, unit: "EA", unit_price: 532.46, carrier_amount: 532.46, xact_code: "DMO DUMPS", notes: "Undersized for scope" },
];

/* ----------------------------------------------------------------------------
 * Financials — REAL numbers from the won claim
 * ------------------------------------------------------------------------- */

export const SAMPLE_FINANCIALS: ScopeComparisonFinancials = {
  carrier_rcv: 37668.97, // First scope — what State Farm originally offered
  contractor_rcv: 80962.89, // Won scope — what USARM recovered after supplement
  variance: 43293.92, // +$43,293.92 — the win
  deductible: 2112.0,
  tax_rate: 0.08,
  o_and_p: 0.21,
  o_and_p_enabled: true, // 7 trades — O&P enabled
  supplement_opportunity: 43293.92,
};

export const SAMPLE_SUMMARY: ScopeComparisonSummary = {
  total_items: SAMPLE_COMPARISON_ROWS.length,
  missing_count: SAMPLE_COMPARISON_ROWS.filter((r) => r.status === "missing").length,
  under_count: SAMPLE_COMPARISON_ROWS.filter((r) => r.status === "under").length,
  match_count: SAMPLE_COMPARISON_ROWS.filter((r) => r.status === "match").length,
  carrier_only_count: 0,
  tricks_detected: [
    "left_elevation_only",
    "code_continuity_ignored",
    "area_understatement",
    "code_short_width",
    "code_partial_coverage",
    "system_component_omission",
    "outright_denial",
    "fragmented_line_items",
  ],
};

export const SAMPLE_SCOPE_COMPARISON: ScopeComparisonResponse = {
  comparison_rows: SAMPLE_COMPARISON_ROWS,
  carrier_line_items: SAMPLE_CARRIER_LINE_ITEMS,
  financials: SAMPLE_FINANCIALS,
  summary: SAMPLE_SUMMARY,
};

/* ----------------------------------------------------------------------------
 * Richard chat context — preloaded into the Claude prompt
 * ------------------------------------------------------------------------- */

export const SAMPLE_RICHARD_CONTEXT = `You are Richard, the AI claim brain for dumbroof.ai. You are running in DEMO MODE against a REAL CLOSED CLAIM that USARM (the company that built dumbroof.ai) won. The user is evaluating dumbroof.ai before signing up — be helpful, confident, and show them what you actually do.

REAL CLAIM CONTEXT (21 McNamara Ave, Binghamton NY, roof + siding hail/wind claim):
  Carrier: ${SAMPLE_CLAIM_META.carrier}
  Date of Loss: ${SAMPLE_CLAIM_META.date_of_loss}
  Jurisdiction: Binghamton, NY (RCNYS 2020 governs)
  Roof: ${SAMPLE_CLAIM_META.squares} squares of ${SAMPLE_CLAIM_META.roof_material}
  Siding: ${SAMPLE_CLAIM_META.siding_sf} SF aluminum (.024" standard gauge)
  Photos: ${SAMPLE_CLAIM_META.photo_count} annotated inspection photos

THE WIN:
  First carrier scope: $${SAMPLE_CLAIM_META.first_scope_rcv.toLocaleString()}
  Final settlement:    $${SAMPLE_CLAIM_META.won_scope_rcv.toLocaleString()}
  Recovered:           +$${SAMPLE_CLAIM_META.win_delta.toLocaleString()} (+115%)

THE PRIMARY WINNING ARGUMENT — this is THE story of this claim:
  Carrier originally scoped siding LEFT ELEVATION ONLY (741 SF — 24% of total).
  dumbroof.ai flagged this using RCNYS R703.1 + R703.2 (house wrap corner rule):
    - R703.2 requires a continuous water-resistive barrier behind siding.
    - The WRB must lap at corners — it CANNOT physically terminate at a corner post.
    - If siding is replaced on one elevation, the adjacent WRB is breached at the corner.
    - Repairing the breach requires pulling the adjacent siding.
    - Therefore: partial-elevation siding replacement violates code. The only
      code-compliant scope is full-envelope replacement (all 4 elevations).
  Carrier acknowledged: expanded from 741 SF → 3,078 SF (all 4 elevations).
  This single argument drove ~$30,000 of the $43,294 recovered.

OTHER ARGUMENTS THAT WORKED:
  1. Garage aluminum corrugated roofing: carrier originally DENIED. Photo evidence
     of hail denting on panels + ridge cap forced acknowledgment.
  2. Full gutter + downspout replacement: carrier fragmented gutter line items
     by elevation + scoped downspouts LEFT ONLY. Formula (eave LF × 1.6) + code
     continuity expanded to all elevations.
  3. Fanfold insulation board + window wraps: secondary line items destroyed
     when siding is removed. Industry standard includes these on full R&R.
  4. Ice & water barrier undersized per RCNYS R905.1.2: carrier used 1 course at
     eaves (1,207 SF). Code requires 2 courses (24 inches inside wall line) =
     1,959 SF. Added 751 SF.

CARRIER TRICKS DETECTED (the types dumbroof.ai catches automatically):
  - left_elevation_only (biggest)
  - code_continuity_ignored (house wrap corner rule)
  - area_understatement (17.58 SQ vs 19.09 SQ EagleView measurement)
  - code_short_width (ice barrier 1 course vs required 2)
  - code_partial_coverage (drip edge eaves only, no rakes)
  - system_component_omission (fanfold, window wraps)
  - outright_denial (garage roof)
  - fragmented_line_items (gutters scoped by elevation to hide undercoverage)

WHAT DUMBROOF.AI PRODUCED FOR THIS CLAIM (5 documents generated in ~5 minutes):
  1. Forensic Causation Report (47 annotated photos, hail strike patterns)
  2. Xactimate-style Estimate ($80,962.89 RCV with full line items)
  3. Scope Comparison Report (carrier first scope vs USARM, delta breakdown)
  4. Scope Clarification Letter (code-cited legal framing of each gap)
  5. Cover Email (carrier-ready supplement request)

YOUR TONE:
  - Terse, technical, confident. Roofer-to-roofer or roofer-to-contractor.
  - Lead with the specific code citation or photo evidence behind every recommendation.
  - Never use public adjuster advocacy language ("demand", "appeal"). This is a
    contractor demo — contractors can't advocate under UPPA. Use neutral technical
    language like "code-compliant installation requires" or "industry standard".

YOU ARE A COMMAND-DRIVEN ASSISTANT — show off what you can do:
  In production, the user can give you these kinds of commands and you actually
  execute them via tool calls. In DEMO MODE you can't actually execute, but you
  SHOULD describe in detail what you would do, including drafting the actual
  output. This is your most important job in the demo: prove that you're not
  just a Q&A bot — you're an action-taking agent.

  When user says "Email this supplement to the adjuster":
    Draft the actual email body in your response. Include subject line, all
    line items with amounts, code citations, photo references, recipient.
    End with "(In the real product, I'd send this directly via your connected
    Gmail. Sign up to enable.)"

  When user says "Send the homeowner a Certificate of Completion":
    Draft the COC text with date, scope summary, contractor signature line,
    homeowner signature line. Use realistic fields. End with "(In the real
    product, I'd generate the PDF and send it for e-signature.)"

  When user says "Where else should I take photos of?":
    List 5-10 specific spots based on the scope: garage corner where alum
    panels meet, southwest corner soffit, front gutter return where downspout
    elbow connects, etc. Be specific to the actual claim. End with "(In the
    real product, I'd open your phone's camera in-app and walk you through
    each shot.)"

  When user says "Draft a denial response":
    Write the actual response with code citations and photo evidence. End
    with the "real product would send this" tag.

After demonstrating 2-3 commands, gently steer toward "ready to do this with
your own claim? 3 free, no credit card."

DO NOT:
  - Claim to have access to the user's real data (they haven't uploaded anything)
  - Pretend to actually execute tool calls (always tag drafts as "demo mode")
  - Reveal the homeowner name, adjuster name, or real claim number
  - Use public adjuster advocacy language
`;

/* Suggested commands shown as chips in the demo chat — these mirror the
 * real tool calls that the production Richard makes (email composer,
 * COC sender, photo recommendations). Demo Richard describes what it
 * would do without actually executing. */
export const SAMPLE_RICHARD_SUGGESTIONS = [
  "Email this supplement to the adjuster",
  "Send the homeowner a Certificate of Completion",
  "Where else should I take photos of?",
  "Draft a denial response for the garage roof",
];

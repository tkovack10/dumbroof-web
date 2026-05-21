# Retail Estimate Templates

Manufacturer-system templates for **retail** (cash) roofing jobs. Separate from
the Xactimate/insurance pricing in the parent directory — retail uses the
contractor's own pricing, not carrier-dictated unit rates.

## Templates currently shipped

| Template | Manufacturer | Product Line | Class / Distinctive Feature | Base Price |
|---|---|---|---|---|
| `owens-corning-trudefinition-duration.json` | Owens Corning | TruDefinition Duration | Standard laminate, StreakGuard algae | $700/SQ all-in |
| `gaf-timberline-hdz.json` | GAF | Timberline HDZ (legacy: HD) | LayerLock + WindProven (∞ mph) | $700/SQ all-in |
| `certainteed-landmark.json` | CertainTeed | Landmark | Standard laminate, StreakFighter algae | $700/SQ all-in |
| `atlas-stormmaster-shake.json` | Atlas Roofing | StormMaster Shake | **Class 4 impact-resistant** (insurance discount eligible) | $700/SQ all-in |
| `malarkey-vista.json` | Malarkey | Vista | NEX polymer-modified + 3M Smog-Reducing Granules | $700/SQ all-in |

## Pricing model — $700/SQ ALL-IN

The headline number is `$700 × roof_area_sq` — **waste included**, complete
system installed. There is exactly ONE line item that bills (the shingle
line). The other ~13 line items show what's bundled in the base price
(`unit_price: 0`, `bundled_in_base: true`) for customer-facing transparency
on the estimate/contract.

**What's in the $700/SQ:**
- Tear-off (1 layer composition shingles)
- Synthetic underlayment (manufacturer's brand)
- Ice & water shield at eaves, valleys, penetrations
- Drip edge (eaves + rakes)
- Starter strip (manufacturer's brand)
- Field shingles + all material waste (~10%)
- Hip & ridge cap (manufacturer's brand)
- Continuous ridge vent (manufacturer's brand)
- Standard pipe boots (1.5–3")
- New step flashing at walls
- Counter flashing (chimneys, parapets)
- Building permit + inspection fees
- Dumpster + magnetic nail sweep
- Manufacturer system warranty (highest tier offered)
- 10-year contractor workmanship warranty

**Add-ons (priced separately, in each template's `add_ons` array):**
- Decking replacement — $110 / 4×8 sheet (allowance)
- 2nd+ tear-off layer — $85/SQ each
- Cedar shake tear-off — $125/SQ (substitutes for comp tear-off)
- Lead pipe flashing — $60/EA upgrade
- Chimney flashing kit (full counter reset) — $450/EA
- Chimney cricket — $650/EA (code-req for chimneys >30")
- Skylight flashing kit — $350/EA
- Shingle-line upgrades (per template — Landmark Premium, Vista Cool, etc.)

## File shape

Each template has these top-level keys:

- `_meta` — manufacturer, product, warranty system, **documents** (manufacturer spec sheets), pricing model
- `items` — ordered line-item array (everything in the bundle). Each item:
  - `line` — display order
  - `category` — `tear_off | underlayment | ice_water_shield | drip_edge | starter | shingles | hip_ridge | ventilation | flashing_pipe | flashing_step | flashing_counter | permit | cleanup | labor_workmanship`
  - `code` — internal routing code (manufacturer-prefixed for branded items, `RFG_` for generic)
  - `description` — full customer-facing description
  - `unit` — SQ | LF | EA | LS (lump sum) | SF
  - `unit_price` — USD (only the shingle line is non-zero)
  - `quantity_formula` — expression in measurement variables (see below)
  - `bundled_in_base` — true means it's included in the $700/SQ bundle
  - `is_billing_line` — true ONLY on the shingle line (the one that bills)
- `add_ons` — items NOT included in the bundle, priced separately
- `warranty_disclosure` — disclosure paragraph for customer contract

## Manufacturer documents

Every template's `_meta.documents` array links to the manufacturer's
canonical spec sheet PDFs (hosted on the manufacturer's site, not
re-distributed). When generating customer quotes, attach these as supporting
documents so the homeowner can verify the product spec.

## Quantity formula variables

Templates reference these measurement variables (surfaced by the parser
from EagleView / HOVER / GAF QuickMeasure / Hover reports):

| Variable | Description |
|---|---|
| `roof_area_sq` | Total roof area in squares (1 SQ = 100 SF) |
| `eave_lf` | Total eave linear feet |
| `rake_lf` | Total rake linear feet |
| `ridge_lf` | Total ridge linear feet |
| `hip_lf` | Total hip linear feet |
| `valley_lf` | Total valley linear feet |
| `ridge_lf_vented` | Ridge LF where vent is installed (≤ ridge_lf) |
| `pipe_count_standard` | Count of standard 1.5–3" pipe penetrations |
| `step_flash_lf` | LF of wall-to-roof step flashing required |
| `counter_flash_lf` | LF of counter flashing required (chimneys, parapets) |
| `bad_decking_sheets` | Estimated # of 4x8 sheets needing replacement (allowance, add-on only) |

## Adding a new template

1. Copy the closest existing template
2. Update `_meta` (manufacturer, product line, warranty system, documents)
3. Replace branded line-item codes with new manufacturer's prefix (e.g. `GAF_*` → `IKO_*`)
4. Update the shingle line's `code`, `description`, and (if Tom directs) `unit_price`
5. Update `warranty_disclosure` for the new system's requirements
6. Add a row to this README's "Templates currently shipped" table

## Warranty notes

All 5 templates default to the **highest-tier** manufacturer system warranty:

| Manufacturer | Warranty | Workmanship Tier |
|---|---|---|
| Owens Corning | Platinum Protection Limited | 10-yr included |
| GAF | Golden Pledge (or System Plus) | 50-yr if Master Elite, else 10-yr |
| CertainTeed | SureStart PLUS | 25-yr if Integrity Roof System cert |
| Atlas | Signature Select | 15-yr if Pro Plus Signature |
| Malarkey | Platinum Pledge | 25-yr if Emerald Pro/Diamond |

All require complete-system install of the manufacturer's accessories —
which IS the bundle in `$700/SQ`. Substituting non-system components voids
the system warranty and drops to shingle-only limited tier.

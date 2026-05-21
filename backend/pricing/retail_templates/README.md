# Retail Estimate Templates

Manufacturer-system templates for **retail** (cash) roofing jobs. Separate from
the Xactimate/insurance pricing in the parent directory — retail uses the
contractor's own pricing, not carrier-dictated unit rates.

## Templates currently shipped

| Template | Manufacturer | Product Line | Base Shingle Price |
|---|---|---|---|
| `owens-corning-trudefinition-duration.json` | Owens Corning | TruDefinition Duration | $700/SQ |
| `gaf-timberline-hdz.json` | GAF | Timberline HDZ (legacy alias: HD) | $700/SQ |

## File shape

Each template has two top-level keys:

- `_meta` — manufacturer, product line, warranty system, base price, notes
- `items` — ordered line-item array. Each item has:
  - `line` — display order
  - `category` — grouping (`tear_off`, `decking`, `underlayment`, `ice_water_shield`, `drip_edge`, `starter`, `shingles`, `hip_ridge`, `ventilation`, `flashing_pipe`, `flashing_step`, `flashing_counter`, `labor_workmanship`, `permit`, `cleanup`)
  - `code` — internal code for routing in estimator
  - `description` — full customer-facing description
  - `unit` — SQ | LF | EA | LS (lump sum) | SF
  - `unit_price` — current retail price in USD
  - `quantity_formula` — expression in terms of measurement variables
  - `notes` — context for the estimator (warranty implications, substitutions, code refs)

Plus optional:
- `warranty_disclosure` — disclosure paragraph for customer contract
- `suggested_substitutions` — alternate components keyed by category

## Quantity formula variables

Templates reference these measurement variables (surfaced by EagleView /
HOVER / GAF QuickMeasure / Hover parsers):

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
| `bad_decking_sheets` | Estimated # of 4x8 sheets needing replacement (allowance) |

## Base price logic

The $700/SQ base applies to the **shingle line only** (line 7 in each
template). Accessories and labor for other categories are **additive** —
they roll up into the customer-facing total but aren't bundled into the
per-SQ headline number.

This matches retail industry pricing convention where contractors quote a
"per-square price" but accessories, decking, permits, etc. are line-itemed
separately so the customer can see exactly what they're paying for.

## Substitution pattern

Each template's `suggested_substitutions` lets the estimator swap a
component for a budget or premium alternative while preserving the system
warranty eligibility. The substitution notes call out warranty implications.

## Adding a new template

1. Copy one of the existing files
2. Update `_meta` (manufacturer, product line, base price, warranty system)
3. Override line-item unit prices where the new manufacturer's accessories
   differ from the generic RFG_ codes
4. Document any non-RFG codes in the line-item `code` field as `{MFR}_{PRODUCT_ABBREV}`
5. Update `warranty_disclosure` for the new system's requirements
6. Add a row to this README's "Templates currently shipped" table
7. (Future) Register the template in `retail_templates.ts` index file

## Warranty notes

Both templates currently target the **highest-tier** manufacturer system
warranty (OC Platinum Protection / GAF Golden Pledge). To activate, ALL
required components must be from that manufacturer — substituting any
non-system component drops the warranty to the shingle-only limited tier.
Templates default to system-tier accessories so customers get the strongest
warranty by default.

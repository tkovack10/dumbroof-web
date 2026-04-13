# Xactimate Price List Export — Missing Items for Alfonso

> **Generated:** 2026-03-30
> **Current coverage:** 92 items across 35 markets (all mapped correctly)
> **Gap:** 44 items still using hardcoded national average prices instead of market-specific
> **Impact:** Every claim using these items gets the SAME price regardless of location

---

## HOW THIS WORKS

Alfonso exports Xactimate price lists as PDFs (one per market area). Our parser
reads the prices and stores them in `all-markets.json`. When a claim comes in at
"48 Fowler Ave, Johnson City, NY 13790", the system resolves that to market
**NYBI8X** (Binghamton) and pulls all 92 prices for that market.

**The problem:** The 44 items below weren't in Alfonso's original export. They
use hardcoded national average prices — so a claim in NYC gets the same price
as a claim in rural PA. This is wrong.

---

## ITEMS NEEDED (search these exact names in Xactimate)

### ROOFING — Steep/High Charges (6 items)
These are the surcharges for working on steep or multi-story roofs.

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Additional charge for steep roof - 7/12-9/12 pitch - tear off | SQ | $18.00 |
| Additional charge for steep roof - 7/12-9/12 pitch - install | SQ | $64.07 |
| Additional charge for steep roof - 10/12-12/12 pitch - tear off | SQ | $28.29 |
| Additional charge for steep roof - 10/12-12/12 pitch - install | SQ | $100.73 |
| Additional charge for steep roof - greater than 12/12 pitch - tear off | SQ | $36.24 |
| Additional charge for steep roof - greater than 12/12 pitch - install | SQ | $131.43 |

### ROOFING — High Roof Charges (2 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Additional charge for high roof (2 stories or greater) - tear off | SQ | $7.31 |
| Additional charge for high roof (2 stories or greater) - install | SQ | $30.44 |

### ROOFING — Underlayment / Barrier (3 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| R&R Continuous ridge vent - shingle-over style | LF | $8.50 |
| Counterflashing - Apron flashing | LF | $9.50 |
| R&R Exhaust vent - roof mounted | EA | $125.00 |

### ROOFING — Copper Items (3 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Step flashing - copper | LF | $22.00 |
| Counterflashing - copper | LF | $28.00 |
| R&R Drip edge - copper | LF | $18.50 |

### ROOFING — Metal Roofing (4 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Remove Metal roofing - standing seam | SQ | $150.00 |
| Metal roofing - standing seam | SQ | $850.00 |
| R&R Ridge cap - metal | LF | $22.00 |
| Remove metal roofing underlayment | SQ | $38.00 |

### ROOFING — Tile Roofing (4 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Remove Concrete/clay tile roofing | SQ | $200.00 |
| Concrete/clay tile roofing | SQ | $900.00 |
| R&R Ridge cap - tile | LF | $28.00 |
| Tile roofing underlayment | SQ | $22.00 |

### ROOFING — Flat/Modified Bitumen (3 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Remove Modified bitumen/flat roofing | SQ | $95.00 |
| Modified bitumen roofing - 2 ply torch applied | SQ | $425.00 |
| Underlayment - base sheet (flat roof) | SQ | $38.00 |

### ROOFING — Chimney / Specialty (2 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| R&R Chimney flashing - copper - average (32" x 36") | EA | $840.00 |
| Copper nails & hooks for slate installation | SQ | $45.00 |

### SIDING (5 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| R&R Siding - vinyl | SF | $7.55 |
| R&R Siding - vinyl - High grade | SF | $7.83 |
| R&R Siding - .019" metal (aluminum/steel) | SF | $12.20 |
| House wrap / Weather resistive barrier (WRB) | SF | $0.64 |
| R&R Wrap wood door frame & trim with aluminum sheet | LF | $27.51 |

### GENERAL / LABOR (8 items)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| Dumpster load - Approx. 30 yards, 5-7 tons of debris | EA | $850.00 |
| Dumpster load - Approx. 40 yards, 7-10 tons of debris | EA | $950.00 |
| Roofer - per hour | HR | $194.00 |
| Equipment operator - per use | EA | $450.00 |
| Scaffolding setup and removal - per use | EA | $1,405.00 |
| Scaffolding - per week | WK | $1,405.00 |
| Siding - Labor Minimum | EA | $519.46 |
| Slate roofing - additional labor (specialist) | HR | $350.00 |

### GUTTERS (1 item)

| Xactimate Item Name | Unit | Current Fallback |
|---|---|---|
| R&R Gutter / downspout - half round - copper - up to 5" | LF | $55.00 |

---

## TOTAL: 44 items across all 35 markets

**Priority order for Alfonso:**
1. **Steep/high charges (8 items)** — affects EVERY multi-story or steep roof claim
2. **Siding items (5)** — vinyl siding + house wrap affect most siding claims
3. **General labor (8)** — dumpster, roofer labor, scaffolding on every claim
4. **Ridge vent + counter flashing (3)** — on most roofing claims
5. **Metal/tile/flat/copper (16)** — specialty roofing (lower volume but high dollar)
6. **Chimney copper + slate nails (2)** — rare but high value

**Format needed:** Same PDF export format Alfonso used for the original 92 items.
One PDF per market area. We parse them automatically.

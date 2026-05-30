"""
Building Code Compliance Report — Document #6 in the USARM appeal package.

Generates a PDF with:
1. Cover page with jurisdiction + manufacturer logos
2. Annotated 3D house rendering with code callouts
3. Code detail cards with manufacturer installation diagrams
4. Summary table of all applicable codes
"""

import os
import re
import html as _html
from compliance_svg import generate_house_svg, collect_annotations_from_config, CODE_TO_ZONE


def _h(text) -> str:
    """Escape text for safe HTML embedding."""
    return _html.escape(str(text) if text is not None else "")


def _money(val) -> str:
    """Format a number as US currency for the supplement table."""
    try:
        return f"${float(val):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _is_initial_scope(li: dict) -> bool:
    """WS-7 subset invariant: Doc 06's priced supplement is a FILTERED VIEW of
    Doc 02. Doc 02 (build_xactimate_estimate / compute_financials) renders only
    scope_timing=='initial' items, so the supplement MUST exclude
    install_supplement items or the subtotal could never equal the sum of the
    same line_items in Doc 02 (it would be additive — forbidden)."""
    return (li.get("scope_timing") or "initial") == "initial"


def _code_line_items(config: dict) -> list:
    """The exact subset the priced supplement isolates: every INITIAL line item
    that (a) carries a code_citation and (b) has qty>0. This is a SUBSET of Doc
    02 — never additive. Unit price is read OFF the frozen line item; we never
    re-resolve a price here (B.7 single-snapshot)."""
    out = []
    for li in config.get("line_items", []) or []:
        if not isinstance(li, dict):
            continue
        try:
            qty = float(li.get("qty", 0) or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if li.get("code_citation") and qty > 0 and _is_initial_scope(li):
            out.append(li)
    return out


def carrier_scope_present(config: dict) -> bool:
    """True when the claim has a carrier scope to cross-reference. Production
    stores the pre-matched comparison rows under carrier.carrier_line_items
    (see processor pre_match_scope_comparison); their presence is the canonical
    signal that a carrier scope was uploaded + parsed."""
    if not isinstance(config, dict):
        return False
    carrier = config.get("carrier", {}) or {}
    rows = carrier.get("carrier_line_items")
    return bool(rows) and isinstance(rows, list)


# ── WS-7 FIX 1 — carrier-vocabulary normalizer + matcher ──
#
# The carrier comparison rows (carrier.carrier_line_items[].usarm_desc) and the
# config line_items[].description come from DIFFERENT vocabularies — the carrier
# rows use Xactimate-export shorthand ("Ice & water barrier", "...rfg.",
# "R&R Drip edge") while our line items carry the fuller generator descriptions
# ("Ice & water barrier (2 courses eaves + 1 course valleys)",
# "...comp shingle roofing", "R&R Drip edge - aluminum"). An EXACT lowercased
# join matched only ~4 of 25 rows on fixture 74597c34; the other 21 SILENTLY
# defaulted to OMITTED — a CARRIER-FACING FALSEHOOD (it claimed the carrier
# omitted ice & water / laminated shingle / drip edge, all of which the carrier
# actually included).
#
# The scope_comparison engine's matcher (XactRegistry.pre_match_scope_comparison)
# is a 6-pass, registry-bound, EagleView-checklist-first intent matcher and is
# NOT cleanly reusable for a flat description↔description join here (it needs a
# live registry, measurements, carrier-triple aggregation). We DO reuse its
# proven _clean_desc normalizer as a baseline and layer the carrier-shorthand
# abbreviation expansions on top.

_CR_STOP_WORDS = frozenset({
    "and", "or", "the", "of", "for", "a", "an", "to", "in", "with", "without",
    "per", "approx", "approximately", "remove", "replace", "rr",
})

# Common Xactimate / carrier shorthand → canonical form. Order matters (apply
# multi-char tokens before '&').
_CR_ABBR_RES = [
    (re.compile(r"\bw/out\b|\bw/o\b"), " without "),
    (re.compile(r"\brfg\b\.?"), " roofing "),
    (re.compile(r"\bcomp\b\.?"), " comp "),
    (re.compile(r"\br&r\b"), " remove replace "),
    (re.compile(r"\bi&w\b"), " ice and water "),
    (re.compile(r"&"), " and "),
]


def _cr_normalize(desc: str) -> str:
    """Normalize a line-item / carrier description for cross-vocabulary matching:
    lowercase, drop ALL parentheticals "(…)", expand carrier shorthand
    (rfg.→roofing, w/out→without, &→and, r&r→remove replace, i&w→ice and water),
    drop remaining punctuation, collapse whitespace. Never raises."""
    if not desc:
        return ""
    s = str(desc).lower().strip()
    s = re.sub(r"\([^)]*\)", " ", s)          # drop any parentheticals
    for rgx, rep in _CR_ABBR_RES:
        s = rgx.sub(rep, s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)         # drop punctuation/symbols
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _cr_tokens(desc: str) -> set:
    """Significant (non-stopword, ≥2-char) tokens of a normalized description."""
    return {t for t in _cr_normalize(desc).split() if len(t) >= 2 and t not in _CR_STOP_WORDS}


def _cr_match(usarm_desc: str, candidates: list) -> dict | None:
    """Find the best carrier row matching a USARM line-item description.

    candidates: list of {"norm", "tokens", "row"} for every carrier comparison
    row that carries a usarm_desc. Match strategy (strongest → weakest):
      1. exact normalized equality
      2. normalized contains / startswith (either direction)
      3. significant-token overlap ≥ 0.6 of the smaller token set
    Returns the matched candidate dict, or None when nothing matches (caller
    must then render a NEUTRAL status — NEVER a default OMITTED)."""
    nu = _cr_normalize(usarm_desc)
    if not nu:
        return None
    tu = _cr_tokens(usarm_desc)

    # 1. exact
    for c in candidates:
        if c["norm"] == nu:
            return c
    # 2. contains / startswith (either direction)
    for c in candidates:
        nc = c["norm"]
        if nc and (nu in nc or nc in nu):
            return c
    # 3. token overlap
    best, best_ov = None, 0.0
    for c in candidates:
        tc = c["tokens"]
        if not tc or not tu:
            continue
        ov = len(tu & tc) / max(1, min(len(tu), len(tc)))
        if ov > best_ov:
            best, best_ov = c, ov
    if best is not None and best_ov >= 0.6:
        return best
    return None


def _carrier_candidates(config: dict) -> list:
    """Pre-normalize every carrier comparison row that carries a usarm_desc into
    {"norm", "tokens", "row"} for matching."""
    cands = []
    if not carrier_scope_present(config):
        return cands
    for row in config["carrier"]["carrier_line_items"]:
        if not isinstance(row, dict):
            continue
        desc = (row.get("usarm_desc") or row.get("checklist_desc") or "").strip()
        if not desc:
            continue
        cands.append({
            "norm": _cr_normalize(desc),
            "tokens": _cr_tokens(desc),
            "row": row,
        })
    return cands


def _row_is_omitted(row: dict) -> bool:
    """A matched carrier row indicates ABSENCE (the carrier did not include the
    item) when its comparison status is 'missing' OR its carrier_desc is empty /
    'NOT INCLUDED'. Otherwise the carrier DID include it (under/over/match)."""
    status = (row.get("status") or "").lower()
    carrier_desc = (row.get("carrier_desc") or "").strip().upper()
    return status == "missing" or carrier_desc in ("", "NOT INCLUDED")


def _carrier_status_for(usarm_desc: str, candidates: list) -> str | None:
    """WS-7 FIX 1: resolve a single USARM description against the carrier rows.

    Returns:
      'included' — positively matched a carrier row the carrier DID include,
      'omitted'  — positively matched a carrier row that indicates ABSENCE
                   (status missing / NOT INCLUDED),
      None       — NO positive match. The caller renders a NEUTRAL status and
                   MUST NOT claim the carrier omitted the item. This is the
                   credibility-critical half of the fix: we never assert an
                   omission we did not positively observe."""
    cand = _cr_match(usarm_desc, candidates)
    if cand is None:
        return None
    return "omitted" if _row_is_omitted(cand["row"]) else "included"


def _carrier_status_map(config: dict) -> dict:
    """Map a USARM line-item description → carrier coverage state, derived from
    the pre-matched carrier.carrier_line_items rows via the cross-vocabulary
    normalizer/matcher (WS-7 FIX 1). Keys are RAW lowercased descriptions; value
    is 'omitted' (positively matched + carrier indicates absence), 'included'
    (positively matched + carrier present), or absent from the map when NO
    positive match was found (caller renders NEUTRAL — never a default OMITTED).
    """
    out = {}
    if not carrier_scope_present(config):
        return out
    candidates = _carrier_candidates(config)
    # Resolve the DISTINCT descriptions present on the USARM code line items.
    descs = set()
    for li in config.get("line_items", []) or []:
        if isinstance(li, dict) and li.get("description"):
            descs.add(li["description"].strip())
    for desc in descs:
        state = _carrier_status_for(desc, candidates)
        if state is not None:
            out[desc.lower()] = state
    return out


def _ahj_header(config: dict) -> dict:
    """AHJ / code-edition header pulled from building_codes/state_codes.json:
    base_code (e.g. 'IRC 2021'), adopted_year, jurisdiction full name + prefix."""
    from building_codes import lookup as _bc
    state = (config.get("property", {}) or {}).get("state", "NY")
    row = _bc.get_state_codes(state)
    return {
        "jurisdiction": row.get("full_name", "International Residential Code"),
        "prefix": row.get("short_name") or row.get("prefix", "IRC"),
        "base_code": row.get("base_code", "IRC 2021"),
        "adopted_year": row.get("adopted_year", ""),
    }

# ── CSS ──

COMPLIANCE_CSS = """
@page { size: letter; margin: 0.5in 0.6in; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1a2e; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page-break { page-break-after: always; }
h1 { font-size: 26px; font-weight: 700; color: #0d2137; margin: 0 0 8px 0; }
h2 { font-size: 20px; font-weight: 700; color: #0d2137; margin: 30px 0 12px 0; border-bottom: 2px solid #c0392b; padding-bottom: 6px; }
h3 { font-size: 16px; font-weight: 600; color: #2c3e50; margin: 20px 0 8px 0; }

.cover-header { background: linear-gradient(135deg, #0d2137 0%, #1a3a5c 100%); color: white; padding: 40px 35px; border-radius: 8px; margin-bottom: 30px; }
.cover-header h1 { color: white; font-size: 30px; margin-bottom: 4px; }
.cover-header .subtitle { font-size: 16px; opacity: 0.9; margin-top: 6px; }
.cover-header .law-text { font-size: 13px; background: rgba(255,255,255,0.15); padding: 10px 15px; border-radius: 6px; margin-top: 18px; border-left: 4px solid #e74c3c; }

.property-block { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px 25px; margin: 20px 0; }
.property-block table { width: 100%; border-collapse: collapse; }
.property-block td { padding: 5px 10px; font-size: 13px; }
.property-block td:first-child { font-weight: 600; color: #5d6d7e; width: 160px; }

.rendering-section { text-align: center; margin: 10px 0; }
.rendering-title { font-size: 14px; color: #5d6d7e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }

.code-card { border: 1px solid #dee2e6; border-radius: 8px; padding: 18px 22px; margin: 16px 0; break-inside: avoid; background: #fafbfc; }
.code-card.critical { border-left: 5px solid #c0392b; background: #fdf8f8; }
.code-card .code-tag { font-size: 12px; font-weight: 700; color: #c0392b; text-transform: uppercase; letter-spacing: 0.5px; }
.code-card .code-title { font-size: 16px; font-weight: 600; color: #0d2137; margin: 4px 0 8px 0; }
.code-card .requirement { font-size: 13px; color: #2c3e50; background: #f0f4f8; padding: 10px 14px; border-radius: 6px; margin: 8px 0; border-left: 3px solid #2c3e50; }
.code-card .measurement { font-size: 13px; color: #1a5276; font-weight: 600; margin: 8px 0; }
.code-card .supplement { font-size: 12px; color: #5d6d7e; margin-top: 8px; }

.mfr-spec { background: #fff8e1; border: 1px solid #ffd54f; border-radius: 6px; padding: 10px 14px; margin: 8px 0; break-inside: avoid; }
.mfr-spec .mfr-name { font-weight: 700; font-size: 12px; color: #f57f17; }
.mfr-spec .warranty-void { color: #c0392b; font-weight: 600; font-size: 12px; margin-top: 4px; }

.diagram-box { border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; margin: 12px 0; break-inside: avoid; background: white; }
.diagram-box .diagram-title { font-size: 14px; font-weight: 600; color: #0d2137; margin-bottom: 10px; }
.diagram-correct { color: #27ae60; }
.diagram-incorrect { color: #c0392b; }

.summary-table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 12px; }
.summary-table th { background: #0d2137; color: white; padding: 10px 12px; text-align: left; font-weight: 600; }
.summary-table td { padding: 8px 12px; border-bottom: 1px solid #dee2e6; }
.summary-table tr:nth-child(even) { background: #f8f9fa; }
.status-missing { color: #c0392b; font-weight: 700; }
.status-included { color: #27ae60; font-weight: 600; }

.footer { text-align: center; font-size: 10px; color: #95a5a6; margin-top: 30px; padding-top: 10px; border-top: 1px solid #dee2e6; }

/* ── WS-7 priced code-compliance supplement ── */
.ahj-header { background: #0d2137; color: white; border-radius: 8px; padding: 14px 20px; margin: 18px 0 6px 0; }
.ahj-header .ahj-title { font-size: 13px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.85; }
.ahj-header .ahj-body { font-size: 15px; font-weight: 600; margin-top: 4px; }
.non-additive-banner { background: #fff8e1; border: 1px solid #ffd54f; border-left: 5px solid #f57f17; border-radius: 6px; padding: 12px 16px; margin: 12px 0 18px 0; font-size: 12px; color: #5d4037; }
.non-additive-banner b { color: #c0392b; }
.supplement-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
.supplement-table th { background: #0d2137; color: white; padding: 9px 8px; text-align: left; font-weight: 600; }
.supplement-table td { padding: 7px 8px; border-bottom: 1px solid #e3e8ee; vertical-align: top; }
.supplement-table td.num { text-align: right; white-space: nowrap; }
.supplement-table tr.trade-header td { background: #1a3a5c; color: white; font-weight: 700; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
.supplement-table tr.trade-subtotal td { background: #f0f4f8; font-weight: 700; border-top: 1.5px solid #0d2137; }
.supplement-table tr.grand-subtotal td { background: #0d2137; color: white; font-weight: 700; font-size: 13px; }
.carrier-omitted { color: #c0392b; font-weight: 700; }
.carrier-included { color: #27ae60; font-weight: 600; }
.req-only-notice { background: #eef2f7; border: 1px dashed #93a4b8; border-radius: 8px; padding: 16px 20px; margin: 18px 0; font-size: 13px; color: #2c3e50; }
.req-only-list { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.req-only-list th { background: #0d2137; color: white; padding: 9px 10px; text-align: left; font-weight: 600; }
.req-only-list td { padding: 7px 10px; border-bottom: 1px solid #e3e8ee; }
"""


def _get_jurisdiction(state: str) -> dict:
    """Get jurisdiction info for a state. Data-driven via building_codes/state_codes.json —
    add states by editing the JSON, not this function."""
    from building_codes import lookup as _bc_lookup
    return _bc_lookup.get_jurisdiction(state)


def _format_property_address(prop: dict) -> str:
    """WS-7 cosmetic fix — dedupe the property address. Production stores the
    FULL address (often with ', USA') in property.address, so naively appending
    city/state/zip produced e.g. '... Orlando, FL 32819, USA, ORLANDO, FL 32819'.
    When the address line already contains the city or zip, use it as-is;
    otherwise compose from the parts."""
    addr = (prop.get("address") or "").strip().rstrip(",").strip()
    # Drop a trailing ", USA" that the geocoder sometimes appends.
    addr = re.sub(r",?\s*USA\s*$", "", addr, flags=re.IGNORECASE).strip().rstrip(",").strip()
    city = (prop.get("city") or "").strip()
    state = (prop.get("state") or "").strip()
    zip_ = (prop.get("zip") or "").strip()
    addr_l = addr.lower()
    already_full = (city and city.lower() in addr_l) or (zip_ and zip_ in addr)
    if already_full or not addr:
        return addr or ", ".join(p for p in [city, f"{state} {zip_}".strip()] if p)
    tail = ", ".join(p for p in [city, f"{state} {zip_}".strip()] if p)
    return f"{addr}, {tail}" if tail else addr


def _build_cover_page(config: dict, jurisdiction: dict, annotation_count: int) -> str:
    """Build the cover page HTML."""
    prop = config.get("property", {})
    address = _h(_format_property_address(prop))
    claim_number = _h(config.get("carrier", {}).get("claim_number", ""))
    company = config.get("company", {})
    # Default kept neutral so a missing/empty company_name doesn't leak USARM
    # branding onto another contractor's PDF (E182).
    company_name = _h(company.get("name") or "Your Roofing Company")
    date_of_loss = _h(config.get("dates", {}).get("date_of_loss", ""))
    trades = _h(", ".join(config.get("scope", {}).get("trades") or ["Roofing"]))

    return f'''
    <div class="cover-header">
        <h1>BUILDING CODE COMPLIANCE REPORT</h1>
        <div class="subtitle">Jurisdiction-Specific Installation Requirements &amp; Manufacturer Specifications</div>
        <div class="law-text">
            Per <b>{jurisdiction["abbrev"]} R905.1</b>: "Roofing shall be applied in accordance with
            the <b>manufacturer's installation instructions</b>." Manufacturer instructions carry the
            <b>force of building code</b> — they are not optional upgrades.
        </div>
    </div>

    <div class="property-block">
        <table>
            <tr><td>Property:</td><td><b>{address}</b></td></tr>
            <tr><td>Claim Number:</td><td>{claim_number}</td></tr>
            <tr><td>Date of Loss:</td><td>{date_of_loss}</td></tr>
            <tr><td>Jurisdiction:</td><td><b>{jurisdiction["name"]}</b></td></tr>
            <tr><td>Trades Scoped:</td><td>{trades}</td></tr>
            <tr><td>Code Requirements:</td><td><b>{annotation_count} applicable codes identified</b></td></tr>
            <tr><td>Prepared by:</td><td>{company_name}</td></tr>
        </table>
    </div>
    '''


def _build_code_detail_cards(annotations: list[dict], config: dict) -> str:
    """Build individual code detail cards with manufacturer specs."""
    cards = []
    measurements = config.get("measurements", {})

    for ann in annotations:
        cc = ann.get("full_citation", {})
        is_critical = ann.get("is_critical", False)

        card_class = "code-card critical" if is_critical else "code-card"
        code_tag = _h(ann.get("code_tag", ""))
        title = _h(ann.get("title", ""))
        requirement = _h(cc.get("requirement", ""))
        supplement = _h(cc.get("supplement_argument", ""))
        meas = _h(ann.get("measurement", ""))

        card = f'''
        <div class="{card_class}">
            <div class="code-tag">{code_tag}</div>
            <div class="code-title">{title}</div>
            <div class="requirement">{requirement}</div>
            <div class="measurement">EagleView measurement: {meas}</div>
        '''

        # Manufacturer specs
        mfr_specs = cc.get("manufacturer_specs", [])
        for spec in mfr_specs[:3]:
            mfr_name = spec.get("manufacturer", "")
            doc_name = spec.get("document", "")
            mfr_req = spec.get("requirement", "")
            warranty = spec.get("warranty_text", "")
            is_void = spec.get("warranty_void", False)

            card += f'''
            <div class="mfr-spec">
                <div class="mfr-name">{mfr_name} — {doc_name}</div>
                <div style="font-size:12px; margin-top:4px;">{mfr_req}</div>
            '''
            if is_void and warranty:
                card += f'<div class="warranty-void">WARRANTY VOID: {warranty}</div>'
            card += '</div>'

        # Supplement argument
        if supplement:
            card += f'<div class="supplement"><b>Supplement argument:</b> {supplement}</div>'

        card += '</div>'
        cards.append(card)

    return "\n".join(cards)


def _build_installation_diagrams(annotations: list[dict], config: dict) -> str:
    """Build installation diagram sections for key code items."""
    diagrams = []

    # Determine which diagrams apply based on annotations
    zone_set = {a["zone"] for a in annotations}

    # Ice & Water Barrier diagram
    if "eave-front" in zone_set:
        eave_lf = config.get("measurements", {}).get("eave", 0)
        diagrams.append(f'''
        <div class="diagram-box">
            <div class="diagram-title">Ice &amp; Water Barrier — Correct Installation</div>
            <svg viewBox="0 0 600 180" width="100%" style="max-width:580px;" xmlns="http://www.w3.org/2000/svg">
                <defs><marker id="arr" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="#c0392b"/></marker></defs>
                <!-- Cross-section of eave -->
                <rect x="20" y="100" width="560" height="60" fill="#e8d5b0" stroke="#8b7355" stroke-width="1.5" rx="2"/>
                <text x="300" y="138" text-anchor="middle" font-size="11" fill="#8b7355" font-weight="600">ROOF DECK (Plywood/OSB)</text>
                <!-- I&W layer -->
                <rect x="20" y="80" width="350" height="18" fill="#4a90d9" opacity="0.7" stroke="#2c6fbb" stroke-width="1.5" rx="2"/>
                <text x="195" y="93" text-anchor="middle" font-size="10" fill="white" font-weight="700">ICE &amp; WATER BARRIER</text>
                <!-- Shingles on top -->
                <rect x="20" y="62" width="560" height="16" fill="#6b7b8d" stroke="#4a5568" stroke-width="1" rx="1"/>
                <text x="300" y="74" text-anchor="middle" font-size="9" fill="white">SHINGLES</text>
                <!-- Wall line -->
                <rect x="350" y="20" width="12" height="140" fill="#bdc3c7" stroke="#7f8c8d" stroke-width="1"/>
                <text x="380" y="90" font-size="10" fill="#7f8c8d">Interior Wall</text>
                <!-- Dimension arrow (single line with both markers) -->
                <line x1="20" y1="45" x2="375" y2="45" stroke="#c0392b" stroke-width="1.5" marker-start="url(#arr)" marker-end="url(#arr)"/>
                <text x="197" y="40" text-anchor="middle" font-size="11" fill="#c0392b" font-weight="700">24" past interior wall line</text>
                <!-- Eave edge label -->
                <text x="10" y="25" font-size="10" fill="#2c3e50" font-weight="600">Eave Edge ({eave_lf:.0f} LF)</text>
            </svg>
            <div style="font-size:12px; color:#5d6d7e; margin-top:8px;">
                <span class="diagram-correct">CORRECT:</span> I&amp;W extends from eave edge to minimum 24" past the interior face of the exterior wall.
                <span class="diagram-incorrect">COMMON ERROR:</span> Carrier omits I&amp;W entirely or limits to eave edge only.
            </div>
        </div>''')

    # House Wrap Corner Detail
    if "corner" in zone_set or "wall-front" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">House Wrap (WRB) — Corner Wrap Detail (DuPont Tyvek)</div>
            <svg viewBox="0 0 600 200" width="100%" style="max-width:580px;">
                <!-- Two walls meeting at corner -->
                <rect x="40" y="40" width="200" height="140" fill="#e4e8ed" stroke="#2c3e50" stroke-width="2"/>
                <rect x="240" y="40" width="150" height="140" fill="#ccd3dc" stroke="#2c3e50" stroke-width="2" transform="skewY(-10)"/>
                <text x="140" y="120" text-anchor="middle" font-size="11" fill="#5d6d7e">WALL A</text>
                <text x="330" y="100" text-anchor="middle" font-size="11" fill="#5d6d7e">WALL B</text>

                <!-- House wrap wrapping around corner (CORRECT) -->
                <rect x="30" y="35" width="222" height="150" fill="#2ecc71" opacity="0.2" stroke="#27ae60" stroke-width="2" stroke-dasharray="6,3" rx="3"/>
                <path d="M 252 35 L 252 185 L 300 155 L 300 15 Z" fill="#2ecc71" opacity="0.2" stroke="#27ae60" stroke-width="2" stroke-dasharray="6,3"/>

                <!-- 12" wrap indicator -->
                <line x1="252" y1="50" x2="300" y2="35" stroke="#c0392b" stroke-width="2"/>
                <text x="290" y="28" font-size="10" fill="#c0392b" font-weight="700">Min 12" wrap</text>

                <!-- Corner highlight -->
                <line x1="240" y1="38" x2="240" y2="182" stroke="#c0392b" stroke-width="4"/>
                <text x="240" y="196" text-anchor="middle" font-size="10" fill="#c0392b" font-weight="700">OUTSIDE CORNER</text>

                <!-- Labels -->
                <rect x="380" y="40" width="200" height="70" rx="4" fill="#f0f4f8" stroke="#2c3e50" stroke-width="1"/>
                <text x="390" y="60" font-size="11" fill="#27ae60" font-weight="700">CORRECT:</text>
                <text x="390" y="76" font-size="10" fill="#2c3e50">WRB wraps 12"+ around</text>
                <text x="390" y="90" font-size="10" fill="#2c3e50">corner UNDER corner post.</text>
                <text x="390" y="104" font-size="10" fill="#c0392b" font-weight="600">Requires adjacent wall</text>
                <text x="390" y="118" font-size="10" fill="#c0392b" font-weight="600">siding removal.</text>

                <rect x="380" y="125" width="200" height="55" rx="4" fill="#fdf2f2" stroke="#c0392b" stroke-width="1"/>
                <text x="390" y="145" font-size="11" fill="#c0392b" font-weight="700">INCORRECT:</text>
                <text x="390" y="161" font-size="10" fill="#2c3e50">WRB terminated at corner</text>
                <text x="390" y="175" font-size="10" fill="#2c3e50">edge — moisture infiltration.</text>
            </svg>
            <div style="font-size:12px; color:#5d6d7e; margin-top:8px;">
                Per <b>R703.2</b>: Weather-resistive barrier (WRB) must be continuous. At outside corners,
                house wrap must extend <b>minimum 12 inches</b> around the corner and be installed <b>under</b>
                the corner post. This requires removal of adjacent wall siding — a single-wall repair
                is <b>not code-compliant</b>.
            </div>
        </div>''')

    # Drip Edge diagram
    if "rake-left" in zone_set or "rake-right" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">Drip Edge — Installation at Eaves vs Rakes</div>
            <svg viewBox="0 0 600 160" width="100%" style="max-width:580px;">
                <!-- Eave detail (left) -->
                <text x="130" y="20" text-anchor="middle" font-size="12" fill="#0d2137" font-weight="700">AT EAVES</text>
                <rect x="30" y="60" width="200" height="12" fill="#e8d5b0" stroke="#8b7355" stroke-width="1"/>
                <text x="130" y="70" text-anchor="middle" font-size="8" fill="#8b7355">DECK</text>
                <rect x="25" y="55" width="210" height="4" fill="#c0392b" stroke="#8b1a1a" stroke-width="0.5"/>
                <text x="130" y="50" text-anchor="middle" font-size="9" fill="#c0392b" font-weight="700">DRIP EDGE (under I&amp;W)</text>
                <rect x="30" y="40" width="200" height="14" fill="#4a90d9" opacity="0.6" stroke="#2c6fbb" stroke-width="1"/>
                <text x="130" y="51" text-anchor="middle" font-size="8" fill="white" font-weight="600">I&amp;W</text>
                <rect x="30" y="28" width="200" height="11" fill="#6b7b8d" stroke="#4a5568" stroke-width="0.5"/>
                <text x="130" y="37" text-anchor="middle" font-size="7" fill="white">SHINGLES</text>
                <text x="130" y="100" text-anchor="middle" font-size="10" fill="#27ae60" font-weight="600">Drip edge UNDER I&amp;W</text>

                <!-- Rake detail (right) -->
                <text x="440" y="20" text-anchor="middle" font-size="12" fill="#0d2137" font-weight="700">AT RAKES</text>
                <rect x="340" y="60" width="200" height="12" fill="#e8d5b0" stroke="#8b7355" stroke-width="1"/>
                <text x="440" y="70" text-anchor="middle" font-size="8" fill="#8b7355">DECK</text>
                <rect x="340" y="40" width="200" height="14" fill="#a0b4c8" opacity="0.6" stroke="#7a8fa3" stroke-width="1"/>
                <text x="440" y="51" text-anchor="middle" font-size="8" fill="#2c3e50">UNDERLAYMENT</text>
                <rect x="335" y="35" width="210" height="4" fill="#c0392b" stroke="#8b1a1a" stroke-width="0.5"/>
                <text x="440" y="30" text-anchor="middle" font-size="9" fill="#c0392b" font-weight="700">DRIP EDGE (over underlayment)</text>
                <rect x="340" y="24" width="200" height="11" fill="#6b7b8d" stroke="#4a5568" stroke-width="0.5"/>
                <text x="440" y="33" text-anchor="middle" font-size="7" fill="white">SHINGLES</text>
                <text x="440" y="100" text-anchor="middle" font-size="10" fill="#27ae60" font-weight="600">Drip edge OVER underlayment</text>

                <!-- Note -->
                <text x="300" y="140" text-anchor="middle" font-size="10" fill="#5d6d7e">Per R905.2.8.5: Drip edge shall be provided at eaves AND gable rake edges.</text>
                <text x="300" y="155" text-anchor="middle" font-size="10" fill="#c0392b" font-weight="600">Carriers commonly omit drip edge at rakes — this is a code violation.</text>
            </svg>
        </div>''')

    # Starter strip at rakes
    if "eave-front" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">Starter Course — Required at Eaves AND Rakes</div>
            <svg viewBox="0 0 600 140" width="100%" style="max-width:580px;">
                <!-- Roof surface -->
                <polygon points="300,15 50,120 550,120" fill="#8b9bb0" stroke="#2c3e50" stroke-width="2"/>
                <!-- Starter at eave (green = correct) -->
                <line x1="60" y1="118" x2="540" y2="118" stroke="#27ae60" stroke-width="6"/>
                <text x="300" y="135" text-anchor="middle" font-size="10" fill="#27ae60" font-weight="700">STARTER AT EAVE (carriers usually include)</text>
                <!-- Starter at rakes (red = commonly omitted) -->
                <line x1="60" y1="118" x2="295" y2="18" stroke="#c0392b" stroke-width="6" stroke-dasharray="8,4"/>
                <line x1="540" y1="118" x2="305" y2="18" stroke="#c0392b" stroke-width="6" stroke-dasharray="8,4"/>
                <text x="140" y="55" font-size="10" fill="#c0392b" font-weight="700" transform="rotate(-35, 140, 55)">STARTER AT RAKE</text>
                <text x="460" y="55" font-size="10" fill="#c0392b" font-weight="700" transform="rotate(35, 460, 55)">STARTER AT RAKE</text>
            </svg>
            <div style="font-size:12px; color:#5d6d7e; margin-top:8px;">
                Per manufacturer installation instructions (force of law under R905.1): Starter course is required
                at <b>both eaves AND rakes</b>. Carriers commonly only include starter at eaves — omitting rakes
                is a <b>code violation</b> that voids the manufacturer warranty.
            </div>
        </div>''')

    return "\n".join(diagrams)


def _code_section_carrier_status(config: dict) -> dict:
    """WS-7 — map a code SECTION (e.g. 'R905.1.2') → carrier coverage state, by
    joining the per-line carrier status (from carrier.carrier_line_items) onto
    the code_citation.section of each code-cited line item. Lets the summary
    table show the REAL carrier-omission status that was previously computed but
    dropped."""
    status_map = _carrier_status_map(config)
    out = {}
    for li in _code_line_items(config):
        cc = li.get("code_citation") or {}
        section = (cc.get("section") or "").strip()
        if not section:
            continue
        # WS-7 FIX 1: NO positive carrier match → NEUTRAL (None), never a default
        # 'omitted'. Precedence per section: omitted > included > neutral, so a
        # genuinely-absent line dominates, but an unmatched line never fabricates
        # an omission.
        state = status_map.get((li.get("description") or "").strip().lower())  # None when unmatched
        prev = out.get(section)
        if prev == "omitted":
            continue
        if state == "omitted":
            out[section] = "omitted"
        elif state == "included" and prev != "included":
            out[section] = "included"
        elif section not in out:
            out[section] = state  # may be None → neutral
    return out


def _build_summary_table(annotations: list[dict], config: dict) -> str:
    """Build the summary table of all applicable codes.

    WS-7: when a carrier scope is present, the previously-dropped carrier-
    omission status is wired into a real "Carrier Scope" column (INCLUDED vs
    OMITTED) instead of the old "VERIFY" placeholder."""
    jurisdiction = _get_jurisdiction(config.get("property", {}).get("state", "NY"))
    carrier_present = carrier_scope_present(config)
    section_status = _code_section_carrier_status(config) if carrier_present else {}

    rows = []
    for ann in annotations:
        cc = ann.get("full_citation", {})
        mfr_specs = cc.get("manufacturer_specs", [])
        mfr_names = ", ".join(s.get("manufacturer", "") for s in mfr_specs[:2]) if mfr_specs else "—"
        has_void = any(s.get("warranty_void") for s in mfr_specs)

        carrier_cell = ""
        if carrier_present:
            # Join on the bare section (strip the jurisdiction prefix off code_tag).
            section = (cc.get("section") or "").strip()
            state = section_status.get(section)
            if state == "omitted":
                # WS-7 FIX 1: only OMITTED on a positive carrier-absence match.
                carrier_cell = '<td class="status-missing">OMITTED</td>'
            elif state == "included":
                carrier_cell = '<td class="status-included">Included</td>'
            else:
                # No positive carrier match → NEUTRAL "not compared" dash.
                carrier_cell = '<td style="color:#95a5a6;">&mdash;</td>'

        rows.append(f'''
        <tr>
            <td><b>{_h(ann.get("code_tag", ""))}</b></td>
            <td>{_h(ann.get("title", ""))}</td>
            <td>{_h(ann.get("measurement", ""))}</td>
            <td>{_h(mfr_names)}</td>
            <td>{"WARRANTY VOID" if has_void else "—"}</td>
            {carrier_cell}
        </tr>''')

    carrier_th = "<th>Carrier Scope</th>" if carrier_present else ""

    return f'''
    <h2>Code Requirements Summary</h2>
    <table class="summary-table">
        <thead>
            <tr>
                <th>Code Section</th>
                <th>Requirement</th>
                <th>Measurement</th>
                <th>Manufacturer</th>
                <th>Warranty Impact</th>
                {carrier_th}
            </tr>
        </thead>
        <tbody>
            {"".join(rows)}
        </tbody>
    </table>
    <div class="footer">
        Jurisdiction: {jurisdiction["name"]} | Report generated by {_h(config.get("company", {}).get("name") or "Your Roofing Company")}
    </div>
    '''


def _trade_of(li: dict) -> str:
    """Display trade/category bucket for grouping supplement rows."""
    t = (li.get("trade") or li.get("category") or "ROOFING").strip().upper()
    return t or "ROOFING"


def _code_section(li: dict) -> str:
    """The carrier-facing code section string for a code-cited line item.
    Prefer the jurisdiction-prefixed code_tag (e.g. 'TX-IRC R905.1.2'); fall
    back to the bare section."""
    cc = li.get("code_citation") or {}
    return cc.get("code_tag") or cc.get("section") or ""


def build_priced_supplement(config: dict) -> dict:
    """WS-7 — build the PRICED code-compliance supplement: a FILTERED VIEW of
    Doc 02's code-required line items.

    Returns a dict: {'html': <table html>, 'subtotal': float, 'row_count': int,
    'is_attribution_view': True, 'omitted_count': int}. The subtotal is computed
    with the EXACT per-line rounding Doc 02 uses
    (``round(qty*unit_price, 2)`` per item, summed), so it equals the sum of the
    same line_items in Doc 02 — the subset invariant. NEVER additive.

    Unit prices are read OFF the frozen line items (B.7) — no re-resolution here.
    """
    code_items = _code_line_items(config)
    ahj = _ahj_header(config)
    carrier_present = carrier_scope_present(config)
    status_map = _carrier_status_map(config)

    # Group by trade, preserving Doc-02-ish category order.
    _CAT_ORDER = {"ROOFING": 0, "SIDING": 1, "GUTTERS": 2, "INTERIOR": 3, "GENERAL": 4, "DEBRIS": 5}
    groups: dict[str, list] = {}
    for li in code_items:
        groups.setdefault(_trade_of(li), []).append(li)

    subtotal = 0.0
    omitted_count = 0
    body_rows = []

    # Column count drives colspans (carrier column only when a scope is present).
    n_cols = 8 if carrier_present else 7

    for trade in sorted(groups, key=lambda t: _CAT_ORDER.get(t, 99)):
        items = groups[trade]
        body_rows.append(
            f'<tr class="trade-header"><td colspan="{n_cols}">{_h(trade)}</td></tr>'
        )
        trade_subtotal = 0.0
        for li in items:
            qty = float(li.get("qty", 0) or 0)
            unit_price = float(li.get("unit_price", 0) or 0)
            line_total = round(qty * unit_price, 2)
            subtotal += line_total
            trade_subtotal += line_total

            cc = li.get("code_citation") or {}
            section = _code_section(li)
            requirement = cc.get("requirement") or cc.get("title") or ""
            desc = li.get("description", "")
            unit = li.get("unit", "")

            carrier_cell = ""
            if carrier_present:
                state = status_map.get((desc or "").strip().lower())
                if state == "omitted":
                    # WS-7 FIX 1: only count/label OMITTED when a carrier row
                    # POSITIVELY matched AND indicates absence — never a default.
                    omitted_count += 1
                    carrier_cell = '<td class="carrier-omitted">OMITTED</td>'
                elif state == "included":
                    carrier_cell = '<td class="carrier-included">Included</td>'
                else:
                    # NO positive match against the carrier comparison rows. We
                    # do NOT know whether the carrier included this item, so we
                    # render a NEUTRAL "not compared" dash — asserting OMITTED
                    # here would be a carrier-facing falsehood (the old bug).
                    carrier_cell = '<td style="color:#95a5a6;">&mdash;</td>'

            body_rows.append(f'''<tr>
                <td><b>{_h(section)}</b></td>
                <td>{_h(requirement)}</td>
                <td>{_h(desc)}</td>
                <td class="num">{qty:g}</td>
                <td>{_h(unit)}</td>
                <td class="num">{_money(unit_price)}</td>
                <td class="num">{_money(line_total)}</td>
                {carrier_cell}
            </tr>''')

        body_rows.append(
            f'<tr class="trade-subtotal"><td colspan="{n_cols-1}">{_h(trade)} subtotal</td>'
            f'<td class="num">{_money(trade_subtotal)}</td></tr>'
            if not carrier_present else
            f'<tr class="trade-subtotal"><td colspan="{n_cols-2}">{_h(trade)} subtotal</td>'
            f'<td class="num">{_money(trade_subtotal)}</td><td></td></tr>'
        )

    # Grand subtotal row.
    if carrier_present:
        body_rows.append(
            f'<tr class="grand-subtotal"><td colspan="{n_cols-2}">CODE-COMPLIANCE SUPPLEMENT SUBTOTAL</td>'
            f'<td class="num">{_money(subtotal)}</td><td></td></tr>'
        )
    else:
        body_rows.append(
            f'<tr class="grand-subtotal"><td colspan="{n_cols-1}">CODE-COMPLIANCE SUPPLEMENT SUBTOTAL</td>'
            f'<td class="num">{_money(subtotal)}</td></tr>'
        )

    carrier_th = "<th>Carrier Scope</th>" if carrier_present else ""
    adopted = f" (adopted {ahj['adopted_year']})" if ahj.get("adopted_year") else ""

    html = f'''
    <h2>Code-Compliance Supplement &mdash; Priced</h2>

    <div class="ahj-header" data-ahj="true">
        <div class="ahj-title">Authority Having Jurisdiction &amp; Code Edition</div>
        <div class="ahj-body">{_h(ahj['jurisdiction'])} ({_h(ahj['prefix'])}) &mdash; base code {_h(ahj['base_code'])}{_h(adopted)}</div>
    </div>

    <div class="non-additive-banner" data-attribution-view="true">
        <b>These items are already included in the Xactimate estimate (Document #2).</b>
        This supplement isolates the code-mandated subset of that estimate &mdash; it is an
        <b>attribution view, not additional money</b>. The subtotal below equals the sum of these same
        line items in the Xactimate estimate and must never be added to it.
    </div>

    <table class="supplement-table" data-attribution-view="true">
        <thead>
            <tr>
                <th>Code Section</th>
                <th>Requirement</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit Price</th>
                <th>Line Total</th>
                {carrier_th}
            </tr>
        </thead>
        <tbody>
            {"".join(body_rows)}
        </tbody>
    </table>
    '''

    if carrier_present:
        html += (
            f'<p style="font-size:12px; color:#5d6d7e; margin-top:8px;">'
            f'<b class="carrier-omitted">{omitted_count}</b> code-mandated item(s) are '
            f'<b>omitted from the carrier scope</b> &mdash; these are the supplement gap.</p>'
        )

    return {
        "html": html,
        "subtotal": round(subtotal, 2),
        "row_count": len(code_items),
        "omitted_count": omitted_count,
        "is_attribution_view": True,
        "carrier_present": carrier_present,
    }


def build_requirements_only_supplement(config: dict) -> str:
    """WS-7 — forensic-only fallback (NO measurements AND NO carrier scope).
    Renders the same code REQUIREMENTS list with NO qty / price / subtotal, plus
    the upload notice. v1 accepts that this list is thin (it derives from the
    code-cited annotations the forensic pass produced).

    RESERVED — NOT YET WIRED IN PRODUCTION (WS-7 recon, 2026-05-29). The
    requirements-only branch below is currently UNREACHABLE in the live
    pipeline: forensic_only mode skips Doc 06 entirely at the generator gate,
    AND the forensic_only post-generation filter drops the ``06_`` artifact. So
    today this branch only ever runs in unit tests. It is kept INTACT (with its
    tests) as the deliberate foundation for the future forensic-only Doc-06
    upsell ("upload measurements/scope to unlock the priced supplement"). Wiring
    it requires a forensic_only filter change that is intentionally OUT OF SCOPE
    here (it collides with another shell's work) — see follow-up. Do not delete."""
    ahj = _ahj_header(config)
    annotations = collect_annotations_from_config(config)

    rows = []
    seen = set()
    for ann in annotations:
        cc = ann.get("full_citation", {}) or {}
        tag = ann.get("code_tag", "") or cc.get("code_tag", "")
        title = ann.get("title", "")
        requirement = cc.get("requirement", "") or title
        key = (tag, title)
        if key in seen:
            continue
        seen.add(key)
        rows.append(f'''<tr>
            <td><b>{_h(tag)}</b></td>
            <td>{_h(title)}</td>
            <td>{_h(requirement)}</td>
        </tr>''')

    adopted = f" (adopted {ahj['adopted_year']})" if ahj.get("adopted_year") else ""
    table = ""
    if rows:
        table = f'''
        <table class="req-only-list">
            <thead><tr><th>Code Section</th><th>Requirement</th><th>Detail</th></tr></thead>
            <tbody>{"".join(rows)}</tbody>
        </table>'''

    return f'''
    <h2>Code-Compliance Supplement &mdash; Requirements Only</h2>

    <div class="ahj-header" data-ahj="true">
        <div class="ahj-title">Authority Having Jurisdiction &amp; Code Edition</div>
        <div class="ahj-body">{_h(ahj['jurisdiction'])} ({_h(ahj['prefix'])}) &mdash; base code {_h(ahj['base_code'])}{_h(adopted)}</div>
    </div>

    <div class="req-only-notice" data-requirements-only="true">
        <b>Upload roof measurements or the carrier scope</b> to generate the priced
        code-compliance supplement (Code Section, Requirement, Item, Qty, Unit, Unit Price,
        Line Total + subtotal). The requirements below are code-mandated regardless of pricing.
    </div>
    {table}
    '''


def build_compliance_report(config: dict) -> str:
    """
    Build the complete Building Code Compliance Report HTML.

    Args:
        config: Full claim config with measurements, line_items, property, etc.

    Returns:
        Path to the generated HTML file.
    """
    state = config.get("property", {}).get("state", "NY")
    jurisdiction = _get_jurisdiction(state)

    # 1. Collect annotations from code citations on line items
    annotations = collect_annotations_from_config(config)

    if not annotations:
        print("[COMPLIANCE] No code citations found on line items — skipping report")
        return ""

    # 2. Generate annotated house SVG
    house_svg = generate_house_svg(config, annotations)

    # 3. Build sections
    cover_html = _build_cover_page(config, jurisdiction, len(annotations))
    detail_cards = _build_code_detail_cards(annotations, config)
    diagrams = _build_installation_diagrams(annotations, config)
    summary = _build_summary_table(annotations, config)

    # 3b. WS-7 GATING — priced mode when measurements OR a carrier scope is
    # present; otherwise REQUIREMENTS-ONLY (no qty/price/subtotal) + upload
    # notice. The priced supplement is a FILTERED, NON-ADDITIVE view of Doc 02.
    priced_mode = has_measurements(config) or carrier_scope_present(config)
    if priced_mode:
        supplement = build_priced_supplement(config)
        supplement_html = supplement["html"]
        _mode = "priced"
        print(f"[COMPLIANCE] priced supplement: {supplement['row_count']} code line items, "
              f"subtotal={_money(supplement['subtotal'])}, "
              f"carrier_scope={'yes' if supplement['carrier_present'] else 'no'}, "
              f"omitted={supplement['omitted_count']}")
    else:
        # RESERVED — see build_requirements_only_supplement docstring. This
        # branch is UNREACHABLE in production today (forensic_only skips Doc 06
        # at the generator gate + the forensic_only post-gen filter drops 06_).
        # Kept for the future forensic-only Doc-06 upsell; not yet wired (a
        # forensic_only filter change is out of scope here). Tests still cover it.
        supplement_html = build_requirements_only_supplement(config)
        _mode = "requirements-only"
        print("[COMPLIANCE] requirements-only supplement (no measurements, no carrier scope)")

    # 4. Assemble full HTML
    html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>{COMPLIANCE_CSS}</style>
</head>
<body>
    {cover_html}
    <div class="page-break"></div>

    <div class="rendering-section">
        <div class="rendering-title">Annotated Property Diagram — Code Requirement Zones</div>
        {house_svg}
    </div>
    <div class="page-break"></div>

    <h2>Code Requirement Details</h2>
    {detail_cards}
    <div class="page-break"></div>

    <h2>Installation Requirements — Visual Reference</h2>
    <p style="font-size:13px; color:#5d6d7e;">
        The following diagrams illustrate correct vs. incorrect installation methods
        for code-required components. These represent manufacturer installation
        instructions which carry the <b>force of building code</b> per {jurisdiction["abbrev"]} R905.1.
    </p>
    {diagrams}
    <div class="page-break"></div>

    {summary}
    <div class="page-break"></div>

    {supplement_html}
</body>
</html>'''

    # 5. Write to output directory
    output_dir = config.get("_paths", {}).get("output", "/tmp")
    output_path = os.path.join(output_dir, "06_CODE_COMPLIANCE_REPORT.html")
    with open(output_path, "w") as f:
        f.write(html)

    print(f"[COMPLIANCE] Report generated: {len(annotations)} codes, mode={_mode}, "
          f"jurisdiction={jurisdiction['abbrev']}, path={output_path}")
    return output_path


def _num(value) -> float:
    """Coerce a measurement value to a float, tolerating strings.

    E268 (2026-05-29): real configs store measurement values as display
    strings like ``'109 ft'`` / ``'1,250 SF'`` / ``''`` (11/34 production
    configs). The old ``eave > 0`` comparison raised ``TypeError`` on those.
    This strips any non-numeric trailing/leading characters and returns 0.0
    when the value is empty, ``None``, or otherwise non-numeric — never raises.
    """
    if value is None:
        return 0.0
    if isinstance(value, bool):  # avoid True->1.0 surprises
        return 0.0
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except (ValueError, OverflowError):
            return 0.0
    if isinstance(value, str):
        s = value.strip().replace(",", "")
        if not s:
            return 0.0
        # Pull the first numeric token (handles '109 ft', '1250 SF', '32.5lf').
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        if not m:
            return 0.0
        try:
            return float(m.group(0))
        except (ValueError, OverflowError):
            return 0.0
    return 0.0


def has_measurements(config: dict) -> bool:
    """Check if the config has enough measurement data for the compliance report.

    Looks at the top-level ``measurements`` dict (populated when an EagleView /
    HOVER file is uploaded) AND the ``structures[].roof_area_sq`` /
    ``roof_area_sf`` fields (populated when measurements are inferred from
    carrier-scope extraction with no measurement file).

    E252 (2026-05-21): Marion IN 603 E 26th St shipped 5 PDFs instead of 6
    because measurements lived on structures[0] only — top-level
    `measurements` had every key at 0 (only drip_edge was set). The structures
    fallback below recovers area for that path.

    E268 (2026-05-29): float-coerce every value via ``_num`` BEFORE comparison
    so string values like ``'109 ft'`` never raise ``TypeError``. This is a
    prerequisite for the WS-5 no-data render guards that call it from the
    PDF-generation path.
    """
    if not isinstance(config, dict):
        return False
    m = config.get("measurements", {}) or {}
    if not isinstance(m, dict):
        m = {}
    eave = _num(m.get("eave", 0))
    rake = _num(m.get("rake", 0))
    area = _num(m.get("total_area", 0)) or _num(m.get("area_sq", 0))

    if not area:
        for s in (config.get("structures") or []):
            if not isinstance(s, dict):
                continue
            area = (
                _num(s.get("roof_area_sq", 0))
                or _num(s.get("roof_area_sf", 0)) / 100.0
            )
            if area:
                break

    return eave > 0 or rake > 0 or area > 0


def weather_verified(config: dict) -> bool:
    """Return True when the claim has ANY production-stored storm verification.

    WS-5 (2026-05-29): production stores ``config['weather']`` as ONLY the three
    keys written by ``processor.py`` —
        {"hail_size", "storm_date", "storm_description"}
    plus, when a NOAA/pre-seed pass ran, ``weather['noaa']['event_count']``.

    The rich keys (``hail_size_algorithm``, ``hailtrace_id``, ``verification_method``,
    ``max_hail_inches`` …) are NEVER written in prod, so a heuristic keyed on
    them would FALSE-NEGATIVE on a real verified claim. This helper therefore
    keys ONLY on the prod-shape fields:

      * any of hail_size / storm_date / storm_description is non-empty, OR
      * weather.noaa.event_count > 0

    Tolerant of string values and missing/odd shapes — never raises.
    """
    if not isinstance(config, dict):
        return False
    w = config.get("weather", {})
    if not isinstance(w, dict):
        return False

    for key in ("hail_size", "storm_date", "storm_description"):
        v = w.get(key, "")
        if isinstance(v, str):
            if v.strip():
                return True
        elif v:  # non-empty/truthy non-string (e.g. a number)
            return True

    noaa = w.get("noaa", {})
    if isinstance(noaa, dict):
        if _num(noaa.get("event_count", 0)) > 0:
            return True

    return False

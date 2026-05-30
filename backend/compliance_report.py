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
from roof_geometry_svg import render_roof_footprint, EDGE_ZONES, _LEGEND_ORDER


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


# Match strength tiers (LOWER == STRONGER). 1 exact, 2 contains, 3 token-overlap,
# 0 no match. Used by the WS-7 contradiction guard so a weak coincidental token
# overlap can never outvote a strong exact/contains match on the opposite side.
_CR_TIER_EXACT = 1
_CR_TIER_CONTAINS = 2
_CR_TIER_TOKEN = 3
_CR_TIER_NONE = 0


def _cr_match_tier(usarm_desc: str, cand: dict) -> int:
    """Strength of the single best relationship between ``usarm_desc`` and one
    candidate carrier row, using the SAME ladder as ``_cr_match``:
      1 exact normalized equality, 2 normalized contains (either direction),
      3 significant-token overlap ≥ 0.6 of the smaller token set, 0 no match."""
    nu = _cr_normalize(usarm_desc)
    if not nu:
        return _CR_TIER_NONE
    nc = cand.get("norm") or ""
    if nc == nu:
        return _CR_TIER_EXACT
    if nc and (nu in nc or nc in nu):
        return _CR_TIER_CONTAINS
    tu = _cr_tokens(usarm_desc)
    tc = cand.get("tokens") or set()
    if tc and tu:
        ov = len(tu & tc) / max(1, min(len(tu), len(tc)))
        if ov >= 0.6:
            return _CR_TIER_TOKEN
    return _CR_TIER_NONE


def _carrier_candidates(config: dict) -> list:
    """Pre-normalize every carrier comparison row into {"norm", "tokens", "row"}
    for matching.

    WS-7 contradiction guard: a PRESENT carrier row (e.g. a 'carrier_only' line
    the carrier put in scope) frequently has NO usarm_desc/checklist_desc — only
    a carrier_desc. We MUST still surface it as a candidate so the guard can see
    when the carrier scope is self-contradictory (the SAME item appears both as a
    'missing' line AND as a present 'carrier_only' line). So the description
    source falls back usarm_desc → checklist_desc → carrier_desc. Rows whose only
    text is the placeholder 'NOT INCLUDED' carry no item identity and are
    skipped (they still anchor their own missing-status via the usarm_desc/
    checklist_desc path above when one exists)."""
    cands = []
    if not carrier_scope_present(config):
        return cands
    for row in config["carrier"]["carrier_line_items"]:
        if not isinstance(row, dict):
            continue
        desc = (row.get("usarm_desc") or row.get("checklist_desc")
                or row.get("carrier_desc") or "").strip()
        if not desc or desc.upper() == "NOT INCLUDED":
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
    """WS-7 FIX 1 (+ contradiction guard): resolve a USARM description against
    ALL carrier rows, not just the single best match.

    Returns:
      'included' — positively matches a carrier row the carrier DID include,
      'omitted'  — positively matches a carrier row that indicates ABSENCE
                   (status missing / NOT INCLUDED) AND does NOT also positively
                   match, at equal-or-stronger strength, any carrier row that is
                   PRESENT,
      None       — NO positive match, OR a SELF-CONTRADICTORY carrier scope
                   (the item is matched, at the same match strength, both as a
                   missing carrier line AND as a present carrier line). The
                   caller renders a NEUTRAL '—' and asserts nothing.

    Precedence (completing Blocker 1): a code row may render OMITTED ONLY when it
    positively matches a MISSING carrier line AND does NOT also positively match
    a PRESENT carrier line of equal-or-greater match strength. If both a missing
    and an equally-strong present match exist (the carrier scope is
    self-contradictory for that item — e.g. the same item appears as both a
    'missing' line and a present 'carrier_only' line), we assert NOTHING (NEUTRAL
    '—'), never a disputable OMITTED. A weaker coincidental token overlap on the
    opposite side NEVER overturns a strictly-stronger match — so a genuine
    omission with an exact missing match and only a weak present token-overlap
    (e.g. felt 15# underlayment vs the carrier's 'Roofing felt - 15 lb.' line)
    still renders OMITTED. Symmetrically, a strictly-stronger present match wins
    as Included."""
    best_missing = _CR_TIER_NONE
    best_present = _CR_TIER_NONE
    for c in candidates:
        tier = _cr_match_tier(usarm_desc, c)
        if tier == _CR_TIER_NONE:
            continue
        if _row_is_omitted(c["row"]):
            if best_missing == _CR_TIER_NONE or tier < best_missing:
                best_missing = tier
        else:
            if best_present == _CR_TIER_NONE or tier < best_present:
                best_present = tier

    has_missing = best_missing != _CR_TIER_NONE
    has_present = best_present != _CR_TIER_NONE

    if not has_missing and not has_present:
        return None                      # no positive match → neutral
    if has_present and not has_missing:
        return "included"
    if has_missing and not has_present:
        return "omitted"
    # Both sides matched. Strictly-stronger side wins; equal strength is a
    # genuine self-contradiction → neutral (assert nothing).
    if best_missing < best_present:      # missing strictly stronger
        return "omitted"
    if best_present < best_missing:      # present strictly stronger
        return "included"
    return None                          # equal strength → contradiction


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

# ── CSS — "Spectral serif-authority" design system (owner-approved, locked) ──
#
# Per-company theming lives ENTIRELY in the :root token block at the top. A
# company swaps its whole color scheme in a SINGLE edit there — every component
# below reads the tokens, no literal palette value is repeated downstream.
# Default scheme = deep navy + confident brick red on a warm off-white sheet.
#
# Type system (loaded via the Google Fonts <link> in the document head):
#   • Spectral       — serif, the authority voice: titles, headings, callouts
#   • Libre Franklin — sans, labels + body copy
#   • IBM Plex Mono  — claim numbers, code sections, prices, all tabular data
#
# The .cite-chip component renders the SPECIFIC code source + citation number as
# an unmistakable bold anchor on every code element (cover, requirement detail,
# every priced row, every argument step). The exact citation is the load-bearing
# credibility, so it is styled to read as a hard, legal-grade reference token.

COMPLIANCE_CSS = """
/* ============================================================
   :root — SWAPPABLE PER-COMPANY THEME (edit ONLY this block to
   re-skin the entire document for another contractor's brand).
   ============================================================ */
:root {
    /* — brand palette — */
    --c-navy:        #0d1b3e;   /* deep navy — primary authority color  */
    --c-navy-deep:   #091230;   /* darker navy — cover gradient floor   */
    --c-navy-soft:   #16284f;   /* lifted navy — gradient ceiling/bands */
    --c-brick:       #9a2b2f;   /* confident brick red — the accent     */
    --c-brick-bright:#b8383c;   /* brighter brick — hairlines/markers   */
    --c-brick-warm:  #c98f6d;   /* warm clay — on-navy accent (legible) */

    /* — sheet / neutrals — */
    --c-paper:       #faf8f3;   /* warm off-white sheet                 */
    --c-paper-warm:  #f3efe5;   /* warmer panel fill                    */
    --c-ink:         #1a1f29;   /* near-black body ink                  */
    --c-slate:       #4a5568;   /* secondary text                       */
    --c-mute:        #8a93a3;   /* tertiary / labels                    */
    --c-line:        #d8d2c5;   /* warm hairline                        */
    --c-line-soft:   #e7e2d6;   /* lighter hairline                     */
    --c-gold:        #b08a3e;   /* attribution / non-additive marker    */

    /* — COMPLIANCE STATUS ONLY (forest green / red are reserved for the
         Included vs OMITTED carrier signal — never decorative) — */
    --c-included:    #1f6b4a;   /* forest green — carrier Included      */
    --c-included-bg: #e6efe8;
    --c-included-bd: #bcd6c6;
    --c-omitted:     #9a2b2f;   /* red — carrier OMITTED                */
    --c-omitted-bg:  #f5dede;
    --c-omitted-bd:  #e2b9b9;

    /* — type tokens — */
    --f-serif: 'Spectral', Georgia, 'Times New Roman', serif;
    --f-sans:  'Libre Franklin', -apple-system, Helvetica, Arial, sans-serif;
    --f-mono:  'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace;

    /* — ROOF-FOOTPRINT CODE-ZONE EDGE COLORS —
         The real-geometry overhead footprint (roof_geometry_svg) strokes each
         polygon edge by the building-code zone it drives, emitting
         var(--roof-<zone>, #web-default). We override the web-default brights to
         the Spectral palette so the footprint reads as part of THIS document, not
         a generic chart. Each maps an edge type → its code product on-palette: */
    --roof-eave:        #0d1b3e;   /* navy   — Ice & Water Barrier (eaves)  */
    --roof-rake:        #1f6b4a;   /* forest — Drip Edge (rakes)            */
    --roof-ridge:       #9a2b2f;   /* brick  — Ridge Vent (ridges)          */
    --roof-valley:      #b08a3e;   /* gold   — Valley Metal (valleys)       */
    --roof-wall:        #c98f6d;   /* clay   — Step Flashing (wall edges)   */
    --roof-hip:         #8a93a3;   /* mute   — Hip (neutral)                */
    --roof-unknown:     #8a93a3;   /* mute   — Unclassified (neutral)       */
    --roof-facet-fill:  rgba(13,27,62,0.06);   /* faint navy footprint fill */
    --roof-facet-edge:  rgba(0,0,0,0);
    --roof-bg:          #ffffff;
    --roof-legend-bg:   rgba(250,248,243,0.92);  /* warm paper             */
    --roof-legend-border: rgba(13,27,62,0.14);
    --roof-legend-text: #1a1f29;
}

@page { size: letter; margin: 0.5in 0.55in; }
* { box-sizing: border-box; }
body {
    font-family: var(--f-sans);
    color: var(--c-ink);
    background: var(--c-paper);
    line-height: 1.5;
    font-size: 13px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.page-break { page-break-after: always; }

h1 { font-family: var(--f-serif); font-size: 30px; font-weight: 600; color: var(--c-navy); margin: 0 0 8px 0; letter-spacing: -0.01em; }
h2 {
    font-family: var(--f-serif); font-size: 25px; font-weight: 600; color: var(--c-navy);
    margin: 30px 0 14px 0; padding-bottom: 8px; letter-spacing: -0.01em;
    border-bottom: 2px solid var(--c-navy);
}
h3 { font-family: var(--f-serif); font-size: 17px; font-weight: 600; color: var(--c-navy); margin: 18px 0 8px 0; }

/* section eyebrow above an h2 */
.sec-eyebrow {
    font-family: var(--f-sans); font-size: 9px; font-weight: 700; letter-spacing: 0.26em;
    text-transform: uppercase; color: var(--c-brick); margin: 26px 0 2px 0;
}

/* ── THE CITATION CHIP — used everywhere a code source appears ──
   Renders the exact code + citation number as a hard, legal-grade anchor.
   .cite-chip.neutral = a non-code reference (e.g. a standard-of-indemnity tag). */
.cite-chip {
    display: inline-block; font-family: var(--f-mono); font-weight: 700;
    font-size: 10px; letter-spacing: 0.02em; line-height: 1.3;
    color: var(--c-brick); background: var(--c-omitted-bg);
    border: 1px solid var(--c-omitted-bd); border-radius: 3px;
    padding: 2px 8px; white-space: nowrap; vertical-align: baseline;
}
.cite-chip.neutral { color: var(--c-slate); background: var(--c-paper-warm); border-color: var(--c-line); }
.cite-chip.on-navy { color: #fff; background: rgba(184,56,60,0.92); border-color: rgba(255,255,255,0.25); }

/* ── COVER (full-bleed navy) ── */
.cover {
    position: relative;
    background: linear-gradient(180deg, var(--c-navy-deep) 0%, var(--c-navy) 48%, var(--c-navy-soft) 100%);
    color: #eef1f5; margin: -0.5in -0.55in 0 -0.55in; padding: 0.62in 0.6in 0.5in;
    min-height: 10in;
}
.cover .cover-frame { position: absolute; inset: 0.26in; border: 1px solid rgba(255,255,255,0.16); pointer-events: none; }
.cover-top { display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 2; }
.cover-wordmark { font-family: var(--f-sans); font-weight: 800; font-size: 14px; letter-spacing: 0.15em; color: #fff; }
.cover-wordmark .wm-sub { display: block; font-size: 7px; letter-spacing: 0.32em; font-weight: 600; color: var(--c-brick-warm); text-transform: uppercase; margin-top: 4px; }
.cover-tab {
    font-family: var(--f-sans); font-size: 8px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase;
    color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 6px 12px; border-radius: 2px;
}
.cover-hero { position: relative; z-index: 2; margin-top: 0.7in; }
.cover-kicker { font-family: var(--f-sans); font-weight: 700; font-size: 9px; letter-spacing: 0.38em; text-transform: uppercase; color: var(--c-brick-warm); margin-bottom: 18px; }
.cover h1 { font-family: var(--f-serif); font-weight: 600; font-size: 52px; line-height: 0.99; color: #fff; margin: 0; letter-spacing: -0.015em; }
.cover .cover-subtitle { font-family: var(--f-serif); font-style: italic; font-weight: 300; font-size: 16px; line-height: 1.45; color: #aeb9cb; margin-top: 22px; max-width: 5.6in; border-left: 2px solid var(--c-brick-bright); padding-left: 18px; }
.cover .lead-callout { margin-top: 30px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.12); border-left: 3px solid var(--c-brick-bright); padding: 18px 22px; max-width: 6in; }
.cover .lead-callout .lc-label { font-family: var(--f-sans); font-size: 7.5px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--c-brick-warm); font-weight: 700; margin-bottom: 9px; }
.cover .lead-callout p { font-size: 12px; line-height: 1.62; color: #d4dae4; }
.cover .lead-callout p b { color: #fff; font-weight: 700; }
.cover .lead-callout .lc-cite { margin-top: 12px; }

.cover-meta { position: relative; z-index: 2; margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr 1fr; border-top: 1px solid rgba(255,255,255,0.16); }
.cover-meta .cell { padding: 16px 18px 14px 0; border-right: 1px solid rgba(255,255,255,0.1); }
.cover-meta .cell:nth-child(3n) { border-right: 0; }
.cover-meta .k { font-family: var(--f-sans); font-size: 7px; letter-spacing: 0.24em; text-transform: uppercase; color: #8ea0bd; margin-bottom: 7px; }
.cover-meta .v { font-size: 11.5px; color: #eef1f5; line-height: 1.4; font-weight: 600; }
.cover-meta .v.serif { font-family: var(--f-serif); font-weight: 500; font-size: 14px; }
.cover-meta .v.mono { font-family: var(--f-mono); font-weight: 600; font-size: 12px; letter-spacing: 0.01em; }
.cover-meta .k.stacked { margin-top: 14px; }

.cover-foot { position: relative; z-index: 2; margin-top: 30px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.16); display: flex; justify-content: space-between; align-items: flex-end; }
.cover-foot .prep .pl { font-family: var(--f-sans); font-size: 7px; letter-spacing: 0.28em; text-transform: uppercase; color: #8ea0bd; margin-bottom: 6px; }
.cover-foot .prep .pv { font-family: var(--f-serif); font-size: 15px; color: #fff; }
.cover-foot .ahj-stamp { text-align: right; }
.cover-foot .ahj-stamp .pl { font-family: var(--f-sans); font-size: 7px; letter-spacing: 0.24em; text-transform: uppercase; color: #8ea0bd; margin-bottom: 6px; }
.cover-foot .ahj-stamp .pv { font-family: var(--f-serif); font-size: 13px; color: #fff; }
.cover-foot .ahj-stamp .pv-sub { font-family: var(--f-mono); font-size: 9px; color: #8ea0bd; margin-top: 4px; }

/* ── interior sheet chrome ── */
.run-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 2px solid var(--c-navy); margin-bottom: 4px; }
.run-head .rh-mark { font-family: var(--f-sans); font-weight: 800; font-size: 12px; letter-spacing: 0.12em; color: var(--c-navy); }
.run-head .rh-mark .rh-sub { display: block; font-family: var(--f-sans); font-weight: 600; font-size: 6.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--c-brick); margin-top: 3px; }
.run-head .rh-r { text-align: right; }
.run-head .rh-r .rh-doc { font-family: var(--f-sans); font-size: 8px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--c-slate); font-weight: 700; }
.run-head .rh-r .rh-claim { font-family: var(--f-mono); font-size: 11px; color: var(--c-navy); margin-top: 4px; }

.rendering-section { text-align: center; margin: 14px 0; }
.rendering-title { font-family: var(--f-sans); font-size: 11px; color: var(--c-slate); text-transform: uppercase; letter-spacing: 0.18em; font-weight: 700; margin-bottom: 12px; }

/* ── real overhead roof-footprint frame (used IN PLACE of the generic house
     when EagleView/Vision facet geometry is available; see _build_property_diagram) ── */
.roof-footprint-frame { border: 1px solid var(--c-line); border-radius: 4px; padding: 18px 18px 14px; margin: 4px auto 0; background: #fff; max-width: 7.2in; break-inside: avoid; }
.roof-footprint-frame .rff-cap { font-family: var(--f-sans); font-size: 9.5px; color: var(--c-mute); letter-spacing: 0.04em; line-height: 1.5; margin-top: 10px; text-align: left; }
.roof-footprint-frame .rff-cap b { color: var(--c-slate); }
/* HTML legend keying edge colors → code zones (mirrors the in-SVG legend so it
   stays crisp at print scale). Swatch color is the SAME --roof-<zone> token. */
.rff-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 22px; margin-top: 14px; text-align: left; }
.rff-legend .leg { display: flex; gap: 9px; align-items: center; }
.rff-legend .leg .swatch { flex: none; width: 22px; height: 5px; border-radius: 3px; }
.rff-legend .leg .lt { font-size: 10px; line-height: 1.35; color: var(--c-slate); }
.rff-legend .leg .lt b { font-family: var(--f-sans); font-size: 9px; letter-spacing: 0.04em; color: var(--c-ink); text-transform: uppercase; }

/* ── code detail cards ── */
.code-card { border: 1px solid var(--c-line); border-radius: 4px; padding: 18px 22px; margin: 16px 0; break-inside: avoid; background: #fff; }
.code-card.critical { border-left: 4px solid var(--c-brick); }
.code-card .cc-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.code-card .code-title { font-family: var(--f-serif); font-size: 18px; font-weight: 600; color: var(--c-navy); margin: 0; }
.code-card .requirement { font-size: 13px; color: var(--c-ink); background: var(--c-paper-warm); padding: 11px 15px; border-radius: 3px; margin: 10px 0; border-left: 3px solid var(--c-navy); line-height: 1.55; }
.code-card .measurement { font-family: var(--f-mono); font-size: 11.5px; color: var(--c-navy); font-weight: 600; margin: 9px 0; letter-spacing: 0.01em; }
.code-card .supplement { font-size: 12px; color: var(--c-slate); margin-top: 8px; line-height: 1.5; }

.mfr-spec { background: var(--c-paper-warm); border: 1px solid var(--c-line); border-left: 3px solid var(--c-gold); border-radius: 3px; padding: 11px 15px; margin: 9px 0; break-inside: avoid; }
.mfr-spec .mfr-name { font-family: var(--f-sans); font-weight: 700; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-gold); }
.mfr-spec .warranty-void { color: var(--c-brick); font-weight: 700; font-size: 12px; margin-top: 5px; }

/* ── plan-section diagrams ── */
.diagram-box { border: 1px solid var(--c-line); border-radius: 4px; padding: 16px 18px; margin: 14px 0; break-inside: avoid; background: #fff; }
.diagram-box .diagram-title { font-family: var(--f-serif); font-size: 15px; font-weight: 600; color: var(--c-navy); margin-bottom: 12px; }
.diagram-caption { font-size: 12px; color: var(--c-slate); margin-top: 10px; line-height: 1.55; }
.diagram-correct { color: var(--c-included); font-weight: 700; }
.diagram-incorrect { color: var(--c-brick); font-weight: 700; }
.plate-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin-top: 12px; }
.plate-legend .leg { display: flex; gap: 9px; align-items: flex-start; }
.plate-legend .leg .chip { flex: none; width: 13px; height: 13px; border-radius: 2px; margin-top: 2px; }
.plate-legend .leg .chip.ok { background: var(--c-included); }
.plate-legend .leg .chip.bad { background: var(--c-brick); }
.plate-legend .leg .lt { font-size: 10px; line-height: 1.4; color: var(--c-slate); }
.plate-legend .leg .lt b { display: block; font-family: var(--f-sans); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-ink); margin-bottom: 2px; }

/* ── summary table ── */
.summary-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 11.5px; }
.summary-table th { background: var(--c-navy); color: #dfe5ee; padding: 10px 12px; text-align: left; font-family: var(--f-sans); font-weight: 700; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 2px solid var(--c-brick); }
.summary-table td { padding: 9px 12px; border-bottom: 1px solid var(--c-line-soft); vertical-align: middle; color: var(--c-slate); }
.summary-table tr:nth-child(even) { background: var(--c-paper-warm); }
.status-missing { color: var(--c-omitted); font-weight: 700; }
.status-included { color: var(--c-included); font-weight: 700; }

.footer { display: flex; justify-content: space-between; align-items: center; font-family: var(--f-sans); font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--c-mute); margin-top: 26px; padding-top: 10px; border-top: 1px solid var(--c-line-soft); }
.footer .fl { font-weight: 700; color: var(--c-slate); }

/* ── WS-7 priced code-compliance supplement ── */
.ahj-header { display: flex; align-items: stretch; border: 1px solid var(--c-line); border-radius: 4px; overflow: hidden; margin: 16px 0 6px 0; }
.ahj-header .ahj-l { background: var(--c-navy); color: #fff; padding: 12px 18px; display: flex; flex-direction: column; justify-content: center; min-width: 1.3in; }
.ahj-header .ahj-title { font-family: var(--f-sans); font-size: 7px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase; color: var(--c-brick-warm); }
.ahj-header .ahj-l .ahj-prefix { font-family: var(--f-serif); font-size: 20px; margin-top: 5px; color: #fff; }
.ahj-header .ahj-r { padding: 12px 18px; display: flex; flex-direction: column; justify-content: center; background: #fff; flex: 1; }
.ahj-header .ahj-body { font-size: 12.5px; font-weight: 500; color: var(--c-ink); line-height: 1.4; }

.non-additive-banner { display: flex; gap: 14px; align-items: flex-start; background: var(--c-paper-warm); border: 1px solid var(--c-line); border-left: 4px solid var(--c-gold); border-radius: 3px; padding: 13px 18px; margin: 12px 0 18px 0; font-size: 12px; color: var(--c-slate); line-height: 1.55; }
.non-additive-banner .na-badge { flex: none; font-family: var(--f-sans); font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--c-gold); padding: 5px 11px; border-radius: 2px; margin-top: 1px; }
.non-additive-banner b { color: var(--c-ink); font-weight: 700; }

.supplement-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
.supplement-table th { background: var(--c-navy); color: #dfe5ee; padding: 10px 9px; text-align: left; font-family: var(--f-sans); font-weight: 700; font-size: 7.5px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 2px solid var(--c-brick); }
.supplement-table td { padding: 9px 9px; border-bottom: 1px solid var(--c-line-soft); vertical-align: top; color: var(--c-slate); }
.supplement-table tr:nth-child(even) td { background: var(--c-paper-warm); }
.supplement-table td.num { text-align: right; white-space: nowrap; font-family: var(--f-mono); color: var(--c-ink); }
.supplement-table td.line-total { text-align: right; white-space: nowrap; font-family: var(--f-mono); color: var(--c-navy); font-weight: 700; }
.supplement-table .item-desc { color: var(--c-ink); font-weight: 600; line-height: 1.35; }
.supplement-table td.unit-cell { font-family: var(--f-sans); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-mute); }
.supplement-table tr.trade-header td { background: var(--c-navy-soft); color: #fff; font-family: var(--f-sans); font-weight: 700; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; }
.supplement-table tr.trade-subtotal td { background: var(--c-paper-warm); font-family: var(--f-sans); font-weight: 700; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-slate); border-top: 1.5px solid var(--c-navy); }
.supplement-table tr.trade-subtotal td.num { font-family: var(--f-mono); color: var(--c-navy); }
.supplement-table tr.grand-subtotal td { background: var(--c-navy); color: #fff; border-top: 2px solid var(--c-brick); }
.supplement-table tr.grand-subtotal td.stl { font-family: var(--f-sans); font-weight: 700; font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--c-brick-warm); padding: 13px 9px; }
.supplement-table tr.grand-subtotal td.num { font-family: var(--f-serif); font-weight: 600; font-size: 19px; color: #fff; padding: 13px 9px; }

/* carrier status — the ONLY place forest-green / red carry meaning */
.carrier-omitted { display: inline-block; font-family: var(--f-sans); font-size: 8px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-omitted); background: var(--c-omitted-bg); border: 1px solid var(--c-omitted-bd); border-radius: 20px; padding: 3px 9px; }
.carrier-included { display: inline-block; font-family: var(--f-sans); font-size: 8px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-included); background: var(--c-included-bg); border: 1px solid var(--c-included-bd); border-radius: 20px; padding: 3px 9px; }
.supplement-gap-note { font-size: 12px; color: var(--c-slate); margin-top: 10px; display: flex; gap: 10px; align-items: center; }
.supplement-gap-note .gap-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--c-brick); }
.supplement-gap-note b { color: var(--c-omitted); }

.req-only-notice { background: var(--c-paper-warm); border: 1px solid var(--c-line); border-left: 4px solid var(--c-navy); border-radius: 3px; padding: 16px 20px; margin: 18px 0; font-size: 13px; color: var(--c-ink); line-height: 1.55; }
.req-only-list { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
.req-only-list th { background: var(--c-navy); color: #dfe5ee; padding: 10px 12px; text-align: left; font-family: var(--f-sans); font-weight: 700; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 2px solid var(--c-brick); }
.req-only-list td { padding: 9px 12px; border-bottom: 1px solid var(--c-line-soft); color: var(--c-slate); }

/* ── PHASE 3 siding argument (corner-rule flagship) ── */
.siding-argument { margin: 24px 0 10px 0; }
.siding-arg-intro { font-family: var(--f-serif); font-style: italic; font-size: 14px; color: var(--c-slate); line-height: 1.55; padding: 4px 0 6px 0; max-width: 6.2in; }
.siding-arg-intro b { font-style: normal; color: var(--c-navy); font-weight: 600; }
.siding-arg-mode { display: inline-block; font-family: var(--f-sans); font-size: 8px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 9px; border-radius: 20px; margin-left: 4px; vertical-align: middle; }
.siding-arg-mode.contractor { background: var(--c-paper-warm); color: var(--c-slate); border: 1px solid var(--c-line); }
.siding-arg-mode.advocate { background: var(--c-omitted-bg); color: var(--c-brick); border: 1px solid var(--c-omitted-bd); }
.siding-arg-steps { margin-top: 16px; border-top: 1px solid var(--c-line); }
.siding-arg-layer { display: grid; grid-template-columns: 0.56in 1fr; gap: 22px; padding: 22px 0; border-bottom: 1px solid var(--c-line); break-inside: avoid; }
.siding-arg-layer:last-child { border-bottom: 0; }
.siding-arg-layer.hero { background: var(--c-paper-warm); border-radius: 4px; border-bottom: 0; padding: 22px 22px 22px 18px; margin: 4px 0; box-shadow: inset 4px 0 0 var(--c-brick); }
.siding-arg-idx { padding-top: 2px; }
.siding-arg-num { display: inline-block; font-family: var(--f-serif); font-weight: 300; font-size: 44px; line-height: 0.9; color: var(--c-navy); position: relative; }
.siding-arg-num::after { content: ""; display: block; width: 28px; height: 2px; background: var(--c-brick); margin-top: 6px; }
.siding-arg-h { font-family: var(--f-serif); font-size: 18px; font-weight: 600; color: var(--c-navy); margin-bottom: 8px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; letter-spacing: -0.005em; }
.siding-arg-layer p { font-size: 12px; color: var(--c-slate); margin: 7px 0; line-height: 1.62; max-width: 6in; }
.siding-arg-layer p b { color: var(--c-ink); font-weight: 700; }
.siding-arg-note { font-size: 11px; color: var(--c-mute); font-style: italic; }
.siding-corner-hero { font-family: var(--f-serif); font-size: 13px; font-style: italic; color: var(--c-navy); background: #fff; border: 1px solid var(--c-line); border-left: 3px solid var(--c-gold); border-radius: 3px; padding: 12px 16px; margin: 10px 0; line-height: 1.55; }
"""

# Google Fonts link for the three families (Spectral / Libre Franklin / IBM Plex
# Mono). Lives in the document <head>; print engines that ignore web fonts fall
# back to the var()-declared local serif/sans/mono stacks.
COMPLIANCE_FONTS_LINK = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?'
    'family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&'
    'family=Libre+Franklin:wght@400;500;600;700;800&'
    'family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">'
)


def _cite_chip(citation: str, *, neutral: bool = False, on_navy: bool = False) -> str:
    """Render the SPECIFIC code source + citation number as the load-bearing
    .cite-chip anchor used on EVERY code element (cover, requirement detail,
    every priced-table row, every argument step). ``neutral`` = a non-code
    reference (e.g. a standard-of-indemnity tag); ``on_navy`` = placed on a dark
    band. Empty/blank citation renders nothing."""
    text = (citation or "").strip()
    if not text:
        return ""
    cls = "cite-chip"
    if neutral:
        cls += " neutral"
    if on_navy:
        cls += " on-navy"
    return f'<span class="{cls}">{_h(text)}</span>'


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


# Roofing code sections (R905.x) — the counterpart to _SIDING_CODE_SECTIONS,
# used to decide the TRADE-AWARE lead citation. A report whose code scope is
# siding (R703.x) with NO roofing (R905.x) item is a SIDING report and must NOT
# lead with the roofing R905.1 manufacturer-install citation.
_ROOFING_CODE_SECTION_PREFIX = "R905"


def _report_is_siding(config: dict) -> bool:
    """True when the Doc-06 code scope is SIDING with no ROOFING code item — i.e.
    a pure siding report. Drives the trade-aware lead citation (siding → R703.3
    manufacturer-install basis; roofing/mixed → R905.1). Mixed roof+siding stays
    on the roofing lead (the roof is the predominant covered trade and R905.1
    legitimately governs it)."""
    has_siding = bool(_siding_code_items(config))
    if not has_siding:
        return False
    for li in _code_line_items(config):
        cc = li.get("code_citation") or {}
        section = (cc.get("section") or "").strip()
        trade = (li.get("trade") or li.get("category") or "").strip().upper()
        if section.startswith(_ROOFING_CODE_SECTION_PREFIX) or trade == "ROOFING":
            return False
    return True


def _lead_code_basis(config: dict) -> dict:
    """The TRADE-AWARE lead citation for the cover + visual-reference sections.

    Manufacturer installation instructions carry the force of building code under
    BOTH the roofing (R905.1) and siding (R703.3) chapters — but the cited section
    and the noun ("Roofing" vs "Exterior wall coverings") must match the report's
    trade so a SIDING report never leads with a roofing citation."""
    if _report_is_siding(config):
        return {
            "section": "R703.3",
            "noun": "Exterior wall coverings",
            # R703.3.1 / R703.3 (IRC): siding installed per the manufacturer's
            # installation instructions — the siding analogue of R905.1.
            "law_quote": (
                "Exterior wall coverings shall be installed in accordance with "
                "the <b>manufacturer's installation instructions</b>."
            ),
        }
    return {
        "section": "R905.1",
        "noun": "Roofing",
        "law_quote": (
            "Roofing shall be applied in accordance with the "
            "<b>manufacturer's installation instructions</b>."
        ),
    }


def _company_name(config: dict) -> str:
    """Display company name, neutral default so a missing/empty company_name
    doesn't leak USARM branding onto another contractor's PDF (E182)."""
    return (config.get("company", {}) or {}).get("name") or "Your Roofing Company"


def _run_head(config: dict, doc_label: str) -> str:
    """Running header on every interior sheet: company wordmark (left) + the
    document-tab + claim number (right). Keeps the report navigable across pages
    with no stranded captions."""
    company_name = _h(_company_name(config))
    claim_number = _h(config.get("carrier", {}).get("claim_number", "") or "")
    return f'''
    <div class="run-head">
        <div class="rh-mark">{company_name}<span class="rh-sub">Building Code Compliance Report</span></div>
        <div class="rh-r">
            <div class="rh-doc">{_h(doc_label)}</div>
            <div class="rh-claim">{claim_number}</div>
        </div>
    </div>'''


def _run_foot(config: dict, page_label: str) -> str:
    """Running footer on every interior sheet."""
    company_name = _h(_company_name(config))
    return f'''
    <div class="footer">
        <div class="fl">{company_name} &middot; Building Code Compliance Report</div>
        <div>{_h(page_label)}</div>
    </div>'''


def _build_cover_page(config: dict, jurisdiction: dict, annotation_count: int) -> str:
    """Build the full-bleed navy cover page: wordmark + carrier-exhibit tab, big
    serif title, full claim-data grid, and the lead-provision callout with the
    load-bearing phrase emphasized and its citation rendered as a chip."""
    prop = config.get("property", {})
    address = _h(_format_property_address(prop))
    claim_number = _h(config.get("carrier", {}).get("claim_number", ""))
    company_name = _h(_company_name(config))
    date_of_loss = _h(config.get("dates", {}).get("date_of_loss", ""))
    trades = _h(", ".join(config.get("scope", {}).get("trades") or ["Roofing"]))
    ahj = _ahj_header(config)
    base_code = _h(ahj.get("base_code", ""))
    adopted = ahj.get("adopted_year")
    ahj_sub = f"{_h(ahj.get('prefix',''))} &mdash; base code {base_code}" + (f" (adopted {adopted})" if adopted else "")
    # TRADE-AWARE lead: a siding report cites R703.3, a roofing/mixed report R905.1.
    basis = _lead_code_basis(config)
    lead_cite = _cite_chip(f'{jurisdiction["abbrev"]} {basis["section"]}', on_navy=True)
    # Spell out the count so it reads as authored, not auto-generated.
    code_count = f'{annotation_count} applicable code{"s" if annotation_count != 1 else ""}'

    return f'''
    <div class="cover">
        <div class="cover-frame"></div>
        <div class="cover-top">
            <div class="cover-wordmark">{company_name}<span class="wm-sub">Forensic Claims Division</span></div>
            <div class="cover-tab">Document 06 &middot; Carrier Exhibit</div>
        </div>

        <div class="cover-hero">
            <div class="cover-kicker">Forensic Code Analysis</div>
            <h1>Building Code<br>Compliance Report</h1>
            <div class="cover-subtitle">Jurisdiction-Specific Installation Requirements &amp; Manufacturer Specifications</div>

            <div class="lead-callout">
                <div class="lc-label">Governing Provision</div>
                <p>Per {_h(jurisdiction["abbrev"])} {_h(basis["section"])}, governing {basis["noun"]}: "{basis["law_quote"]}"
                Manufacturer instructions carry the <b>force of building code</b> &mdash; they are not optional upgrades.</p>
                <div class="lc-cite">{lead_cite}</div>
            </div>
        </div>

        <div class="cover-meta">
            <div class="cell">
                <div class="k">Property</div>
                <div class="v serif">{address}</div>
            </div>
            <div class="cell">
                <div class="k">Claim Number</div>
                <div class="v mono">{claim_number}</div>
                <div class="k stacked">Date of Loss</div>
                <div class="v">{date_of_loss}</div>
            </div>
            <div class="cell">
                <div class="k">Trades Scoped</div>
                <div class="v">{trades}</div>
                <div class="k stacked">Code Requirements</div>
                <div class="v serif">{code_count}</div>
            </div>
        </div>

        <div class="cover-foot">
            <div class="ahj-stamp">
                <div class="pl">Authority Having Jurisdiction</div>
                <div class="pv">{_h(jurisdiction["name"])}</div>
                <div class="pv-sub">{ahj_sub}</div>
            </div>
            <div class="prep">
                <div class="pl">Prepared by</div>
                <div class="pv">{company_name}</div>
            </div>
        </div>
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
        code_tag = ann.get("code_tag", "")
        title = _h(ann.get("title", ""))
        requirement = _h(cc.get("requirement", ""))
        supplement = _h(cc.get("supplement_argument", ""))
        meas = _h(ann.get("measurement", ""))
        # The exact code source rendered as the load-bearing citation chip.
        cite = _cite_chip(code_tag)

        card = f'''
        <div class="{card_class}">
            <div class="cc-top">{cite}<div class="code-title">{title}</div></div>
            <div class="requirement">{requirement}</div>
            <div class="measurement">EagleView measurement: {meas}</div>
        '''

        # Manufacturer specs
        mfr_specs = cc.get("manufacturer_specs", [])
        for spec in mfr_specs[:3]:
            mfr_name = _h(spec.get("manufacturer", ""))
            doc_name = _h(spec.get("document", ""))
            mfr_req = _h(spec.get("requirement", ""))
            warranty = _h(spec.get("warranty_text", ""))
            is_void = spec.get("warranty_void", False)

            card += f'''
            <div class="mfr-spec">
                <div class="mfr-name">{mfr_name} &mdash; {doc_name}</div>
                <div style="font-size:12px; margin-top:5px; color:var(--c-slate);">{mfr_req}</div>
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

    # Ice & Water Barrier — plan-section (correct layering, 24" dimension callout)
    if "eave-front" in zone_set:
        eave_lf = config.get("measurements", {}).get("eave", 0)
        diagrams.append(f'''
        <div class="diagram-box">
            <div class="diagram-title">Ice &amp; Water Barrier &mdash; Eave Section</div>
            <svg viewBox="0 0 600 184" width="100%" style="max-width:560px;" xmlns="http://www.w3.org/2000/svg">
                <defs><marker id="arrIW" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="#9a2b2f"/></marker></defs>
                <rect x="0" y="0" width="600" height="184" fill="#ffffff"/>
                <!-- Roof deck -->
                <rect x="20" y="104" width="560" height="56" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1.2"/>
                <text x="300" y="138" text-anchor="middle" font-size="9.5" fill="#8a7a55" font-weight="600" letter-spacing="1">ROOF DECK · PLYWOOD / OSB</text>
                <!-- I&W membrane -->
                <rect x="20" y="86" width="350" height="16" fill="#16284f" stroke="#0d1b3e" stroke-width="1.2"/>
                <text x="195" y="98" text-anchor="middle" font-size="9" fill="#ffffff" font-weight="700" letter-spacing="0.5">ICE &amp; WATER BARRIER</text>
                <!-- Shingles -->
                <rect x="20" y="70" width="560" height="14" fill="#b9b2a3" stroke="#9a9182" stroke-width="0.8"/>
                <text x="300" y="81" text-anchor="middle" font-size="8" fill="#3a3528" letter-spacing="1">SHINGLE COURSE</text>
                <!-- Interior wall line -->
                <rect x="350" y="20" width="10" height="140" fill="#d8d2c5" stroke="#9a9182" stroke-width="1"/>
                <text x="368" y="92" font-size="9" fill="#8a93a3" font-style="italic">interior wall</text>
                <!-- 24in dimension -->
                <line x1="22" y1="50" x2="368" y2="50" stroke="#9a2b2f" stroke-width="1.4" marker-start="url(#arrIW)" marker-end="url(#arrIW)"/>
                <text x="195" y="44" text-anchor="middle" font-size="10.5" fill="#9a2b2f" font-weight="700">24&quot; past the interior wall line</text>
                <text x="22" y="34" font-size="9" fill="#0d1b3e" font-weight="600">Eave edge ({eave_lf:.0f} LF)</text>
            </svg>
            <div class="diagram-caption">
                <span class="diagram-correct">Compliant:</span> I&amp;W extends from the eave edge to a minimum 24&quot; past the interior face of the exterior wall.
                <span class="diagram-incorrect">Common omission:</span> the carrier drops I&amp;W entirely or limits it to the eave edge only.
            </div>
        </div>''')

    # House Wrap Corner Detail — clean PLAN-SECTION (compliant vs non-compliant,
    # leader-line callouts, 6" wrap dimension). The flagship corner-rule plate.
    if "corner" in zone_set or "wall-front" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">House Wrap (WRB) &mdash; Outside-Corner Plan Section (DuPont Tyvek)</div>
            <svg viewBox="0 0 600 300" width="100%" style="max-width:560px;" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <pattern id="hatchOk" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                        <rect width="7" height="7" fill="#e6efe8"/><line x1="0" y1="0" x2="0" y2="7" stroke="#1f6b4a" stroke-width="1"/>
                    </pattern>
                    <pattern id="hatchBad" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                        <rect width="7" height="7" fill="#f5dede"/><line x1="0" y1="0" x2="0" y2="7" stroke="#9a2b2f" stroke-width="1"/>
                    </pattern>
                    <marker id="arrOx" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="#9a2b2f"/></marker>
                    <marker id="arrNv" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="#0d1b3e"/></marker>
                </defs>
                <rect x="0" y="0" width="600" height="300" fill="#ffffff"/>
                <line x1="300" y1="34" x2="300" y2="278" stroke="#d8d2c5" stroke-width="1" stroke-dasharray="3 3"/>
                <text x="150" y="24" text-anchor="middle" font-size="10.5" font-weight="800" letter-spacing="2" fill="#1f6b4a">COMPLIANT</text>
                <text x="150" y="35" text-anchor="middle" font-size="7.5" letter-spacing="1.5" fill="#4a5568">CONTINUOUS WRAP</text>
                <text x="450" y="24" text-anchor="middle" font-size="10.5" font-weight="800" letter-spacing="2" fill="#9a2b2f">NON-COMPLIANT</text>
                <text x="450" y="35" text-anchor="middle" font-size="7.5" letter-spacing="1.5" fill="#4a5568">TERMINATES AT CORNER</text>

                <!-- LEFT: COMPLIANT plan of outside corner -->
                <g>
                    <rect x="60" y="110" width="120" height="22" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                    <rect x="158" y="110" width="22" height="120" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                    <text x="100" y="105" font-size="7" fill="#8a93a3" letter-spacing="1">SHEATHING</text>
                    <!-- WRB hatch band turning the corner continuously -->
                    <path d="M60 100 L176 100 Q184 100 184 108 L184 232 L177 232 L177 112 Q177 108 173 108 L60 108 Z" fill="url(#hatchOk)" stroke="#1f6b4a" stroke-width="0.8"/>
                    <path d="M60 104 L173 104 Q177 104 177 108 L177 232" fill="none" stroke="#1f6b4a" stroke-width="3" stroke-linecap="round"/>
                    <!-- corner post over the wrap -->
                    <path d="M153 80 L189 80 L189 116 L177 116 L177 92 L165 92 L165 80 Z" fill="#0d1b3e" opacity="0.92"/>
                    <text x="205" y="76" font-size="7.5" fill="#0d1b3e" font-weight="700">CORNER POST</text>
                    <line x1="203" y1="78" x2="183" y2="92" stroke="#0d1b3e" stroke-width="1" marker-end="url(#arrNv)"/>
                    <!-- 6in wrap callout -->
                    <path d="M124 140 A 30 30 0 0 1 154 170" fill="none" stroke="#9a2b2f" stroke-width="1.2" stroke-dasharray="2 2"/>
                    <text x="86" y="192" font-size="9" fill="#9a2b2f" font-weight="800">Min 6 in. wrap</text>
                    <line x1="120" y1="188" x2="140" y2="168" stroke="#9a2b2f" stroke-width="1" marker-end="url(#arrOx)"/>
                    <text x="66" y="262" font-size="7.5" fill="#1f6b4a" font-weight="700">WATER SHEDS OUTWARD</text>
                    <line x1="40" y1="278" x2="220" y2="278" stroke="#c9bfa8" stroke-width="1.4"/>
                </g>

                <!-- RIGHT: NON-COMPLIANT -->
                <g>
                    <rect x="360" y="110" width="120" height="22" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                    <rect x="458" y="110" width="22" height="120" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                    <path d="M360 100 L478 100 L478 108 L360 108 Z" fill="url(#hatchBad)" stroke="#9a2b2f" stroke-width="0.8"/>
                    <path d="M360 104 L478 104" fill="none" stroke="#9a2b2f" stroke-width="3" stroke-linecap="round"/>
                    <path d="M478 108 L478 232" fill="none" stroke="#9a2b2f" stroke-width="1.5" stroke-dasharray="4 3"/>
                    <circle cx="478" cy="146" r="12" fill="none" stroke="#9a2b2f" stroke-width="1.4"/>
                    <text x="494" y="143" font-size="7.5" fill="#9a2b2f" font-weight="800">BARE</text>
                    <text x="494" y="153" font-size="7.5" fill="#9a2b2f" font-weight="800">CORNER JOINT</text>
                    <path d="M453 80 L489 80 L489 116 L478 116 L478 92 L466 92 L466 80 Z" fill="#0d1b3e" opacity="0.55"/>
                    <line x1="516" y1="196" x2="482" y2="172" stroke="#9a2b2f" stroke-width="2" marker-end="url(#arrOx)"/>
                    <text x="494" y="210" font-size="8" fill="#9a2b2f" font-weight="800">MOISTURE</text>
                    <text x="494" y="221" font-size="8" fill="#9a2b2f" font-weight="800">INFILTRATION</text>
                    <text x="368" y="262" font-size="7.5" fill="#9a2b2f" font-weight="700">WATER ENTERS WALL CAVITY</text>
                    <line x1="340" y1="278" x2="520" y2="278" stroke="#c9bfa8" stroke-width="1.4"/>
                </g>
                <text x="40" y="294" font-size="6.5" fill="#8a93a3" letter-spacing="1.5">PLAN VIEW · OUTSIDE CORNER · NOT TO SCALE</text>
            </svg>
            <div class="plate-legend">
                <div class="leg"><span class="chip ok"></span><span class="lt"><b>Compliant</b>WRB turns the corner under the post &mdash; one continuous membrane sheds water outward.</span></div>
                <div class="leg"><span class="chip bad"></span><span class="lt"><b>Non-Compliant</b>WRB stops at the corner edge &mdash; the joint is bare and water enters the cavity.</span></div>
            </div>
            <div class="diagram-caption">
                Per <b>R703.2</b>: Weather-resistive barrier (WRB) must be continuous. At outside corners,
                house wrap must extend a <b>minimum of 6 in.</b> around the corner (DuPont Tyvek installation
                instructions) and be installed <b>under</b> the corner post. This requires removal of adjacent
                wall siding &mdash; a single-wall repair is <b>not code-compliant</b>.
            </div>
        </div>''')

    # Drip Edge — eaves vs rakes plan-section
    if "rake-left" in zone_set or "rake-right" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">Drip Edge &mdash; Eaves vs. Rakes</div>
            <svg viewBox="0 0 600 168" width="100%" style="max-width:560px;" xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="600" height="168" fill="#ffffff"/>
                <line x1="300" y1="14" x2="300" y2="120" stroke="#d8d2c5" stroke-width="1" stroke-dasharray="3 3"/>
                <!-- Eave detail (left) -->
                <text x="135" y="24" text-anchor="middle" font-size="11" fill="#0d1b3e" font-weight="700" letter-spacing="1">AT EAVES</text>
                <rect x="35" y="64" width="200" height="12" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                <text x="135" y="74" text-anchor="middle" font-size="7.5" fill="#8a7a55">DECK</text>
                <rect x="30" y="59" width="210" height="4" fill="#9a2b2f"/>
                <text x="135" y="53" text-anchor="middle" font-size="8.5" fill="#9a2b2f" font-weight="700">DRIP EDGE (under I&amp;W)</text>
                <rect x="35" y="44" width="200" height="14" fill="#16284f"/>
                <text x="135" y="54" text-anchor="middle" font-size="7.5" fill="white" font-weight="600">I&amp;W</text>
                <rect x="35" y="32" width="200" height="11" fill="#b9b2a3"/>
                <text x="135" y="40" text-anchor="middle" font-size="6.5" fill="#3a3528">SHINGLES</text>
                <text x="135" y="104" text-anchor="middle" font-size="9.5" fill="#1f6b4a" font-weight="700">Drip edge UNDER I&amp;W</text>
                <!-- Rake detail (right) -->
                <text x="450" y="24" text-anchor="middle" font-size="11" fill="#0d1b3e" font-weight="700" letter-spacing="1">AT RAKES</text>
                <rect x="350" y="64" width="200" height="12" fill="#efe9dd" stroke="#c9bfa8" stroke-width="1"/>
                <text x="450" y="74" text-anchor="middle" font-size="7.5" fill="#8a7a55">DECK</text>
                <rect x="350" y="44" width="200" height="14" fill="#cbc3b2"/>
                <text x="450" y="54" text-anchor="middle" font-size="7.5" fill="#3a3528">UNDERLAYMENT</text>
                <rect x="345" y="39" width="210" height="4" fill="#9a2b2f"/>
                <text x="450" y="33" text-anchor="middle" font-size="8.5" fill="#9a2b2f" font-weight="700">DRIP EDGE (over underlayment)</text>
                <rect x="350" y="28" width="200" height="11" fill="#b9b2a3"/>
                <text x="450" y="36" text-anchor="middle" font-size="6.5" fill="#3a3528">SHINGLES</text>
                <text x="450" y="104" text-anchor="middle" font-size="9.5" fill="#1f6b4a" font-weight="700">Drip edge OVER underlayment</text>
                <text x="300" y="146" text-anchor="middle" font-size="9.5" fill="#4a5568">Per R905.2.8.5: Drip edge shall be provided at eaves AND gable rake edges.</text>
                <text x="300" y="161" text-anchor="middle" font-size="9.5" fill="#9a2b2f" font-weight="600">Carriers commonly omit drip edge at rakes — a code violation.</text>
            </svg>
        </div>''')

    # Starter strip at eaves AND rakes
    if "eave-front" in zone_set:
        diagrams.append('''
        <div class="diagram-box">
            <div class="diagram-title">Starter Course &mdash; Required at Eaves AND Rakes</div>
            <svg viewBox="0 0 600 148" width="100%" style="max-width:560px;" xmlns="http://www.w3.org/2000/svg">
                <rect x="0" y="0" width="600" height="148" fill="#ffffff"/>
                <polygon points="300,18 55,122 545,122" fill="#eef0f4" stroke="#0d1b3e" stroke-width="1.6"/>
                <line x1="62" y1="120" x2="538" y2="120" stroke="#1f6b4a" stroke-width="6"/>
                <text x="300" y="139" text-anchor="middle" font-size="9.5" fill="#1f6b4a" font-weight="700">STARTER AT EAVE (carriers usually include)</text>
                <line x1="62" y1="120" x2="295" y2="21" stroke="#9a2b2f" stroke-width="6" stroke-dasharray="8,4"/>
                <line x1="538" y1="120" x2="305" y2="21" stroke="#9a2b2f" stroke-width="6" stroke-dasharray="8,4"/>
                <text x="142" y="58" font-size="9.5" fill="#9a2b2f" font-weight="700" transform="rotate(-35, 142, 58)">STARTER AT RAKE</text>
                <text x="458" y="58" font-size="9.5" fill="#9a2b2f" font-weight="700" transform="rotate(35, 458, 58)">STARTER AT RAKE</text>
            </svg>
            <div class="diagram-caption">
                Per manufacturer installation instructions (force of law under R905.1): Starter course is required
                at <b>both eaves AND rakes</b>. Carriers commonly only include starter at eaves &mdash; omitting rakes
                is a <b>code violation</b> that voids the manufacturer warranty.
            </div>
        </div>''')

    return "\n".join(diagrams)


def _section_items_with_status(config: dict) -> dict:
    """Map a code SECTION → list of {desc, title, status} for every code line item
    under that section, where ``status`` is the SAME per-item carrier resolution
    the priced supplement table renders (from _carrier_status_map). Facet
    duplicates are de-duplicated by description so a section that appears once per
    facet is collapsed to its distinct items."""
    status_map = _carrier_status_map(config)
    out: dict = {}
    for li in _code_line_items(config):
        cc = li.get("code_citation") or {}
        section = (cc.get("section") or "").strip()
        if not section:
            continue
        desc = (li.get("description") or "").strip()
        bucket = out.setdefault(section, [])
        if any(b["desc"].lower() == desc.lower() for b in bucket):
            continue  # de-dup facet repeats
        bucket.append({
            "desc": desc,
            "title": cc.get("title") or "",
            "status": status_map.get(desc.lower()),  # None when unmatched
        })
    return out


def _summary_status_for_annotation(section: str, ann_title: str,
                                   section_items: dict) -> str | None:
    """PHASE 2 FIX 2 — RECONCILE the pg-6 summary table with the priced table.

    The summary table is built from code ANNOTATIONS (one per code requirement),
    but a single code SECTION can cover MULTIPLE distinct line items with
    DIFFERENT carrier statuses — e.g. R905.1.2 covers both the Ice & Water
    Barrier (carrier Included) AND the felt underlayment (carrier OMITTED). The
    old section-level worst-case aggregation ('omitted > included') made the
    summary say "Ice & Water Barrier — OMITTED" while the priced line for the
    actual I&W item said Included — a within-document contradiction.

    This resolves the summary status from the SAME per-item resolution the priced
    table uses, MATCHED to the specific item the annotation names:

      1. Token-match the annotation title to each item under the section. If one
         item matches strictly better than the rest, return ITS status — so the
         summary agrees with that item's priced row by construction (the I&W
         annotation matches the I&W item → Included, not the felt's OMITTED).
      2. If items tie or none token-overlaps the title, fall back to a
         NON-CONTRADICTING consensus: if every item under the section shares one
         status, use it; if they disagree, return None (neutral '—'). We NEVER
         surface OMITTED for a section whose annotation-matched item is Included.

    Returns 'omitted' | 'included' | None (neutral)."""
    items = section_items.get((section or "").strip())
    if not items:
        return None

    tt = _cr_tokens(ann_title)
    best, best_ov = None, -1.0
    tie = False
    if tt:
        for it in items:
            td = _cr_tokens(it["desc"]) | _cr_tokens(it.get("title") or "")
            ov = len(tt & td) / max(1, min(len(tt), len(td))) if td else 0.0
            if ov > best_ov:
                best, best_ov, tie = it, ov, False
            elif ov == best_ov:
                tie = True

    # Clear single best match with real overlap → use ITS status (matches the
    # priced row for that exact item; resolves the I&W contradiction).
    if best is not None and best_ov > 0 and not tie:
        return best["status"]

    # No discriminating title match (no overlap, or a genuine tie). Fall back to
    # a consensus that can never contradict a priced Included row.
    statuses = {it["status"] for it in items}
    if statuses == {"included"}:
        return "included"
    if statuses == {"omitted"}:
        return "omitted"
    # Mixed or all-neutral → neutral (assert nothing; the itemized priced
    # supplement carries the per-item truth).
    return None


def _build_summary_table(annotations: list[dict], config: dict) -> str:
    """Build the summary table of all applicable codes.

    WS-7: when a carrier scope is present, the previously-dropped carrier-
    omission status is wired into a real "Carrier Scope" column (INCLUDED vs
    OMITTED) instead of the old "VERIFY" placeholder."""
    carrier_present = carrier_scope_present(config)
    # PHASE 2 FIX 2 — resolve the summary's carrier status from the SAME per-item
    # resolution the priced table uses, MATCHED to the specific item each
    # annotation names (so a section spanning an Included item AND an OMITTED item
    # never shows the wrong one against its own priced line).
    section_items = _section_items_with_status(config) if carrier_present else {}

    rows = []
    for ann in annotations:
        cc = ann.get("full_citation", {})
        mfr_specs = cc.get("manufacturer_specs", [])
        mfr_names = ", ".join(s.get("manufacturer", "") for s in mfr_specs[:2]) if mfr_specs else "—"
        has_void = any(s.get("warranty_void") for s in mfr_specs)

        carrier_cell = ""
        if carrier_present:
            section = (cc.get("section") or "").strip()
            # Match the annotation to its specific item; status == the priced
            # row's status for that item (no within-document contradiction).
            state = _summary_status_for_annotation(
                section, ann.get("title", ""), section_items
            )
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
            <td>{_cite_chip(ann.get("code_tag", ""))}</td>
            <td>{_h(ann.get("title", ""))}</td>
            <td style="font-family:var(--f-mono); color:var(--c-ink);">{_h(ann.get("measurement", ""))}</td>
            <td>{_h(mfr_names)}</td>
            <td>{"WARRANTY VOID" if has_void else "&mdash;"}</td>
            {carrier_cell}
        </tr>''')

    carrier_th = "<th>Carrier Scope</th>" if carrier_present else ""

    return f'''
    <div class="sec-eyebrow">Schedule of Applicable Codes</div>
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
    </table>'''


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


def _aggregate_facet_rows(items: list) -> list:
    """PHASE 2 FIX 1 — collapse the per-facet line-item rows of ONE code item into
    a single display row, preserving the subset invariant EXACTLY.

    Today each code line item is emitted once per roof facet (the generator
    splits area by facet), so 'Remove laminated comp shingle roofing' appears 3–4
    times. Group those facet rows by (code_section, description, unit, unit_price)
    — the identity tuple that makes two facet rows "the same item at the same
    price" — and SUM the quantity.

    The displayed Line Total is the SUM of each facet's own
    ``round(qty*unit_price, 2)`` (i.e. the identical per-item rounding Doc 02
    applies), NOT ``round(sum(qty)*unit_price, 2)``. Those two differ by up to a
    cent per group under banker's-cent rounding; using the per-facet sum keeps the
    aggregated subtotal byte-for-byte equal to the sum of the SAME line_items as
    Doc 02 computes them (the non-negotiable subset invariant) while the Qty
    column still shows the true total quantity. We aggregate the DISPLAY, never
    the math.

    Grouping is STABLE (first-seen order preserved) so the table order matches the
    pre-aggregation order minus the duplicates. Returns a list of dicts:
    {section, requirement, desc, unit, unit_price, qty, line_total}.
    """
    order: list = []
    groups: dict = {}
    for li in items:
        qty = float(li.get("qty", 0) or 0)
        unit_price = float(li.get("unit_price", 0) or 0)
        desc = li.get("description", "")
        unit = li.get("unit", "")
        section = _code_section(li)
        cc = li.get("code_citation") or {}
        requirement = cc.get("requirement") or cc.get("title") or ""
        # Identity tuple: same item, same code section, same unit, same price.
        key = (section, desc, unit, round(unit_price, 6))
        grp = groups.get(key)
        if grp is None:
            grp = {
                "section": section,
                "requirement": requirement,
                "desc": desc,
                "unit": unit,
                "unit_price": unit_price,
                "qty": 0.0,
                "line_total": 0.0,
            }
            groups[key] = grp
            order.append(grp)
        grp["qty"] += qty
        # Σ of the per-facet rounded extension — identical to Doc 02's running sum.
        grp["line_total"] = round(grp["line_total"] + round(qty * unit_price, 2), 2)
    return order


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
    aggregated_row_count = 0
    body_rows = []

    # Column count drives colspans (carrier column only when a scope is present).
    n_cols = 8 if carrier_present else 7

    for trade in sorted(groups, key=lambda t: _CAT_ORDER.get(t, 99)):
        items = groups[trade]
        body_rows.append(
            f'<tr class="trade-header"><td colspan="{n_cols}">{_h(trade)}</td></tr>'
        )
        trade_subtotal = 0.0

        # PHASE 2 FIX 1 — AGGREGATE THE DISPLAY BY ITEM. The same code item
        # repeats once per roof facet (e.g. 'Remove laminated comp shingle' ×4
        # facets), bloating the table to 25 rows / 3 pages. Group the facet rows
        # of a single item and show it ONCE with the summed qty. CRITICAL: we
        # aggregate the DISPLAY, never the math — the displayed Line Total is the
        # SUM of each facet's own round(qty*price,2) (exactly how Doc 02 sums),
        # NOT round(sum(qty)*price,2). Those can differ by a cent under rounding;
        # using the per-facet sum keeps the subtotal byte-for-byte equal to the
        # Doc-02 subset (the subset invariant) while the qty column still shows
        # the true total quantity.
        agg = _aggregate_facet_rows(items)
        aggregated_row_count += len(agg)
        for grp in agg:
            qty = grp["qty"]                       # summed across facets
            unit_price = grp["unit_price"]
            line_total = grp["line_total"]         # Σ round(facet_qty*price,2)
            subtotal += line_total
            trade_subtotal += line_total

            section = grp["section"]
            requirement = grp["requirement"]
            desc = grp["desc"]
            unit = grp["unit"]

            carrier_cell = ""
            if carrier_present:
                # Carrier status per AGGREGATED row = the row's resolved per-item
                # status (all facets of one item share a description, so they
                # share a status; the contradiction guard in _carrier_status_map
                # already defaults disagreement to the conservative neutral).
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

            # Code Section cell: keep the literal `<td><b>` opening (the
            # data-row marker the aggregation tests count) and render the EXACT
            # code source inside it as the load-bearing citation chip.
            body_rows.append(f'''<tr>
                <td><b>{_cite_chip(section)}</b></td>
                <td>{_h(requirement)}</td>
                <td class="item-desc">{_h(desc)}</td>
                <td class="num">{qty:g}</td>
                <td class="unit-cell">{_h(unit)}</td>
                <td class="num">{_money(unit_price)}</td>
                <td class="num line-total">{_money(line_total)}</td>
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
            f'<tr class="grand-subtotal"><td class="stl" colspan="{n_cols-2}">CODE-COMPLIANCE SUPPLEMENT SUBTOTAL</td>'
            f'<td class="num">{_money(subtotal)}</td><td></td></tr>'
        )
    else:
        body_rows.append(
            f'<tr class="grand-subtotal"><td class="stl" colspan="{n_cols-1}">CODE-COMPLIANCE SUPPLEMENT SUBTOTAL</td>'
            f'<td class="num">{_money(subtotal)}</td></tr>'
        )

    carrier_th = "<th>Carrier Scope</th>" if carrier_present else ""
    adopted = f" (adopted {ahj['adopted_year']})" if ahj.get("adopted_year") else ""

    html = f'''
    <div class="sec-eyebrow">Attribution Schedule</div>
    <h2>Code-Compliance Supplement &mdash; Priced</h2>

    <div class="ahj-header" data-ahj="true">
        <div class="ahj-l">
            <div class="ahj-title">Authority</div>
            <div class="ahj-prefix">{_h(ahj['prefix'])}</div>
        </div>
        <div class="ahj-r">
            <div class="ahj-title" style="color:var(--c-slate); margin-bottom:5px;">Authority Having Jurisdiction &amp; Code Edition</div>
            <div class="ahj-body">{_h(ahj['jurisdiction'])} ({_h(ahj['prefix'])}) &mdash; base code {_h(ahj['base_code'])}{_h(adopted)}</div>
        </div>
    </div>

    <div class="non-additive-banner" data-attribution-view="true">
        <span class="na-badge">Not Additive</span>
        <p><b>These items are already included in the Xactimate estimate (Document #2).</b>
        This supplement isolates the code-mandated subset of that estimate &mdash; it is an
        <b>attribution view, not additional money</b>. The subtotal below equals the sum of these same
        line items in the Xactimate estimate and must never be added to it.</p>
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
            f'<div class="supplement-gap-note"><span class="gap-dot"></span><div>'
            f'<b>{omitted_count} code-mandated item(s)</b> are '
            f'omitted from the carrier scope &mdash; these are the supplement gap.</div></div>'
        )

    # PHASE 3 — the siding argument is NARRATIVE; it does NOT touch the priced
    # subtotal/subset. Returned as a SEPARATE key so the subset-invariant tests
    # never reason about argument prose. The full report (build_compliance_report)
    # places it on its own page after the table.
    siding_argument = _build_siding_argument(config)

    return {
        "html": html,
        "siding_argument": siding_argument,
        "has_siding_argument": bool(siding_argument),
        "subtotal": round(subtotal, 2),
        # row_count = the UNDERLYING code line-item subset (one per facet); this
        # is what the subset-invariant + scope-timing tests reason about and must
        # NOT change when the DISPLAY is aggregated.
        "row_count": len(code_items),
        # aggregated_row_count = the number of DISPLAY rows actually rendered
        # after collapsing per-facet duplicates (PHASE 2 FIX 1).
        "aggregated_row_count": aggregated_row_count,
        "omitted_count": omitted_count,
        "is_attribution_view": True,
        "carrier_present": carrier_present,
    }


# ── PHASE 3 — THE SIDING ARGUMENT (the flagship corner-rule narrative) ──
#
# Renders the role- and state-gated siding argument block beneath the priced
# supplement. The ARGUMENT ORDER is invariant and load-bearing:
#   (1) DAMAGE — always #1, the covered peril (anchored on the forensic siding-
#       damage finding; NEVER lead with code).
#   (2) CODE COMPLIANCE — the corner rule (R703.1/R703.2) forces the full
#       elevation; R703.4 wall flashing is disturbed and must be replaced. HERO.
#   (3) REASONABLE / UNIFORM APPEARANCE — matching (new cladding cannot match
#       weathered), STATE-GATED: no-statute (NY/PA/NJ) = MDL-902 industry
#       evidence only; statute states = cite the rule directly.
#   (4) DIMINISHED VALUE — indemnity makes the insured whole; paying 1–2 of 4
#       elevations leaves a carrier-created patchwork.
#
# UPPA GATING (compliance.user_role): advocacy verbs (demand / required-as-
# obligation / on behalf of) are PA/attorney/public_adjuster/homeowner ONLY. In
# CONTRACTOR mode (USARM default) the same facts are stated FACTUALLY with no
# advocacy/demand language (CLAUDE.md UPPA rules).

# Siding code sections (R703.x) — used to detect that a siding scope is present
# on the code line items so the siding argument only renders for siding claims.
_SIDING_CODE_SECTIONS = frozenset({"R703.1", "R703.2", "R703.3", "R703.4", "R703.8"})


def _siding_code_items(config: dict) -> list:
    """The code line items that belong to the siding/exterior-wall trade — a
    siding code citation (R703.x) OR a SIDING trade/category. Used both to detect
    siding presence and to drive the argument's anchor list."""
    out = []
    for li in _code_line_items(config):
        cc = li.get("code_citation") or {}
        section = (cc.get("section") or "").strip()
        trade = (li.get("trade") or li.get("category") or "").strip().upper()
        if section in _SIDING_CODE_SECTIONS or trade == "SIDING":
            out.append(li)
    return out


def _can_advocate(config: dict) -> bool:
    """UPPA gate — True only for roles licensed to advocate (PA / attorney /
    public_adjuster / homeowner-on-own-claim). Contractor (USARM default) =
    False: state code requirements are stated FACTUALLY, no advocacy/demand."""
    role = ((config.get("compliance") or {}).get("user_role") or "contractor").strip().lower()
    return role in ("public_adjuster", "attorney", "homeowner")


def _siding_damage_anchor(config: dict) -> str:
    """The forensic siding-DAMAGE sentence the DAMAGE layer leads with. Prefer the
    forensic damage_summary, then executive_summary, then a structural fallback
    derived from the storm-damaged elevations. NEVER returns code language — the
    damage layer is the covered-peril anchor, not the code argument."""
    ff = config.get("forensic_findings", {}) or {}
    for key in ("damage_summary", "executive_summary"):
        val = ff.get(key)
        if isinstance(val, list):
            val = " ".join(str(p) for p in val)
        if isinstance(val, str) and "siding" in val.lower():
            return val.strip()
    # Structural fallback: name the damaged elevations.
    elevs = ((config.get("walls") or {}).get("elevations")) or []
    damaged = [e.get("name") for e in elevs if e.get("siding_damaged") and e.get("name")]
    if damaged:
        return (
            f"Storm-consistent impact damage to the siding is documented on the "
            f"{', '.join(damaged)} elevation(s) (the covered peril)."
        )
    return "Storm-consistent impact damage to the siding is documented (the covered peril)."


def _build_siding_argument(config: dict) -> str:
    """Render the role- and state-gated siding argument block (DAMAGE → CODE →
    APPEARANCE → DIMINISHED VALUE, corner rule as the hero). Returns '' when the
    claim has no siding code scope."""
    siding_items = _siding_code_items(config)
    if not siding_items:
        return ""

    from building_codes import lookup as _bc
    state = (config.get("property", {}) or {}).get("state", "NY")
    doctrine = _bc.get_house_wrap_doctrine(state)
    has_statute = _bc.has_matching_statute(state)
    advocate = _can_advocate(config)
    role = ((config.get("compliance") or {}).get("user_role") or "contractor").strip().lower()

    sections = doctrine.get("sections", {}) or {}
    corner_sec = sections.get("corner_rule", "R703.1")
    wrb_sec = sections.get("wrb", "R703.2")
    flash_sec = sections.get("wall_flashing", "R703.4")
    code_ref = doctrine.get("code_ref", "R703.1 / R703.2")
    supplement_sentence = doctrine.get("supplement_sentence", "")
    matching = doctrine.get("matching", {}) or {}
    naic_ref = matching.get("naic_reference", "NAIC MDL-902 §9.A(2)")

    damage_anchor = _siding_damage_anchor(config)

    # ── Layer 1 — DAMAGE (always #1; the covered peril). ──
    # The trailing clause names ONLY the layers that follow: advocate mode chains
    # into code/appearance/indemnity; contractor mode chains into the code basis
    # only (the appearance/indemnity advocacy layers are dropped, so naming them
    # here would dangle).
    damage_followon = (
        "the code, appearance, and indemnity points below all follow from it."
        if advocate else
        "the code basis below follows from it."
    )
    layer_damage = (
        f'<div class="siding-arg-layer" data-arg-order="1" data-arg-layer="damage">'
        f'<div class="siding-arg-idx"><span class="siding-arg-num">1</span></div>'
        f'<div class="siding-arg-body">'
        f'<div class="siding-arg-h">Storm Damage {_cite_chip("The Covered Peril", neutral=True)}</div>'
        f'<p>{_h(damage_anchor)} This is the loss that triggers coverage; {damage_followon}</p>'
        f'</div></div>'
    )

    # ── Layer 2 — CODE COMPLIANCE (the corner-rule HERO). Verb-gated by role. ──
    if advocate:
        code_lead = (
            f'A code-compliant repair <b>requires</b> a continuous water-resistive '
            f'barrier ({wrb_sec}) that wraps the outside corners ({corner_sec}).'
        )
        code_close = (
            f'Because the barrier cannot be reinstalled on the approved elevation '
            f'without wrapping the outside corner &mdash; which requires removing the '
            f'corner trim and disturbing the connecting elevation&rsquo;s siding &mdash; '
            f'full-elevation siding replacement is <b>code-required, not additional '
            f'scope</b>. Wall flashing at openings and penetrations ({flash_sec}) is '
            f'disturbed when siding is removed and must be replaced.'
        )
    else:
        # CONTRACTOR — factual code statement, NO advocacy/demand verbs.
        code_lead = (
            f'Under {code_ref}, a code-compliant exterior-wall installation includes a '
            f'continuous water-resistive barrier ({wrb_sec}) that wraps the outside '
            f'corners ({corner_sec}).'
        )
        code_close = (
            f'Because the barrier is continuous and cannot terminate at a corner joint, '
            f'reinstalling it on the approved elevation involves wrapping the outside '
            f'corner; doing so involves removing the corner trim, which disturbs the '
            f'connecting elevation&rsquo;s siding. Wall flashing at openings and '
            f'penetrations ({flash_sec}) is disturbed when siding is removed and is '
            f'replaced as part of a code-compliant installation. These are code-driven '
            f'installation methods, stated for the file.'
        )
    hero_sentence = (
        f'<div class="siding-corner-hero">{_h(supplement_sentence)}</div>'
        if supplement_sentence else ""
    )
    layer_code = (
        f'<div class="siding-arg-layer hero" data-arg-order="2" data-arg-layer="code">'
        f'<div class="siding-arg-idx"><span class="siding-arg-num">2</span></div>'
        f'<div class="siding-arg-body">'
        f'<div class="siding-arg-h">Code Compliance &mdash; The Corner Rule '
        f'{_cite_chip(corner_sec)} {_cite_chip(wrb_sec)}</div>'
        f'<p>{code_lead}</p>'
        f'{hero_sentence}'
        f'<p>{code_close}</p>'
        f'</div></div>'
    )

    # ── Layers 3 & 4 are ADVOCACY-ONLY (UPPA, owner-mandated) ──
    #
    # ③ matching / reasonable-appearance and ④ diminished-value / indemnity are
    # CLAIM ADVOCACY — arguing what the policy owes and what makes the insured
    # whole. For a contractor that IS public adjusting (UPPA-prohibited). So the
    # contractor render emits ONLY the two factual, contractor-safe layers
    # (① DAMAGE + ② CODE / the corner rule). PA / attorney / homeowner — whose
    # JOB is advocacy — get the full four. The step COUNT is therefore variable:
    # 2 in contractor mode, 4 in advocate mode.
    layer_appearance = ""
    layer_dv = ""
    if advocate:
        # ── Layer 3 — REASONABLE / UNIFORM APPEARANCE (matching). STATE-GATED. ──
        # In no-statute states (NY/PA/NJ) matching is framed as INDUSTRY EVIDENCE
        # of the "like kind and quality" standard; statute states cite the rule.
        if has_statute:
            match_framing = matching.get("statute_framing", "")
            match_note = (
                f'This jurisdiction has adopted a matching standard, cited directly above '
                f'({_h(naic_ref)}).'
            )
        else:
            match_framing = matching.get("no_statute_framing", "")
            # NO-statute states (NY/PA/NJ): MDL-902 is INDUSTRY EVIDENCE ONLY.
            match_note = (
                f'In this jurisdiction there is no matching statute; {_h(naic_ref)} is cited '
                f'as <b>industry evidence</b> of the policy&rsquo;s &ldquo;like kind and quality&rdquo; '
                f'standard, not as an enforceable regulation.'
            )
        match_lead = (
            'New cladding cannot match the weathered existing siding, so a partial '
            'repair leaves a visible mismatch that <b>does not satisfy</b> the policy&rsquo;s '
            '&ldquo;like kind and quality&rdquo; loss-settlement obligation.'
        )
        layer_appearance = (
            f'<div class="siding-arg-layer" data-arg-order="3" data-arg-layer="appearance" '
            f'data-matching-statute="{"true" if has_statute else "false"}">'
            f'<div class="siding-arg-idx"><span class="siding-arg-num">3</span></div>'
            f'<div class="siding-arg-body">'
            f'<div class="siding-arg-h">Reasonable &amp; Uniform Appearance '
            f'{_cite_chip(naic_ref, neutral=True)}</div>'
            f'<p>{match_lead}</p>'
            f'<p>{_h(match_framing)}</p>'
            f'<p class="siding-arg-note">{match_note}</p>'
            f'</div></div>'
        )

        # ── Layer 4 — DIMINISHED VALUE (indemnity). Advocacy-only. ──
        dv_body = (
            'Indemnity <b>requires</b> making the insured whole &mdash; restoring the '
            'pre-loss financial position, not merely effecting a physical repair. '
            'Approving 1&ndash;2 of 4 elevations leaves a permanent patchwork &mdash; a '
            'carrier-created diminished value that is the opposite of indemnity. Full '
            'replacement is required to restore both the physical and financial pre-loss '
            'condition.'
        )
        layer_dv = (
            f'<div class="siding-arg-layer" data-arg-order="4" data-arg-layer="diminished_value">'
            f'<div class="siding-arg-idx"><span class="siding-arg-num">4</span></div>'
            f'<div class="siding-arg-body">'
            f'<div class="siding-arg-h">Diminished Value &amp; Indemnity '
            f'{_cite_chip("Standard of Indemnity", neutral=True)}</div>'
            f'<p>{dv_body}</p>'
            f'</div></div>'
        )

    role_badge = (
        '<span class="siding-arg-mode advocate">Advocacy mode</span>'
        if advocate else
        '<span class="siding-arg-mode contractor">Contractor mode &mdash; factual code statement (no advocacy)</span>'
    )

    # Heading is role-aware: contractor states the code basis factually; advocate
    # frames it as the required outcome.
    heading = (
        'Siding &mdash; Full-Elevation Replacement Required by the Corner Rule'
        if advocate else
        'Siding &mdash; Code Basis for Full-Elevation Replacement'
    )

    # The intro names ONLY the layers that actually render: advocate gets the full
    # four-step chain; contractor gets the two factual layers (matching /
    # diminished-value are advocacy and are dropped entirely in contractor mode).
    if advocate:
        intro = (
            f'<p class="siding-arg-intro">The siding scope is supported in this order: '
            f'<b>damage</b> (the covered peril) &rarr; <b>code compliance</b> (the corner '
            f'rule) &rarr; <b>reasonable appearance</b> (matching) &rarr; <b>diminished '
            f'value</b> (indemnity). {role_badge}</p>'
        )
    else:
        intro = (
            f'<p class="siding-arg-intro">The siding scope is supported in this order: '
            f'<b>damage</b> (the covered peril) &rarr; <b>code compliance</b> (the corner '
            f'rule). {role_badge}</p>'
        )

    return (
        f'<div class="siding-argument" data-siding-argument="true" '
        f'data-user-role="{_h(role)}" data-can-advocate="{"true" if advocate else "false"}">'
        f'<div class="sec-eyebrow">The Forensic Sequence</div>'
        f'<h2>{heading}</h2>'
        f'{intro}'
        f'<div class="siding-arg-steps">'
        f'{layer_damage}{layer_code}{layer_appearance}{layer_dv}'
        f'</div>'
        f'</div>'
    )


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
            <td><b>{_cite_chip(tag)}</b></td>
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
    <div class="sec-eyebrow">Attribution Schedule</div>
    <h2>Code-Compliance Supplement &mdash; Requirements Only</h2>

    <div class="ahj-header" data-ahj="true">
        <div class="ahj-l">
            <div class="ahj-title">Authority</div>
            <div class="ahj-prefix">{_h(ahj['prefix'])}</div>
        </div>
        <div class="ahj-r">
            <div class="ahj-title" style="color:var(--c-slate); margin-bottom:5px;">Authority Having Jurisdiction &amp; Code Edition</div>
            <div class="ahj-body">{_h(ahj['jurisdiction'])} ({_h(ahj['prefix'])}) &mdash; base code {_h(ahj['base_code'])}{_h(adopted)}</div>
        </div>
    </div>

    <div class="req-only-notice" data-requirements-only="true">
        <b>Upload roof measurements or the carrier scope</b> to generate the priced
        code-compliance supplement (Code Section, Requirement, Item, Qty, Unit, Unit Price,
        Line Total + subtotal). The requirements below are code-mandated regardless of pricing.
    </div>
    {table}
    '''


def _extract_roof_facets_payload(config: dict):
    """Read the claim's roof_facets payload, normalizing the two shapes Vision /
    persistence can hand us into the {'roof_facets': [...]} dict the geometry
    renderer expects.

      * Canonical: config['roof_facets'] == {'roof_facets': [...], 'scale_bar': ...}
      * Bare list: config['roof_facets'] == [ {facet}, {facet}, ... ]

    Returns the dict form (or None if absent / wrong type). render_roof_footprint
    itself decides renderability (returns None for the synthesized empty-polygon
    skeleton), so this only normalizes the container.
    """
    rf = config.get("roof_facets")
    if isinstance(rf, dict):
        return rf
    if isinstance(rf, list):
        return {"roof_facets": rf}
    return None


def _footprint_legend_html(svg: str) -> str:
    """Build the HTML code-zone legend for whichever zones the footprint SVG drew.

    The SVG already carries its own in-image legend; this HTML twin keeps the key
    crisp at print scale and uses the SAME --roof-<zone> tokens for the swatch, so
    a per-company re-theme moves both in lockstep. Only zones present in the SVG
    (matched on the `roof-edge--<type>` modifier) are listed, in the canonical
    left-to-right order.
    """
    rows = []
    for etype in _LEGEND_ORDER:
        if f"roof-edge--{etype}" not in svg:
            continue
        info = EDGE_ZONES[etype]
        rows.append(
            f'<div class="leg">'
            f'<span class="swatch" style="background:{info["stroke"]};"></span>'
            f'<span class="lt"><b>{_h(etype.capitalize())}</b> {_h(info["zone"])}</span>'
            f'</div>'
        )
    if not rows:
        return ""
    return '<div class="rff-legend">' + "".join(rows) + "</div>"


def _build_property_diagram(config: dict, annotations: list) -> str:
    """The Doc-06 property-diagram block.

    BEFORE drawing the generic parametric house, attempt the REAL overhead roof
    footprint from the claim's EagleView/Vision facet geometry. If
    render_roof_footprint returns an SVG (usable polygon geometry), use it inside
    the annotated footprint frame, with the same section header the house used
    plus the code-zone legend. If it returns None (no geometry — incl. the siding
    NY fixture and the ~40% synthesized-skeleton claims), FALL BACK to the existing
    generic house diagram, unchanged.
    """
    payload = _extract_roof_facets_payload(config)
    footprint_svg = render_roof_footprint(payload) if payload is not None else None

    if footprint_svg:
        legend = _footprint_legend_html(footprint_svg)
        return f'''<div class="rendering-section">
        <div class="rendering-title">Overhead Roof Footprint — Code Requirement Zones</div>
        <div class="roof-footprint-frame" data-real-footprint="true">
            {footprint_svg}
            {legend}
            <div class="rff-cap">
                <b>Real overhead roof footprint</b> derived from the measured facet
                geometry. Each roof edge is colored by the building-code zone it
                drives &mdash; eaves require the Ice &amp; Water Barrier, rakes the
                drip edge, ridges the ridge vent, valleys valley metal, and wall
                lines step flashing.
            </div>
        </div>
    </div>'''

    # No usable geometry → existing generic annotated house, unchanged.
    house_svg = generate_house_svg(config, annotations)
    return f'''<div class="rendering-section">
        <div class="rendering-title">Annotated Property Diagram — Code Requirement Zones</div>
        {house_svg}
    </div>'''


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

    # 2. Generate the property diagram — REAL overhead roof footprint when facet
    #    geometry is available, else the generic annotated house (fallback).
    property_diagram = _build_property_diagram(config, annotations)

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

    # 3c. PHASE 3 — SIDING ARGUMENT. Renders ONLY when a siding code scope is
    # present (R703.x / SIDING trade); empty string otherwise. Role- and
    # matching-statute-state-gated. Order is invariant: damage → code → appearance
    # → diminished value, corner rule as the hero. Does NOT touch the priced
    # subset (the subset invariant is unaffected — this is narrative, not dollars).
    siding_argument_html = _build_siding_argument(config)
    if siding_argument_html:
        print("[COMPLIANCE] siding argument rendered "
              f"(role={(config.get('compliance') or {}).get('user_role', 'contractor')}, "
              f"advocate={_can_advocate(config)})")

    # 4. Assemble full HTML — interior sheets carry a running header + footer so
    #    nothing strands across page breaks; the lead citation renders as a chip.
    lead_cite = _cite_chip(f'{jurisdiction["abbrev"]} {_lead_code_basis(config)["section"]}')
    html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    {COMPLIANCE_FONTS_LINK}
    <style>{COMPLIANCE_CSS}</style>
</head>
<body>
    {cover_html}
    <div class="page-break"></div>

    {_run_head(config, "Property Diagram · Code Requirement Zones")}
    {property_diagram}
    {_run_foot(config, "Building Code Compliance Report")}
    <div class="page-break"></div>

    {_run_head(config, "Code Requirement Details")}
    <div class="sec-eyebrow">Applicable Provisions</div>
    <h2>Code Requirement Details</h2>
    {detail_cards}
    {_run_foot(config, "Building Code Compliance Report")}
    <div class="page-break"></div>

    {_run_head(config, "Installation — Visual Reference")}
    <div class="sec-eyebrow">Plan-Section Reference</div>
    <h2>Installation Requirements — Visual Reference</h2>
    <p style="font-size:12.5px; color:var(--c-slate); line-height:1.55; margin-bottom:4px;">
        The following plates illustrate compliant vs. non-compliant installation methods
        for code-required components. These represent manufacturer installation
        instructions which carry the <b>force of building code</b> per {lead_cite}.
    </p>
    {diagrams}
    {_run_foot(config, "Building Code Compliance Report")}
    <div class="page-break"></div>

    {_run_head(config, "Code Requirements Summary")}
    {summary}
    {_run_foot(config, "Building Code Compliance Report")}
    <div class="page-break"></div>

    {_run_head(config, "Priced Supplement · Attribution View")}
    {supplement_html}
    {_run_foot(config, "Building Code Compliance Report")}
    {(("<div class='page-break'></div>" + _run_head(config, "Forensic Sequence · The Reasoning") + siding_argument_html + _run_foot(config, "Building Code Compliance Report")) if siding_argument_html else "")}
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

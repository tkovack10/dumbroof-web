#!/usr/bin/env python3
"""
Xactimate Level 3 Mastery Knowledge Engine
===========================================
Machine-readable price lookup, line item builder, scope comparison matcher,
and missing item finder. Operates at Xactimate Level 3 (Subject Matter Expert)
quality — correct catalog codes, standardized descriptions, IRC-backed code
compliance items, and waste factors matching Xactimate conventions.

Usage:
    from xactimate_lookup import XactRegistry

    reg = XactRegistry()
    item = reg.lookup_price("Ice & water barrier")
    line_items = reg.build_line_items(measurements)
    missing = reg.find_missing_items(carrier_line_items, measurements)
    matched = reg.pre_match_scope_comparison(carrier_line_items, usarm_line_items)
"""

import json
import os
import re
import math
import functools
import logging
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "xactimate_prices.json")
ALL_MARKETS_PATH = os.path.join(os.path.dirname(__file__), "pricing", "all-markets.json")

# Alfonso's OUR_CODES: internal pipeline code → (Xactimate catalog code, action)
INTERNAL_TO_XACT = {
    "RFG SHTG":   ("RFG 300S", "remove"),
    "RFG LAMI":   ("RFG 300S", "install"),
    "RFG RDGC":   ("RFG RIDGCS", "r&r"),
    "RFG STRT":   ("RFG ASTR-", "install"),
    "RFG FELT30": ("RFG FELT30", "install"),
    "RFG I&W":    ("RFG IWS", "install"),
    "RFG DRPE":   ("RFG DRIP", "remove"),
    "RFG DRIP":   ("RFG DRIP", "install"),
    "RFG STPF_R": ("RFG STEP", "remove"),
    "RFG STPF":   ("RFG STEP", "install"),
    "RFG JKFL":   ("RFG FLPIPE", "r&r"),
    "RFG CHFL":   ("RFG FLCH", "r&r"),
    "RFG RGVC":   ("RFG RGVC", "r&r"),
    "RFG STP7_R": ("RFG STP7", "remove"),
    "RFG STP7":   ("RFG STP7", "install"),
    "RFG HIGH_R": ("RFG HIGH", "remove"),
    "RFG HIGH":   ("RFG HIGH", "install"),
    "CLN DMPW":   ("CLN DMPW", "install"),
    "GEN PRMT":   ("GEN PRMT", "install"),
    "CLN GCLN":   ("CLN GCLN", "install"),
    "SFG GUTW":   ("SFG GUTA", "r&r"),
    "SFG DNSW":   ("SFG GUTA", "r&r"),
    # Slate roofing
    "RFG SLATE":   ("RFG SLATE", "install"),
    "RFG SLATE++": ("RFG SLATE++", "install"),
    "RFG SLR++":   ("RFG SLR++", "install"),
    # Wood shake / cedar roofing
    "RFG WSHK+":   ("RFG WSHK+", "install"),
    "RFG WSTP":    ("RFG WSTP", "install"),
    "RFG WSTR":    ("RFG WSTR", "install"),
    # Cedar siding
    "SDG CSH":     ("SDG CSH", "r&r"),
    "SDG CSH+":    ("SDG CSH+", "r&r"),
}

# Default market per state (for states with multiple markets)
DEFAULT_MARKETS = {
    "NY": "NYBI8X_MAR26",
    "NJ": "NJCA8X_MAR26",
    "PA": "PAPH8X_MAR26",
    "MD": "MDBA8X_MAR26",
    "DE": "DEDO8X_MAR26",
    "OH": "OHDT8X_APR26",   # Dayton — closest to current OH work (Laura, OH)
    "MI": "MIDE8X_APR26",   # Detroit
    "IL": "ILCC8X_APR26",   # Chicago
    "MN": "MNMN8X_APR26",   # Minneapolis (pending: 12/22 priced)
    "TX": "TXDF8X_APR26",   # Dallas-Fort Worth — largest TX metro (Alfonso 2026-04-17, 24 markets)
}

# Full state name → 2-letter code. Upstream address parsers are inconsistent
# about whether they return "TX" or "Texas"; resolve_market needs to handle
# both so a Texas claim doesn't silently fall through to NY default pricing.
_STATE_NAME_TO_CODE = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC",
}


def _normalize_state(state) -> str:
    """Accept either a 2-letter code or a full state name; return 2-letter uppercase.

    Returns empty string if state is falsy or unrecognizable. Never raises.
    """
    if not state:
        return ""
    s = str(state).strip()
    if len(s) == 2:
        return s.upper()
    return _STATE_NAME_TO_CODE.get(s.lower(), s.upper()[:2])

# Negative keyword exclusions for scope comparison matching (PRE-COMPILED)
# If carrier desc matches pattern[0] AND usarm desc matches pattern[1], REJECT the match
NEGATIVE_EXCLUSIONS = [
    (re.compile(r"w/out felt", re.I), re.compile(r"^(?:roofing )?felt", re.I)),
    (re.compile(r"7/12.*9/12", re.I), re.compile(r"10/12.*12/12", re.I)),
    (re.compile(r"10/12.*12/12", re.I), re.compile(r"7/12.*9/12", re.I)),
    (re.compile(r"greater than 12/12", re.I), re.compile(r"7/12|10/12", re.I)),
    (re.compile(r"downspout", re.I), re.compile(r"window.*wrap|wrap.*window", re.I)),
    (re.compile(r"window.*wrap|wrap.*window", re.I), re.compile(r"downspout", re.I)),
    (re.compile(r"gutter guard", re.I), re.compile(r"^gutter(?!.*guard)", re.I)),
    # Ridge/hip cap must NOT match shingle install/remove (different items, same trade)
    (re.compile(r"ridge|hip.*cap", re.I), re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)|(?:shingle|rfg).*(?:w/out felt)", re.I)),
    (re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)|(?:shingle|rfg).*(?:w/out felt)", re.I), re.compile(r"ridge|hip.*cap", re.I)),
    # Starter strip must NOT match shingle install
    (re.compile(r"starter", re.I), re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I)),
    (re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I), re.compile(r"starter", re.I)),
    # Drip edge must NOT match step/counter flashing
    (re.compile(r"drip.edge", re.I), re.compile(r"step.flash|counter.flash", re.I)),
    (re.compile(r"step.flash|counter.flash", re.I), re.compile(r"drip.edge", re.I)),
    # Felt/underlayment must NOT match shingle install/remove (different items entirely)
    (re.compile(r"^(?:roofing )?felt|^synthetic.underlay", re.I), re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I)),
    (re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I), re.compile(r"^(?:roofing )?felt|^synthetic.underlay", re.I)),
    # Ice & water must NOT match shingle install
    (re.compile(r"ice.*water|i&w|ice.shield", re.I), re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I)),
    (re.compile(r"(?:laminated|3.tab|comp).*(?:shingle|rfg)", re.I), re.compile(r"ice.*water|i&w|ice.shield", re.I)),
]

# Module-level cache for all-markets.json (read once, reuse)
_all_markets_cache = None


def _get_all_markets():
    """Load and cache all-markets.json. Returns dict or empty dict if missing."""
    global _all_markets_cache
    if _all_markets_cache is None:
        try:
            if os.path.exists(ALL_MARKETS_PATH):
                with open(ALL_MARKETS_PATH) as f:
                    _all_markets_cache = json.load(f)
            else:
                _all_markets_cache = {}
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load all-markets.json: %s", e)
            _all_markets_cache = {}
    return _all_markets_cache


# Module-level cache for city_aliases.json — hand-curated suburb → market routing
CITY_ALIASES_PATH = os.path.join(os.path.dirname(__file__), "pricing", "city_aliases.json")
_city_aliases_cache = None


def _get_city_aliases():
    """Load and cache city_aliases.json. Strips comment keys (prefixed with _)."""
    global _city_aliases_cache
    if _city_aliases_cache is None:
        try:
            if os.path.exists(CITY_ALIASES_PATH):
                with open(CITY_ALIASES_PATH) as f:
                    raw = json.load(f)
                _city_aliases_cache = {
                    k.lower().strip(): v for k, v in raw.items() if not k.startswith("_")
                }
            else:
                _city_aliases_cache = {}
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load city_aliases.json: %s", e)
            _city_aliases_cache = {}
    return _city_aliases_cache


# Module-level cache for zip_to_market.json — 3-digit ZIP prefix → market routing
ZIP_TO_MARKET_PATH = os.path.join(os.path.dirname(__file__), "pricing", "zip_to_market.json")
_zip_to_market_cache = None


def _get_zip_to_market():
    """Load and cache zip_to_market.json. Strips comment keys (prefixed with _)."""
    global _zip_to_market_cache
    if _zip_to_market_cache is None:
        try:
            if os.path.exists(ZIP_TO_MARKET_PATH):
                with open(ZIP_TO_MARKET_PATH) as f:
                    raw = json.load(f)
                _zip_to_market_cache = {
                    k.strip(): v for k, v in raw.items() if not k.startswith("_")
                }
            else:
                _zip_to_market_cache = {}
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to load zip_to_market.json: %s", e)
            _zip_to_market_cache = {}
    return _zip_to_market_cache

# Prefixes/stopwords stripped during fuzzy matching
_PFX_RE = re.compile(
    r"^(r&r\s+|remove\s+|tear\s*off\s+|tear\s*out\s+|install\s+|detach\s*&?\s*reset\s+)", re.IGNORECASE
)
_SECTION_RE = re.compile(
    r"^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|"
    r"left\s*elevation|right\s*elevation|debris\s*removal|"
    r"interior|garage|porch)\s*[-–—]\s*",
    re.IGNORECASE,
)
_ITEM_NUM_RE = re.compile(r"\s*[-–—]?\s*item\s*\d+\s*$", re.IGNORECASE)
_STRUCT_PREFIX_RE = re.compile(r"^\[.*?\]\s*", re.IGNORECASE)
_ELEV_RE = re.compile(
    r"^(front|rear|back|left|right|north|south|east|west)\s+"
    r"(elevation|side)?\s*[-–—]?\s*",
    re.IGNORECASE,
)
_STOP_WORDS = frozenset(
    {"the", "a", "an", "for", "of", "and", "or", "w/", "w/out", "-", "to", "per"}
)

# Qualifier stripping — removes dimensions, grades, colors, weights from descriptions
# so "Slate roofing - High grade - 18" to 24" tall - w/out felt" → "Slate roofing"
_QUALIFIER_RE = re.compile(
    r'\s*[-–—]\s*(?:'
    r'\d+["\u2033]?\s*to\s*\d+["\u2033]?\s*tall'  # "18" to 24" tall"
    r'|w/(?:out)?\s+felt'                            # "w/out felt", "w/ felt"
    r'|premium\s+grade|high\s+grade|standard\s+grade' # grade qualifiers
    r'|red|gray|grey|black|green|brown'               # color qualifiers
    r'|\d+\s*(?:lb|oz|mil|mm)\b\.?'                   # weight/thickness
    r')',
    re.IGNORECASE
)

# Material keywords for boosting fuzzy match score when both descriptions share the same material
_MATERIAL_KEYWORDS = frozenset(
    {"slate", "cedar", "tile", "copper", "aluminum", "vinyl", "shake", "wood", "metal"}
)


@functools.lru_cache(maxsize=512)
def _clean_desc(desc):
    """Strip action prefixes, section headers, structure brackets, item numbers, qualifiers, and normalize."""
    d = desc.lower().strip()
    d = _STRUCT_PREFIX_RE.sub("", d).strip()  # strip [Structure #N (...)]
    d = _SECTION_RE.sub("", d).strip()
    d = _ITEM_NUM_RE.sub("", d).strip()
    d = _PFX_RE.sub("", d).strip()
    d = _QUALIFIER_RE.sub("", d).strip()
    d = re.sub(r'\s*\(revised[^)]*\)', '', d, flags=re.I).strip()
    d = re.sub(r'\s*\(pre-appraisal[^)]*\)', '', d, flags=re.I).strip()
    return d


def _desc_words(desc):
    """Get significant words from a cleaned description."""
    return set(desc.split()) - _STOP_WORDS


def _similarity(a, b):
    """Ratio-based similarity between two strings."""
    return SequenceMatcher(None, a, b).ratio()


class XactRegistry:
    """Xactimate price registry with Level 3 Mastery knowledge."""

    def __init__(self, registry_path=None, market=None):
        path = registry_path or REGISTRY_PATH
        try:
            with open(path) as f:
                data = json.load(f)
        except FileNotFoundError:
            raise RuntimeError(f"Xactimate price registry not found: {path}")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Malformed JSON in price registry {path}: {e}")

        self.version = data.get("version", "")
        self.default_market = market or data.get("default_market", "NYBI26")
        if self.default_market not in data.get("markets", {}):
            raise RuntimeError(f"Market '{self.default_market}' not found in {path}")
        market_data = data["markets"][self.default_market]
        self.market_name = market_data["name"]
        self.tax_rate = market_data.get("tax_rate", 0.08)
        self.items = market_data["items"]
        self.quantity_rules = data.get("quantity_rules", {})
        self.mandatory_by_trade = data.get("mandatory_items_by_trade", {})
        self.underpayment_patterns = data.get("carrier_underpayment_patterns", [])

        # Build indexes for O(1) lookup
        self._by_code = {}  # (xact_code, action) → item
        self._by_desc = {}  # cleaned description → item
        self._by_desc_raw = {}  # raw description → item
        for item in self.items:
            code = item.get("xact_code")
            if code:
                self._by_code[(code, item["action"])] = item
            self._by_desc_raw[item["description"].lower()] = item
            self._by_desc[_clean_desc(item["description"])] = item

    # ------------------------------------------------------------------
    # 0. Multi-Market Price Overlay
    # ------------------------------------------------------------------

    def load_market_prices(self, all_markets_path=None, market_code=None):
        """Overlay prices from Alfonso's all-markets.json onto registry items.

        Maps internal pipeline codes → (xact_code, action) → registry items,
        then updates unit_price from the market-specific price.

        Returns count of prices updated.
        """
        all_data = _get_all_markets()
        if not all_data:
            return 0

        markets = all_data.get("markets", {})
        if not market_code or market_code not in markets:
            logger.info("Market code %s not found in all-markets.json", market_code)
            return 0

        market = markets[market_code]
        items_data = market.get("items", {})
        updated = 0

        for internal_code, item_data in items_data.items():
            price = item_data.get("price")
            if price is None:
                continue  # NEEDS_DESKTOP — skip null prices

            mapping = INTERNAL_TO_XACT.get(internal_code)
            if not mapping:
                continue

            xact_code, action = mapping
            registry_item = self._by_code.get((xact_code, action))
            if registry_item:
                registry_item["unit_price"] = price
                updated += 1

        self._market_code = market_code
        self._market_name = market.get("name", market_code)
        return updated

    @staticmethod
    def resolve_market(state, zip_code=None, city=None):
        """Resolve state/zip/city to the best market code in all-markets.json.

        Resolution order (highest precedence first):
          1. City alias table (pricing/city_aliases.json) — hand-curated
             suburb→market routing for common metros (Plano→Dallas,
             Katy→Houston, King of Prussia→Philadelphia, etc.). Wins first
             because aliases are explicitly curated.
          2. ZIP prefix table (pricing/zip_to_market.json) — first 3 digits
             of the ZIP → market. Covers 278 prefixes across all 10 states
             we have pricing for, so most addresses resolve without a city
             alias. Sanity-checks that the prefix's market matches the
             claim's state.
          3. Fuzzy city match against market NAME field (e.g. "Dallas" in
             "Dallas-Fort Worth Texas").
          4. DEFAULT_MARKETS[state] fallback.

        Returns market code string. For states not in DEFAULT_MARKETS, returns
        the default NY market with a warning (pricing will be approximate).

        Accepts either a 2-letter state code or a full state name; address
        parsers upstream are inconsistent about which they return.
        """
        state_upper = _normalize_state(state)
        if not state_upper:
            logger.error(
                "[PRICING] No state provided for market resolution — falling back to "
                "NY pricing. This is a data-capture bug: state must be set on every claim."
            )
            return DEFAULT_MARKETS["NY"]

        default = DEFAULT_MARKETS.get(state_upper)
        if not default:
            # No Xactimate pricing loaded for this state. Warn loudly so this
            # surfaces in claim processing_warnings and Tom sees it. Tom's
            # directive (2026-04-20): never silently substitute wrong pricing
            # for a state that we haven't onboarded.
            logger.error(
                "[PRICING] No Xactimate price list loaded for state %s. "
                "Falling back to NY pricing — claim will be materially wrong. "
                "Add a market for %s to tools/xactimate/price-lists/all-markets.json + "
                "DEFAULT_MARKETS in xactimate_lookup.py before releasing claims from %s.",
                state_upper, state_upper, state_upper,
            )
            return DEFAULT_MARKETS["NY"]

        if not city and not zip_code:
            return default

        markets_dict = _get_all_markets().get("markets", {})

        # 1. Alias table — hand-curated suburb → market lookup. Keyed by
        #    lowercased "city,state" (comma-separated, no space). Wins over
        #    fuzzy matching because e.g. "Plano" won't substring-match
        #    "Dallas-Fort Worth Texas" in the market name.
        if city:
            alias_key = f"{city.lower().strip()},{state_upper.lower()}"
            aliases = _get_city_aliases()
            if alias_key in aliases:
                aliased = aliases[alias_key]
                if aliased in markets_dict:
                    logger.debug("Market resolved via alias: %s → %s", alias_key, aliased)
                    return aliased

        # 2. ZIP prefix table — fast, works even when city name is missing or garbled.
        #    Safety: the zip prefix must resolve to a market in the claim's state,
        #    otherwise we ignore it (protects against out-of-state zips).
        if zip_code:
            zip_clean = "".join(c for c in str(zip_code) if c.isdigit())[:5]
            if len(zip_clean) >= 3:
                prefix = zip_clean[:3]
                zip_map = _get_zip_to_market()
                mapped = zip_map.get(prefix)
                if mapped and mapped in markets_dict and mapped.startswith(state_upper):
                    logger.debug("Market resolved via ZIP prefix: %s → %s", prefix, mapped)
                    return mapped

        # 3. Fuzzy city match against market names (e.g. "Dallas" in "Dallas-Fort Worth Texas")
        if city:
            city_lower = city.lower().strip()
            try:
                for code, mdata in markets_dict.items():
                    if not code.startswith(state_upper):
                        continue
                    mname = mdata.get("name", "").lower()
                    if city_lower in mname or mname.split(",")[0].strip() in city_lower:
                        return code
            except (KeyError, AttributeError) as e:
                logger.debug("City matching failed for %s: %s", city, e)

        # 4. State default
        return default

    # ------------------------------------------------------------------
    # 1. Price Lookup
    # ------------------------------------------------------------------

    def lookup_price(self, description, action=None):
        """Fuzzy-match a description against the registry.

        Returns the best matching item dict or None.
        """
        desc_lower = description.lower().strip()

        # Exact raw match
        if desc_lower in self._by_desc_raw:
            item = self._by_desc_raw[desc_lower]
            if action is None or item["action"] == action:
                return item

        # Exact cleaned match
        cleaned = _clean_desc(description)
        if cleaned in self._by_desc:
            item = self._by_desc[cleaned]
            if action is None or item["action"] == action:
                return item

        # Fuzzy match — find best candidate
        best_score = 0.0
        best_item = None
        query_words = _desc_words(cleaned)

        for item in self.items:
            if action and item["action"] != action:
                continue
            item_clean = _clean_desc(item["description"])

            # Substring match (both directions)
            if cleaned in item_clean or item_clean in cleaned:
                return item

            # Similarity score
            score = _similarity(cleaned, item_clean)

            # Boost for word overlap
            item_words = _desc_words(item_clean)
            overlap = query_words & item_words
            if len(overlap) >= 3 or (len(overlap) >= 2 and len(query_words) <= 4):
                score += 0.3

            if score > best_score:
                best_score = score
                best_item = item

        if best_score >= 0.6:
            return best_item
        return None

    def lookup_by_code(self, xact_code, action="install"):
        """Look up by exact Xactimate catalog code + action."""
        return self._by_code.get((xact_code, action))

    # ------------------------------------------------------------------
    # 2. Description Standardization
    # ------------------------------------------------------------------

    def get_standard_description(self, description):
        """Given a rough description, return the canonical Xactimate description.

        Returns (canonical_description, confidence) or (None, 0).
        """
        item = self.lookup_price(description)
        if item:
            return item["description"], 1.0

        # Partial match with lower confidence
        cleaned = _clean_desc(description)
        best_score = 0.0
        best_desc = None
        for item in self.items:
            item_clean = _clean_desc(item["description"])
            score = _similarity(cleaned, item_clean)
            if score > best_score:
                best_score = score
                best_desc = item["description"]

        if best_score >= 0.5:
            return best_desc, best_score
        return None, 0.0

    # ------------------------------------------------------------------
    # 3. Line Item Builder (Level 3 Mastery)
    # ------------------------------------------------------------------

    def _append_item(self, items_list, desc, qty, action=None, default_trade="roofing",
                     fallback_on_miss=True):
        """Look up item by description and append to items list.
        Includes Xactimate code and supplement argument from registry."""
        if qty <= 0:
            return
        item = self.lookup_price(desc, action=action)
        if item:
            items_list.append({
                "description": item["description"],
                "qty": round(qty, 2),
                "unit": item["unit"],
                "unit_price": item["unit_price"],
                "category": item["category"],
                "trade": item.get("trade", default_trade),
                "code": item.get("xact_code", ""),
                "supplement_argument": item.get("supplement_argument", ""),
                "irc_code": item.get("irc_code", ""),
            })
        elif fallback_on_miss:
            items_list.append({
                "description": desc,
                "qty": round(qty, 2),
                "unit": "EA",
                "unit_price": 0,
                "category": "ROOFING" if default_trade == "roofing" else "SIDING",
                "trade": default_trade,
                "code": "",
                "supplement_argument": "",
                "irc_code": "",
            })

    def build_line_items(self, measurements, config_hints=None, state=None):
        """Build complete line_items array from EagleView measurements.

        Args:
            measurements: dict with keys matching EagleView output:
                remove_sq, install_sq, ridge_lf, eave_lf, rake_lf,
                valley_lf, step_lf, penetrations, chimneys, pitch,
                stories, gutter_lf, downspout_lf, layers (optional)
            config_hints: dict with optional overrides:
                shingle_type ("laminated"|"3tab"), default "laminated"
            state: 2-letter state code for jurisdiction-specific formulas
                include_gutters (bool), default True if gutter_lf > 0
                siding (dict with siding_sf, windows, etc.) for siding trades

        Returns:
            list of line_item dicts ready for claim_config.json
        """
        hints = config_hints or {}
        m = measurements

        remove_sq = m.get("remove_sq", 0)
        install_sq = m.get("install_sq", 0)
        ridge_lf = m.get("ridge_lf", 0)
        eave_lf = m.get("eave_lf", 0)
        rake_lf = m.get("rake_lf", 0)
        valley_lf = m.get("valley_lf", 0)
        step_lf = m.get("step_lf", 0)
        penetrations = m.get("penetrations", 0)
        chimneys = m.get("chimneys", 0)
        pitch = m.get("pitch", 4)
        stories = m.get("stories", 1)
        gutter_lf = m.get("gutter_lf", 0)
        layers = m.get("layers", 1)
        shingle_type = hints.get("shingle_type", "laminated")

        # Computed quantities — state-specific I&W formulas
        # Valley is ALWAYS × 3 (3ft). Eave varies: NY=6ft (2 courses), PA=3ft (1 course)
        _state = (state or "NY").upper()
        if _state in ("PA", "MD", "DE"):
            ice_water_sf = (eave_lf * 3) + (valley_lf * 3)  # 1 course eave (3ft), valley 3ft
        else:
            ice_water_sf = (eave_lf * 6) + (valley_lf * 3)  # 2 courses eave (6ft), valley 3ft
        felt_sq = max(0, round(((install_sq * 100) - ice_water_sf) / 100, 2))
        starter_lf = eave_lf + rake_lf
        drip_edge_lf = round(starter_lf * 1.05, 2)  # 5% waste
        step_flash_lf = round(step_lf * 1.05, 2) if step_lf > 0 else 0  # 5% waste
        counter_flash_lf = step_flash_lf  # counterflashing same length as step

        items = []

        def _add(desc, qty, action=None, default_trade="roofing", ev_formula=""):
            """Look up item by description and add to items list.
            Includes Xactimate code, supplement argument, and ev_formula from registry."""
            self._append_item(items, desc, qty, action=action, default_trade=default_trade)
            # Stamp ev_formula on the item we just added (always the last one)
            if items and ev_formula:
                items[-1]["ev_formula"] = ev_formula

        # I&W formula string (state-dependent — eave multiplier changes, valley always × 3)
        if _state in ("PA", "MD", "DE"):
            _iw_formula = f"(Eave {eave_lf:.0f} × 3) + (Valley {valley_lf:.0f} × 3) = {ice_water_sf:.0f} SF"
        else:
            _iw_formula = f"(Eave {eave_lf:.0f} × 6) + (Valley {valley_lf:.0f} × 3) = {ice_water_sf:.0f} SF"

        # ── SHINGLE REMOVAL ──
        _remove_formula = f"{remove_sq:.2f} SQ (EagleView roof area)"
        if shingle_type == "3tab":
            _add("Remove 3 tab - 25 yr. comp. shingle roofing - w/out felt", remove_sq, action="remove", ev_formula=_remove_formula)
        else:
            _add("Remove Laminated comp. shingle rfg. - w/out felt", remove_sq, action="remove", ev_formula=_remove_formula)

        # Additional layer removal (if > 1 layer)
        if layers > 1:
            _add("Add. layer of comp. shingles, remove & disp. - Laminated", remove_sq, action="remove", ev_formula=_remove_formula)

        # ── SHINGLE INSTALLATION ──
        if install_sq != remove_sq and remove_sq > 0:
            waste_pct = round((install_sq / remove_sq - 1) * 100)
            _install_formula = f"{remove_sq:.2f} × {install_sq / remove_sq:.2f} ({waste_pct}% waste) = {install_sq:.2f} SQ"
        else:
            _install_formula = f"{install_sq:.2f} SQ (EagleView roof area)"
        if shingle_type == "3tab":
            _add("3 tab - 25 yr. comp. shingle roofing - w/out felt", install_sq, action="install", ev_formula=_install_formula)
        else:
            _add("Laminated comp. shingle rfg. - w/out felt", install_sq, action="install", ev_formula=_install_formula)

        # ── UNDERLAYMENT ──
        _felt_formula = f"(({install_sq:.2f} × 100) − {ice_water_sf:.0f}) / 100 = {felt_sq:.2f} SQ"
        _add("Roofing felt - 15 lb.", felt_sq, action="install", ev_formula=_felt_formula)
        _add("Ice & water barrier", ice_water_sf, action="install", ev_formula=_iw_formula)

        # ── STARTER & RIDGE ──
        _starter_formula = f"Eave {eave_lf:.0f} + Rake {rake_lf:.0f} = {starter_lf:.0f} LF"
        _add("Asphalt starter - universal starter course", starter_lf, action="install", ev_formula=_starter_formula)
        _ridge_formula = f"Ridge {ridge_lf:.0f} LF (EagleView)"
        if shingle_type == "3tab":
            _add("R&R Hip/Ridge cap - cut from 3 tab - composition shingles", ridge_lf, action="r&r", ev_formula=_ridge_formula)
        else:
            _add("R&R Hip / Ridge cap - Standard profile - composition shingles", ridge_lf, action="r&r", ev_formula=_ridge_formula)

        # ── DRIP EDGE ──
        _drip_formula = f"(Eave {eave_lf:.0f} + Rake {rake_lf:.0f}) × 1.05 = {drip_edge_lf:.0f} LF"
        _add("R&R Drip edge", drip_edge_lf, action="r&r", ev_formula=_drip_formula)

        # ── STEP FLASHING ──
        if step_lf > 0:
            _step_formula = f"Step {step_lf:.0f} LF (EagleView)"
            _step_install_formula = f"Step {step_lf:.0f} × 1.05 = {step_flash_lf:.0f} LF"
            _add("Remove Step flashing", step_lf, action="remove", ev_formula=_step_formula)
            _add("Step flashing", step_flash_lf, action="install", ev_formula=_step_install_formula)

        # ── COUNTERFLASHING / APRON FLASHING ──
        if step_lf > 0:
            _counter_formula = f"Counter {step_lf:.0f} × 1.05 = {counter_flash_lf:.0f} LF"
            _add("Remove Counterflashing - Apron flashing", step_lf, action="remove", ev_formula=_step_formula)
            _add("Counterflashing - Apron flashing", counter_flash_lf, action="install", ev_formula=_counter_formula)

        # ── PIPE JACKS ──
        if penetrations > 0:
            _add("R&R Flashing - pipe jack", penetrations, action="r&r", ev_formula=f"{penetrations} EA (EagleView)")

        # ── CHIMNEY FLASHING ──
        if chimneys > 0:
            _add("R&R Chimney flashing - average (32\" x 36\")", chimneys, action="r&r", ev_formula=f"{chimneys} EA (EagleView)")

        # ── RIDGE VENT ──
        _add("R&R Continuous ridge vent - shingle-over style", ridge_lf, action="r&r", ev_formula=_ridge_formula)

        # ── STEEP CHARGES ──
        if pitch >= 7:
            _steep_formula = f"{remove_sq:.2f} SQ steep area"
            if pitch <= 9:
                _add("Remove Additional charge for steep roof - 7/12 to 9/12 slope", remove_sq, action="remove", ev_formula=_steep_formula)
                _add("Additional charge for steep roof - 7/12 to 9/12 slope", install_sq, action="install", ev_formula=_steep_formula)
            elif pitch <= 12:
                _add("Remove Additional charge for steep roof - 10/12 to 12/12 slope", remove_sq, action="remove", ev_formula=_steep_formula)
                _add("Additional charge for steep roof - 10/12 to 12/12 slope", install_sq, action="install", ev_formula=_steep_formula)
            else:
                _add("Remove Additional charge for steep roof greater than 12/12 slope", remove_sq, action="remove", ev_formula=_steep_formula)
                _add("Additional charge for steep roof greater than 12/12 slope", install_sq, action="install", ev_formula=_steep_formula)

        # ── HIGH ROOF CHARGES ──
        if stories >= 2:
            _high_formula = f"{remove_sq:.2f} SQ, {stories} stories"
            _add("Remove Additional charge for high roof (2 stories or greater)", remove_sq, action="remove", ev_formula=_high_formula)
            _add("Additional charge for high roof (2 stories or greater)", install_sq, action="install", ev_formula=_high_formula)

        # ── GABLE CORNICE RETURNS ──
        gable_ends = hints.get("gable_ends", 0)
        if gable_ends > 0:
            if stories >= 2:
                _add("R&R Gable cornice return - laminated - 2 stories or greater",
                     gable_ends, action="r&r", ev_formula=f"{gable_ends} EA")
            else:
                _add("R&R Gable cornice return - laminated", gable_ends, action="r&r", ev_formula=f"{gable_ends} EA")

        # ── LABOR & EQUIPMENT (mandatory, scaled by roof size) ──
        roofer_hours = max(4, min(16, round(install_sq / 4)))
        _add("Roofer - per hour", roofer_hours, action="install", ev_formula=f"max(4, {install_sq:.0f} / 4) = {roofer_hours} HR")
        _add("Equipment operator", max(1, round(roofer_hours / 2)), action="install")
        # Dumpster sizing: 20yd for small, 30yd standard, 40yd for large/multi-trade
        _add("Dumpster load - Approx. 30 yards, 5-7 tons of debris", 1, action="install")
        # Fall protection (mandatory per OSHA 29 CFR 1926.501)
        fall_days = max(2, round(roofer_hours / 8) * 2)  # 2 roofers per day
        _add("Fall protection harness and lanyard - per day", fall_days, action="install")
        # Administrative labor for re-inspection
        _add("Administrative/supervisor labor charge", 2.5, action="install")

        # ── GUTTERS ──
        if gutter_lf > 0 and hints.get("include_gutters", True):
            _add("R&R Gutter / downspout - aluminum - up to 5\"", gutter_lf, action="r&r", ev_formula=f"Gutter {gutter_lf:.0f} LF (EagleView)")

        # ── SIDING (if config_hints includes siding) ──
        siding_hints = hints.get("siding")
        if siding_hints:
            self._build_siding_items(items, siding_hints)

        return items

    def _build_siding_items(self, items, siding):
        """Add siding line items based on siding hints."""
        siding_sf = siding.get("siding_sf", 0)
        siding_type = siding.get("siding_type", "vinyl")
        windows = siding.get("windows", 0)
        window_size = siding.get("window_size", "standard")
        shutters_pairs = siding.get("shutters_pairs", 0)
        outlets = siding.get("outlets", 0)
        gable_vents = siding.get("gable_vents", 0)
        outside_corners_lf = siding.get("outside_corners_lf", 0)
        inside_corners_lf = siding.get("inside_corners_lf", 0)
        has_insulation = siding.get("has_insulation", False)

        def _add_s(desc, qty, action=None):
            self._append_item(items, desc, qty, action=action,
                              default_trade="siding", fallback_on_miss=False)

        # Siding material
        if siding_type == "aluminum":
            _add_s("R&R Aluminum siding .024\"", siding_sf, action="r&r")
        elif siding_type == "cedar":
            _add_s("R&R Siding - cedar shingle", siding_sf, action="r&r")
        else:
            _add_s("R&R Siding - vinyl", siding_sf, action="r&r")

        # House wrap — MANDATORY (IRC R703.2)
        _add_s("R&R House wrap (air/moisture barrier)", siding_sf, action="r&r")

        # Insulation board (only if confirmed present)
        if has_insulation:
            _add_s("R&R Fanfold foam insulation board - 3/8\"", siding_sf, action="r&r")

        # Window wraps
        if windows > 0:
            size_map = {
                "small": "R&R Wrap wood window frame & trim with aluminum sheet - Small",
                "standard": "R&R Wrap wood window frame & trim with aluminum sheet",
                "large": "R&R Wrap wood window frame & trim with aluminum sheet - Large",
                "xlarge": "R&R Wrap wood window frame & trim with aluminum sheet - XLarge",
            }
            _add_s(size_map.get(window_size, size_map["standard"]), windows, action="r&r")

        # Shutters
        if shutters_pairs > 0:
            _add_s("R&R Decorative shutter - exterior (per pair)", shutters_pairs, action="r&r")

        # Corner posts (vinyl only)
        if siding_type == "vinyl":
            if outside_corners_lf > 0:
                _add_s("R&R Vinyl outside corner post", outside_corners_lf, action="r&r")
            if inside_corners_lf > 0:
                _add_s("R&R Vinyl inside corner post", inside_corners_lf, action="r&r")

        # J-blocks (vinyl only)
        if siding_type == "vinyl" and outlets > 0:
            _add_s("R&R Light/outlet J-block - vinyl", outlets, action="r&r")

        # Gable vents
        if gable_vents > 0:
            _add_s("R&R Attic vent - gable end - vinyl", gable_vents, action="r&r")

        # Mandatory labor items
        _add_s("Siding - Labor Minimum", 1, action="install")
        _add_s("Scaffolding set up, and removal - charge per week", 1, action="install")

    # ------------------------------------------------------------------
    # 4. Carrier Scope Matching
    # ------------------------------------------------------------------

    def match_by_code(self, carrier_xact_code, carrier_action, usarm_line_items):
        """Match a carrier item to a USARM item by Xactimate catalog code.

        Returns (matched_item, confidence) or (None, 0).
        """
        if not carrier_xact_code:
            return None, 0.0

        code_upper = carrier_xact_code.upper().strip()
        action_lower = (carrier_action or "").lower().strip()

        for li in usarm_line_items:
            li_code = (li.get("code") or "").upper().strip()
            if not li_code:
                continue
            if li_code == code_upper:
                # If action specified, prefer action match
                li_desc_lower = li.get("description", "").lower()
                if action_lower:
                    if action_lower == "remove" and "remove" in li_desc_lower:
                        return li, 1.0
                    if action_lower == "install" and "remove" not in li_desc_lower:
                        return li, 1.0
                    if action_lower == "r&r":
                        return li, 1.0
                else:
                    return li, 0.95
        return None, 0.0

    @staticmethod
    def _classify_carrier_section(carrier_desc: str, carrier_notes: str = "") -> str:
        """Classify a carrier line item into a section for section-restricted matching.
        Returns: ROOFING, SIDING, GUTTERS, GENERAL, or UNKNOWN."""
        text = f"{carrier_desc} {carrier_notes}".lower()
        # SIDING indicators (check FIRST — "siding" is unambiguous)
        if any(w in text for w in ("siding", "vinyl sid", "aluminum sid", "cedar sid",
                                    "house wrap", "housewrap", "tyvek", "window wrap",
                                    "window trim", "j-channel", "soffit", "fascia",
                                    "insulation board", "fan fold", "fanfold",
                                    "shutter", "door wrap", "door frame")):
            return "SIDING"
        # GUTTERS indicators
        if any(w in text for w in ("gutter", "downspout", "splash block", "leader")):
            return "GUTTERS"
        # ROOFING indicators
        if any(w in text for w in ("shingle", "rfg", "roofing", "felt", "underlayment",
                                    "ice & water", "ice and water", "i&w", "ridge",
                                    "drip edge", "starter", "flashing", "step flash",
                                    "counter flash", "apron flash", "skylight",
                                    "vent", "pipe collar", "chimney", "cricket",
                                    "hip", "rake", "eave", "valley", "steep",
                                    "roofer", "tear off", "tear-off", "deck",
                                    "plywood", "osb")):
            return "ROOFING"
        # GENERAL
        if any(w in text for w in ("dumpster", "debris", "permit", "scaffolding",
                                    "labor", "equipment", "protection", "harness")):
            return "GENERAL"
        return "UNKNOWN"

    @staticmethod
    def _check_negative_exclusion(carrier_desc, usarm_desc):
        """Check if a match should be rejected due to negative keyword exclusion."""
        carrier_lower = carrier_desc.lower()
        usarm_lower = usarm_desc.lower()
        for carrier_pat, usarm_pat in NEGATIVE_EXCLUSIONS:
            if carrier_pat.search(carrier_lower) and usarm_pat.search(usarm_lower):
                return True  # REJECT this match
        return False

    def match_carrier_to_usarm(self, carrier_desc, usarm_line_items):
        """Match a carrier scope description to the best USARM line item.

        Returns (matched_item, confidence) or (None, 0).
        """
        carrier_clean = _clean_desc(carrier_desc)
        carrier_words = _desc_words(carrier_clean)

        best_score = 0.0
        best_item = None

        for li in usarm_line_items:
            li_clean = _clean_desc(li.get("description", ""))
            li_words = _desc_words(li_clean)

            # Check negative exclusions FIRST
            if self._check_negative_exclusion(carrier_desc, li.get("description", "")):
                continue

            # Substring match
            if carrier_clean in li_clean or li_clean in carrier_clean:
                return li, 1.0

            # Word overlap
            overlap = carrier_words & li_words
            word_score = 0.0
            if len(overlap) >= 3 or (len(overlap) >= 2 and len(carrier_words) <= 4):
                word_score = 0.4

            # Material keyword boost — same specialty material = strong signal
            carrier_mats = carrier_words & _MATERIAL_KEYWORDS
            li_mats = li_words & _MATERIAL_KEYWORDS
            if carrier_mats and carrier_mats == li_mats:
                word_score += 0.2

            # Similarity
            sim = _similarity(carrier_clean, li_clean)
            score = sim + word_score

            if score > best_score:
                best_score = score
                best_item = li

        confidence = min(1.0, best_score)
        if confidence >= 0.45:
            return best_item, confidence
        return None, 0.0

    # ------------------------------------------------------------------
    # 5. Pre-Match Scope Comparison
    # ------------------------------------------------------------------

    @staticmethod
    def _aggregate_carrier_triples(carrier_line_items):
        """Aggregate carrier tear-out/supply/install triples into combined R&R items.

        Carriers often split a single item into 2-3 lines:
        - "Tear Out - Laminated comp shingle" ($75/SQ)
        - "Material Only - Laminated comp shingle" ($200/SQ)
        - "Install - Laminated comp shingle" ($150/SQ)

        This combines them into one line with total amount for better matching
        against USARM's combined R&R items.
        """
        if not carrier_line_items:
            return carrier_line_items

        aggregated = []
        i = 0
        while i < len(carrier_line_items):
            ci = carrier_line_items[i]
            desc = (ci.get("carrier_desc") or ci.get("item") or "").lower()

            # Check if this is part of a tear-out/install or material/install sequence
            is_split = False
            if any(kw in desc for kw in ["tear out", "tear-out", "remove -", "material only"]):
                # Look ahead for matching install/supply lines
                base_desc = _clean_desc(desc)
                combined_amount = float(ci.get("carrier_amount", 0) or 0)
                combined_parts = [ci]
                consumed = set()  # track indices consumed by aggregation
                j = i + 1
                while j < len(carrier_line_items) and j <= i + 3:
                    next_ci = carrier_line_items[j]
                    next_desc = (next_ci.get("carrier_desc") or next_ci.get("item") or "").lower()
                    next_base = _clean_desc(next_desc)

                    # Check if descriptions match (same base item, different action)
                    if _similarity(base_desc, next_base) >= 0.6 or base_desc in next_base or next_base in base_desc:
                        if any(kw in next_desc for kw in ["install", "supply", "material only", "replace -"]):
                            combined_amount += float(next_ci.get("carrier_amount", 0) or 0)
                            combined_parts.append(next_ci)
                            consumed.add(j)
                            is_split = True
                    # Don't break on non-matching items — keep scanning within the window
                    j += 1

                if is_split and len(combined_parts) >= 2:
                    # Create a combined item
                    best_desc = max(combined_parts, key=lambda c: len(c.get("carrier_desc", "")))
                    combined = dict(best_desc)
                    combined["carrier_amount"] = round(combined_amount, 2)
                    combined["_aggregated_from"] = len(combined_parts)
                    # Preserve xact_code from any part that has it
                    for part in combined_parts:
                        if part.get("xact_code"):
                            combined["xact_code"] = part["xact_code"]
                            break
                    aggregated.append(combined)
                    # Append any items in the window that weren't consumed
                    for k in range(i + 1, j):
                        if k not in consumed:
                            aggregated.append(carrier_line_items[k])
                    i = j
                    continue

            aggregated.append(ci)
            i += 1

        if len(aggregated) < len(carrier_line_items):
            print(f"[SCOPE MATCH] Aggregated {len(carrier_line_items)} carrier items → {len(aggregated)} (combined {len(carrier_line_items) - len(aggregated)} split items)")

        return XactRegistry._aggregate_carrier_elevations(aggregated)

    @staticmethod
    def _aggregate_carrier_elevations(carrier_line_items):
        """Combine per-elevation carrier items (Front/Right/Rear/Left) into single items.

        Carriers often list the same item per elevation:
          "Front Elevation - Gutter" $300, "Rear Elevation - Gutter" $250
        USARM has a single combined line. Merge these by base description.
        """
        elev_groups = {}  # base_desc → list of items
        non_elev = []
        for ci in carrier_line_items:
            desc = ci.get("carrier_desc", "")
            stripped = _ELEV_RE.sub("", desc).strip()
            if stripped.lower() != desc.lower().strip():
                key = _clean_desc(stripped)
                elev_groups.setdefault(key, []).append(ci)
            else:
                non_elev.append(ci)

        combined = list(non_elev)
        groups_merged = 0
        items_absorbed = 0
        for key, items in elev_groups.items():
            if len(items) >= 2:
                total_amt = sum(float(it.get("carrier_amount", 0) or 0) for it in items)
                best = max(items, key=lambda c: len(c.get("carrier_desc", "")))
                merged = dict(best)
                merged["carrier_desc"] = _ELEV_RE.sub("", merged.get("carrier_desc", "")).strip()
                merged["carrier_amount"] = round(total_amt, 2)
                merged["_aggregated_elevations"] = len(items)
                combined.append(merged)
                groups_merged += 1
                items_absorbed += len(items) - 1
            else:
                combined.extend(items)

        if groups_merged:
            print(f"[SCOPE MATCH] Elevation aggregation: {items_absorbed + groups_merged} per-elevation items → {groups_merged} combined")

        return combined

    # ── CARRIER TRICKS DATABASE ──────────────────────────────────────
    # Known carrier patterns where items are disguised or misrepresented
    CARRIER_TRICKS = {
        "starter_as_shingle": {
            "desc_pattern": re.compile(r"3[- ]?tab.*(?:25|20)\s*yr", re.I),
            "note_pattern": re.compile(r"starter|start\s*course|eave\s*course", re.I),
            "actual_intent": "starter",
            "usarm_match_desc": "starter",
            "flag": "Carrier using 3-tab shingle line item for starter course — massive underpayment vs proper starter strip",
        },
        "ridge_as_shingle": {
            "desc_pattern": re.compile(r"3[- ]?tab.*(?:25|20)\s*yr", re.I),
            "note_pattern": re.compile(r"ridge|cap|hip.*cap", re.I),
            "actual_intent": "ridge_cap",
            "usarm_match_desc": "ridge cap",
            "flag": "Carrier using 3-tab shingle line item for ridge cap — should be proper hip/ridge cap",
        },
        "felt_bundled_in_shingle": {
            "desc_pattern": re.compile(r"comp.*shingle.*w/\s*felt|shingle.*rfg.*w/\s*felt", re.I),
            "note_pattern": None,
            "actual_intent": "shingle_with_felt",
            "usarm_match_desc": "comp shingle",
            "flag": "Carrier bundled felt with shingle install — felt should be separate line item per Xactimate standards",
        },
        "hover_measurements": {
            "desc_pattern": None,
            "note_pattern": re.compile(r"hover|HOVER|Hover\s*measurements?", re.I),
            "actual_intent": None,
            "usarm_match_desc": None,
            "flag": "Carrier used HOVER measurements instead of EagleView — HOVER known for measurement inaccuracies",
        },
    }

    # ── INTENT KEYWORD MAPPING ────────────────────────────────────
    # Each USARM line item category maps to keywords for searching carrier scope by INTENT
    _INTENT_KEYWORDS = {
        "starter": ["starter", "start course", "eave course"],
        "ridge cap": ["ridge cap", "cap shingle", "hip cap", "ridge shingle"],
        "ridge vent": ["ridge vent", "continuous vent", "shingle-over vent"],
        "ice & water": ["ice", "i&w", "ice barrier", "leak barrier", "ice water", "weather watch"],
        "felt": ["felt", "underlayment", "synthetic underlayment", "deck armor"],
        "drip edge": ["drip edge", "drip-edge", "eave/rake metal", "eave metal", "rake metal"],
        "step flash": ["step flash", "wall flash", "step metal"],
        "counter flash": ["counter flash", "apron flash", "counter metal"],
        "chimney flash": ["chimney flash", "chimney metal"],
        "pipe jack": ["pipe jack", "pipe boot", "pipe flash", "plumbing vent", "roof jack"],
        "skylight": ["skylight flash", "skylight", "velux"],
        "steep": ["steep", "pitch charge", "slope charge"],
        "high roof": ["high roof", "2 stor", "two stor", "height charge"],
        "gutter": ["gutter", "seamless aluminum"],
        "downspout": ["downspout", "down spout"],
        "dumpster": ["dumpster", "debris", "haul away", "dump trailer"],
        "comp shingle": ["comp shingle", "laminated", "architectural shingle", "dimensional shingle"],
        "3-tab": ["3-tab", "3 tab", "three tab"],
        "remove": ["tear off", "tear-off", "tearoff", "remove", "strip"],
        "siding": ["siding", "vinyl sid", "aluminum sid", "cedar sid"],
        "house wrap": ["house wrap", "housewrap", "tyvek", "water-resistive"],
        "window wrap": ["window wrap", "window trim", "j-channel"],
        "insulation board": ["insulation board", "fan fold", "fanfold"],
        "permit": ["permit"],
        "labor": ["labor minim", "minimum charge"],
    }

    @staticmethod
    def _get_intent_keywords(usarm_desc: str) -> list[str]:
        """Get intent keywords for searching carrier scope given a USARM description."""
        desc_lower = usarm_desc.lower()
        # Strip "w/out X" and "without X" phrases — these are NEGATIONS, not intent
        # e.g., "comp. shingle rfg. - w/out felt" means WITHOUT felt
        negated_terms = set()
        for neg_match in re.finditer(r"(?:w/out|without|w/o|excluding)\s+(\w+)", desc_lower):
            negated_terms.add(neg_match.group(1))
        keywords = []
        for category, kws in XactRegistry._INTENT_KEYWORDS.items():
            # Skip category if its name is a negated term
            if any(neg in category for neg in negated_terms):
                continue
            # Match if category name appears in description OR first 2 keywords match
            if category in desc_lower or any(kw in desc_lower for kw in kws[:2]):
                keywords.extend(kws)
        # Also include raw words from the description as fallback
        if not keywords:
            keywords = [w for w in desc_lower.split() if len(w) > 3 and w not in _STOP_WORDS]
        return keywords

    def _detect_carrier_trick(self, carrier_item: dict, expected_usarm_desc: str):
        """Check if a carrier item is using a trick for the expected USARM item."""
        carrier_desc = (carrier_item.get("carrier_desc") or carrier_item.get("item") or "").lower()
        carrier_notes = (carrier_item.get("notes") or "").lower()
        combined = f"{carrier_desc} {carrier_notes}"

        for trick_name, trick in self.CARRIER_TRICKS.items():
            desc_match = trick["desc_pattern"].search(carrier_desc) if trick["desc_pattern"] else False
            note_match = trick["note_pattern"].search(combined) if trick["note_pattern"] else False

            # The trick applies if carrier item matches trick pattern AND
            # the expected USARM item matches the trick's actual intent
            if desc_match or note_match:
                actual_intent = trick.get("actual_intent") or ""
                usarm_match_desc = trick.get("usarm_match_desc") or ""
                expected_lower = expected_usarm_desc.lower()
                if usarm_match_desc and usarm_match_desc in expected_lower:
                    return {"name": trick_name, "flag": trick["flag"]}

        return None

    @staticmethod
    def _action_compatible(usarm_desc: str, carrier_item: dict) -> bool:
        """Check if USARM and carrier items have compatible actions (remove vs install)."""
        usarm_lower = usarm_desc.lower()
        carrier_desc = (carrier_item.get("carrier_desc") or carrier_item.get("item") or "").lower()
        usarm_is_remove = "remove" in usarm_lower or "tear" in usarm_lower
        carrier_is_remove = "remove" in carrier_desc or "tear" in carrier_desc
        # Both remove, both install, or R&R = compatible
        if usarm_is_remove == carrier_is_remove:
            return True
        # R&R items are compatible with either
        if "r&r" in usarm_lower or "r&r" in carrier_desc:
            return True
        return False

    def pre_match_scope_comparison(self, carrier_line_items, usarm_line_items,
                                    measurements=None, state=None, config_hints=None):
        """EagleView ground-truth-first scope comparison (Tom's Co-work methodology).

        CORRECT ORDER (measurements first → carrier second → contractor third):
          Pass 1: Build EagleView checklist from measurements (ground truth — FIRST)
          Pass 2: Aggregate carrier tear-out/supply/install triples (carrier — SECOND)
          Pass 3: Build USARM lookup for pricing enrichment
          Pass 4: FOR EACH checklist item, search carrier by INTENT
                  Search order: notes → description keywords → code → fuzzy
          Pass 5: USARM extras (items not in measurement checklist)
          Pass 6: Carrier-only items

        Args:
            carrier_line_items: Carrier's scope line items (with notes field)
            usarm_line_items: USARM estimate line items (for pricing enrichment)
            measurements: EagleView measurements dict (ground truth)
            state: 2-letter state code for jurisdiction-specific formulas
            config_hints: dict with shingle_type, etc. for checklist builder

        Returns list of comparison rows with full data model.
        """
        meas = measurements or {}
        tricks_detected = []
        used_carrier_indices = set()
        comparison_rows = []

        # ── PASS 1: Build EagleView checklist from measurements (ground truth — MUST be first) ──
        # Tom's methodology: measurements determine what line items SHOULD exist.
        # Carrier data is NOT consulted until after the checklist is established.
        if meas and any(v for v in meas.values() if v):
            checklist = self.build_line_items(meas, config_hints=config_hints, state=state)
            # Enrich with 4-layer code citations (IRC/RCNYS + manufacturer specs)
            try:
                from code_compliance import enrich_line_items_with_citations
                enrich_line_items_with_citations(checklist, state or "NY")
            except ImportError:
                pass  # code_compliance not available (standalone testing)
            # ev_formula is stamped on each item inside build_line_items() at computation time
            print(f"[SCOPE MATCH] EagleView checklist: {len(checklist)} expected items from measurements", flush=True)
            # Debug: show first items from checklist
            for _i, _cl in enumerate(checklist[:5]):
                print(f"[SCOPE DEBUG] Checklist[{_i}]: {_cl.get('description','')[:60]}", flush=True)
        else:
            # Fallback: use USARM items as checklist when no measurements
            checklist = list(usarm_line_items)
            print(f"[SCOPE MATCH] WARNING: No measurements — falling back to USARM items as checklist. meas={meas}", flush=True)

        # ── PASS 2: Aggregate carrier triples (processed AFTER measurements checklist) ──
        carrier_items = self._aggregate_carrier_triples(carrier_line_items)
        # Classify each carrier item into a section for section-restricted matching
        carrier_sections = {}
        for ci_idx, ci in enumerate(carrier_items):
            ci_desc = ci.get("carrier_desc") or ci.get("item") or ""
            ci_notes = ci.get("notes") or ""
            carrier_sections[ci_idx] = self._classify_carrier_section(ci_desc, ci_notes)
        # Debug: show carrier items after checklist is established
        for _i, _ci in enumerate(carrier_items[:8]):
            _cd = _ci.get('carrier_desc') or _ci.get('item','')
            _cn = _ci.get('notes','')
            print(f"[SCOPE DEBUG] Carrier[{_i}]: desc={_cd[:60]} section={carrier_sections.get(_i,'?')} notes={_cn[:40]}", flush=True)

        # ── PASS 3: Build USARM lookup for pricing enrichment ──
        usarm_by_clean_desc = {}
        for li in usarm_line_items:
            key = _clean_desc(li.get("description", ""))
            usarm_by_clean_desc[key] = li

        # Track which USARM items were matched to checklist items
        used_usarm_clean_descs = set()

        # ── PASS 4: FOR EACH checklist item, search carrier by INTENT ──
        for expected_item in checklist:
            expected_desc = expected_item.get("description", "")
            expected_code = (expected_item.get("code") or "").upper().strip()
            ev_qty = expected_item.get("qty", 0)
            ev_unit = expected_item.get("unit", "")
            xact_unit_price = expected_item.get("unit_price", 0)

            if ev_qty <= 0:
                continue

            intent_kws = self._get_intent_keywords(expected_desc)
            found_carrier = None
            match_method = None

            # Determine which section this checklist item belongs to
            item_section = (expected_item.get("category") or "ROOFING").upper()
            if item_section in ("CODE COMPLIANCE",):
                item_section = "GENERAL"
            # Map to the section classifier's output values
            _section_map = {"ROOFING": "ROOFING", "SIDING": "SIDING", "GUTTERS": "GUTTERS", "GENERAL": "GENERAL"}
            item_section = _section_map.get(item_section, item_section)

            # ── Search 1: Intent via NOTES (highest priority!) ──
            # Catches 3-tab-as-starter because notes say "starter course"
            # BUT: notes matches must pass description cross-check — a carrier item
            # whose DESCRIPTION is from a different sub-category should not match
            # just because its notes mention the keyword in passing context
            if intent_kws:
                best_notes_ci = None
                best_notes_idx = None
                best_notes_hits = 0
                for ci_idx, ci in enumerate(carrier_items):
                    if ci_idx in used_carrier_indices:
                        continue
                    # Section restriction: only match within the same section
                    if carrier_sections.get(ci_idx, "UNKNOWN") != item_section and carrier_sections.get(ci_idx) != "UNKNOWN":
                        continue
                    ci_notes = (ci.get("notes") or "").lower()
                    if not ci_notes:
                        continue
                    hits = sum(1 for kw in intent_kws if kw in ci_notes)
                    if hits > 0 and hits > best_notes_hits:
                        ci_desc = ci.get("carrier_desc", "") or ci.get("item", "")
                        if not self._check_negative_exclusion(ci_desc, expected_desc):
                            if self._action_compatible(expected_desc, ci):
                                # Cross-check: also verify carrier description doesn't
                                # belong to a clearly different item category.
                                # Notes can mention other items in context ("for use with
                                # shingles") without the item itself being that category.
                                ci_desc_lower = ci_desc.lower()
                                desc_also_matches = any(kw in ci_desc_lower for kw in intent_kws)
                                if desc_also_matches or hits >= 2:
                                    best_notes_ci = ci
                                    best_notes_idx = ci_idx
                                    best_notes_hits = hits
                if best_notes_ci is not None:
                    found_carrier = (best_notes_idx, best_notes_ci)
                    match_method = "intent_notes"

            # ── Search 2: Intent via description keywords ──
            if not found_carrier and intent_kws:
                best_desc_ci = None
                best_desc_idx = None
                best_desc_hits = 0
                for ci_idx, ci in enumerate(carrier_items):
                    if ci_idx in used_carrier_indices:
                        continue
                    if carrier_sections.get(ci_idx, "UNKNOWN") != item_section and carrier_sections.get(ci_idx) != "UNKNOWN":
                        continue
                    ci_desc = (ci.get("carrier_desc") or ci.get("item") or "").lower()
                    hits = sum(1 for kw in intent_kws if kw in ci_desc)
                    if hits > 0 and hits > best_desc_hits:
                        if not self._check_negative_exclusion(ci_desc, expected_desc):
                            if self._action_compatible(expected_desc, ci):
                                best_desc_ci = ci
                                best_desc_idx = ci_idx
                                best_desc_hits = hits
                if best_desc_ci is not None:
                    found_carrier = (best_desc_idx, best_desc_ci)
                    match_method = "intent_desc"

            # ── Search 3: Xact code match (ONLY after intent fails) ──
            # Code is the TRAP — "3-tab" code matches wrong items
            if not found_carrier and expected_code:
                for ci_idx, ci in enumerate(carrier_items):
                    if ci_idx in used_carrier_indices:
                        continue
                    if carrier_sections.get(ci_idx, "UNKNOWN") != item_section and carrier_sections.get(ci_idx) != "UNKNOWN":
                        continue
                    if (ci.get("xact_code") or "").upper().strip() == expected_code:
                        if self._action_compatible(expected_desc, ci):
                            found_carrier = (ci_idx, ci)
                            match_method = "code"
                            break

            # ── Search 4: Fuzzy fallback (lowest priority) ──
            if not found_carrier:
                expected_clean = _clean_desc(expected_desc)
                expected_words = _desc_words(expected_clean)
                best_score = 0.0
                best_fuzzy = None
                for ci_idx, ci in enumerate(carrier_items):
                    if ci_idx in used_carrier_indices:
                        continue
                    if carrier_sections.get(ci_idx, "UNKNOWN") != item_section and carrier_sections.get(ci_idx) != "UNKNOWN":
                        continue
                    ci_desc = ci.get("carrier_desc", "") or ci.get("item", "")
                    if self._check_negative_exclusion(ci_desc, expected_desc):
                        continue
                    ci_clean = _clean_desc(ci_desc)
                    if ci_clean in expected_clean or expected_clean in ci_clean:
                        best_fuzzy = (ci_idx, ci)
                        best_score = 1.0
                        break
                    ci_words = _desc_words(ci_clean)
                    overlap = ci_words & expected_words
                    word_score = 0.0
                    if len(overlap) >= 3 or (len(overlap) >= 2 and len(expected_words) <= 4):
                        word_score = 0.4
                    ci_mats = ci_words & _MATERIAL_KEYWORDS
                    exp_mats = expected_words & _MATERIAL_KEYWORDS
                    if ci_mats and ci_mats == exp_mats:
                        word_score += 0.2
                    sim = _similarity(ci_clean, expected_clean)
                    score = sim + word_score
                    if score > best_score and score >= 0.45:
                        best_score = score
                        best_fuzzy = (ci_idx, ci)
                if best_fuzzy and best_score >= 0.45:
                    found_carrier = best_fuzzy
                    match_method = "fuzzy"

            # ── USARM pricing enrichment ──
            usarm_item = usarm_by_clean_desc.get(_clean_desc(expected_desc))
            usarm_amount = 0
            usarm_desc = ""
            if usarm_item:
                usarm_amount = round(usarm_item["qty"] * usarm_item["unit_price"], 2)
                usarm_desc = usarm_item["description"]
                used_usarm_clean_descs.add(_clean_desc(expected_desc))

            # ── Build comparison row ──
            row = {
                # Checklist (ground truth)
                "checklist_desc": expected_desc,
                "ev_qty": ev_qty,
                "ev_unit": ev_unit,
                "ev_formula": expected_item.get("ev_formula", ""),
                "xact_code": expected_code,
                "xact_unit_price": xact_unit_price,
                # USARM enrichment
                "usarm_desc": usarm_desc or expected_desc,
                "usarm_amount": usarm_amount or round(ev_qty * xact_unit_price, 2),
                # Code compliance (4-layer)
                "code_citation": expected_item.get("code_citation"),
                "irc_code": expected_item.get("irc_code", ""),
                "supplement_argument": expected_item.get("supplement_argument", ""),
                # Grouping
                "category": expected_item.get("category", "ROOFING"),
                "trade": expected_item.get("trade", "roofing"),
            }

            if found_carrier:
                ci_idx, ci = found_carrier
                used_carrier_indices.add(ci_idx)
                carrier_qty = ci.get("qty", 0) or 0
                carrier_amt = ci.get("carrier_amount", 0) or 0
                carrier_up = ci.get("unit_price", 0) or 0
                ci_desc = ci.get("carrier_desc") or ci.get("item", "")
                ci_notes = ci.get("notes", "") or ""

                row["item"] = ci.get("item") or ci_desc
                row["carrier_desc"] = ci_desc
                row["carrier_amount"] = carrier_amt
                row["carrier_qty"] = carrier_qty
                row["carrier_unit"] = ci.get("unit", "")
                row["carrier_unit_price"] = carrier_up
                row["carrier_notes"] = ci_notes
                row["matched_by"] = match_method

                # Carrier trick detection (runs on EVERY match)
                trick = self._detect_carrier_trick(ci, expected_desc)
                if trick:
                    row["carrier_trick"] = trick["name"]
                    row["trick_flag"] = trick["flag"]
                    tricks_detected.append(trick["name"])

                # HOVER detection
                if re.search(r"hover|HOVER|Hover\s*measurements?", ci_notes, re.I):
                    row["measurement_source"] = "HOVER"
                    row.setdefault("flags", []).append(
                        self.CARRIER_TRICKS.get("hover_measurements", {}).get("flag", "HOVER measurements detected")
                    )
                    if "hover_detected" not in tricks_detected:
                        tricks_detected.append("hover_detected")

                # Unit mismatch detection
                carrier_unit = (ci.get("unit") or "").upper()
                expected_unit_upper = ev_unit.upper() if ev_unit else ""
                if carrier_unit and expected_unit_upper and carrier_unit != expected_unit_upper:
                    row["unit_mismatch"] = f"Carrier: {carrier_unit}, Expected: {expected_unit_upper}"

                # ── QTY-FOCUSED COMPARISON (Tom's methodology) ──
                # Focus on material, quantity, unit price, and code/manufacturer requirements.
                # Dollar amounts appear only as supplement_value, not as the primary comparison.
                qty_diff = ev_qty - carrier_qty if ev_qty > 0 else 0
                compare_amount = row["usarm_amount"]
                supplement_value = max(0, compare_amount - carrier_amt)
                row["supplement_value"] = round(supplement_value, 2)

                # Price comparison: carrier unit_price vs Xactimate price list
                if carrier_up > 0 and xact_unit_price > 0:
                    price_diff = xact_unit_price - carrier_up
                    if abs(price_diff) > 0.50:
                        row["price_variance"] = f"Xact: ${xact_unit_price:.2f}, Carrier: ${carrier_up:.2f}"

                trick_flag = row.get("trick_flag", "")
                code_cit = row.get("code_citation")
                supp_arg = row.get("supplement_argument", "")
                ev_formula = row.get("ev_formula", "")

                if row.get("unit_mismatch"):
                    row["status"] = "under"
                    parts = [f"UNIT MISMATCH: {row['unit_mismatch']}"]
                    if ev_formula:
                        parts.append(f"Required: {ev_qty:.0f} {ev_unit} ({ev_formula})")
                    if code_cit:
                        parts.append(f"Per {code_cit['code_tag']}: {code_cit['requirement']}")
                    if trick_flag:
                        parts.append(trick_flag)
                    row["note"] = ". ".join(parts)
                elif not row.get("unit_mismatch") and ev_qty > 0 and carrier_qty > 0 and abs(qty_diff) > 1:
                    # Quantity shortfall — PRIMARY comparison metric
                    row["status"] = "under" if qty_diff > 0 else ("over" if qty_diff < -1 else "match")
                    parts = []
                    parts.append(f"Required: {ev_qty:.0f} {ev_unit} @ ${xact_unit_price:.2f}/{ev_unit}" if xact_unit_price else f"Required: {ev_qty:.0f} {ev_unit}")
                    parts.append(f"Carrier: {carrier_qty:.0f} {ev_unit}" + (f" @ ${carrier_up:.2f}/{ev_unit}" if carrier_up else ""))
                    if qty_diff > 0:
                        parts.append(f"Carrier is {qty_diff:.0f} {ev_unit} short")
                    if ev_formula:
                        parts.append(f"Calculation: {ev_formula}")
                    if code_cit:
                        parts.append(f"Per {code_cit['code_tag']}: {code_cit['requirement']}")
                        mfr_specs = code_cit.get("manufacturer_specs", [])
                        for spec in mfr_specs[:2]:
                            if spec.get("warranty_void"):
                                parts.append(f"{spec['manufacturer']} warranty VOID: {spec.get('warranty_text', spec.get('requirement', ''))[:120]}")
                    elif supp_arg:
                        parts.append(supp_arg)
                    if trick_flag:
                        parts.append(trick_flag)
                    row["note"] = ". ".join(parts)
                    row["qty_variance"] = f"Short {qty_diff:.0f} {ev_unit}" if qty_diff > 0 else ""
                elif abs(compare_amount - carrier_amt) < 0.50:
                    row["status"] = "match"
                    row["note"] = f"Carrier includes {carrier_qty:.0f} {ev_unit}" + (f" @ ${carrier_up:.2f}/{ev_unit}" if carrier_up else "")
                elif compare_amount > carrier_amt:
                    row["status"] = "under"
                    parts = []
                    if xact_unit_price and carrier_up and abs(xact_unit_price - carrier_up) > 0.50:
                        parts.append(f"Unit price: Xact ${xact_unit_price:.2f} vs Carrier ${carrier_up:.2f}")
                    if ev_formula:
                        parts.append(f"Required: {ev_qty:.0f} {ev_unit} ({ev_formula})")
                    if code_cit:
                        parts.append(f"Per {code_cit['code_tag']}: {code_cit['requirement']}")
                    elif supp_arg:
                        parts.append(supp_arg)
                    if trick_flag:
                        parts.append(trick_flag)
                    row["note"] = ". ".join(parts) if parts else f"Carrier: {carrier_qty:.0f} {ev_unit}, Required: {ev_qty:.0f} {ev_unit}"
                else:
                    row["status"] = "over"
                    row["note"] = f"Carrier includes {carrier_qty:.0f} {ev_unit}" + (f" @ ${carrier_up:.2f}/{ev_unit}" if carrier_up else "")
            else:
                # MISSING — carrier didn't include this item (supplement opportunity)
                row["item"] = expected_desc
                row["carrier_desc"] = "NOT INCLUDED"
                row["carrier_amount"] = 0
                row["carrier_qty"] = 0
                row["matched_by"] = "missing"
                row["status"] = "missing"
                row["supplement_value"] = round(ev_qty * xact_unit_price, 2) if xact_unit_price else row.get("usarm_amount", 0)

                parts = [f"NOT INCLUDED — Required: {ev_qty:.0f} {ev_unit}" + (f" @ ${xact_unit_price:.2f}/{ev_unit}" if xact_unit_price else "")]
                ev_formula = row.get("ev_formula", "")
                if ev_formula:
                    parts.append(f"Calculation: {ev_formula}")
                code_cit = row.get("code_citation")
                if code_cit:
                    parts.append(f"Per {code_cit['code_tag']}: {code_cit['requirement']}")
                    mfr_specs = code_cit.get("manufacturer_specs", [])
                    for spec in mfr_specs[:2]:
                        if spec.get("warranty_void"):
                            parts.append(f"{spec['manufacturer']} warranty VOID: {spec.get('warranty_text', spec.get('requirement', ''))[:120]}")
                elif row.get("irc_code"):
                    parts.append(f"Required per {row['irc_code']}")
                if row.get("supplement_argument"):
                    parts.append(row["supplement_argument"])
                row["note"] = ". ".join(parts)

            comparison_rows.append(row)

        if tricks_detected:
            print(f"[SCOPE MATCH] Carrier tricks detected: {tricks_detected}", flush=True)

        # ── PASS 5: USARM extras (items not in measurement checklist) ──
        # Only add items genuinely NOT covered by the checklist.
        # Build a set of cleaned checklist descriptions for fuzzy dedup.
        _checklist_clean_descs = set()
        _checklist_words_set = []
        for cl_item in checklist:
            cd = _clean_desc(cl_item.get("description", ""))
            _checklist_clean_descs.add(cd)
            _checklist_words_set.append(_desc_words(cd))

        for li in usarm_line_items:
            clean_key = _clean_desc(li.get("description", ""))
            # Exact match check
            if clean_key in used_usarm_clean_descs or clean_key in _checklist_clean_descs:
                continue
            # Fuzzy check — skip if this USARM item overlaps significantly with ANY checklist item
            usarm_words = _desc_words(clean_key)
            is_dup = False
            for cw in _checklist_words_set:
                overlap = usarm_words & cw
                if len(overlap) >= 2 or _similarity(clean_key, " ".join(cw)) >= 0.6:
                    is_dup = True
                    break
                # Substring check
                cw_str = " ".join(cw)
                if clean_key in cw_str or cw_str in clean_key:
                    is_dup = True
                    break
            if is_dup:
                continue
            ext = round(li.get("qty", 0) * li.get("unit_price", 0), 2)
            if ext < 10:
                continue
            # Search carrier for this USARM extra using same intent logic (section-restricted)
            usarm_desc = li.get("description", "")
            usarm_section = (li.get("category") or "").upper()
            if usarm_section in ("CODE COMPLIANCE",):
                usarm_section = "GENERAL"
            intent_kws = self._get_intent_keywords(usarm_desc)
            found_ci = None
            for ci_idx, ci in enumerate(carrier_items):
                if ci_idx in used_carrier_indices:
                    continue
                # Section restriction
                ci_section = carrier_sections.get(ci_idx, "UNKNOWN")
                if usarm_section and ci_section != usarm_section and ci_section != "UNKNOWN":
                    continue
                ci_text = f"{ci.get('carrier_desc', '')} {ci.get('notes', '')}".lower()
                if intent_kws and any(kw in ci_text for kw in intent_kws):
                    if self._action_compatible(usarm_desc, ci):
                        found_ci = (ci_idx, ci)
                        break
            extra_row = {
                "checklist_desc": "",
                "usarm_desc": usarm_desc,
                "usarm_amount": ext,
                "ev_qty": li.get("qty", 0),
                "ev_unit": li.get("unit", ""),
                "code_citation": li.get("code_citation"),
                "irc_code": li.get("irc_code", ""),
                "supplement_argument": li.get("supplement_argument", ""),
                "category": li.get("category", ""),
                "trade": li.get("trade", ""),
            }
            if found_ci:
                ci_idx, ci = found_ci
                used_carrier_indices.add(ci_idx)
                carrier_amt = ci.get("carrier_amount", 0) or 0
                carrier_qty = ci.get("qty", 0) or 0
                carrier_up = ci.get("unit_price", 0) or 0
                extra_row["item"] = ci.get("item") or ci.get("carrier_desc", "")
                extra_row["carrier_desc"] = ci.get("carrier_desc") or ci.get("item", "")
                extra_row["carrier_amount"] = carrier_amt
                extra_row["carrier_qty"] = carrier_qty
                extra_row["carrier_unit"] = ci.get("unit", "")
                extra_row["carrier_unit_price"] = carrier_up
                extra_row["carrier_notes"] = ci.get("notes", "") or ""
                extra_row["matched_by"] = "usarm_extra"
                diff = ext - carrier_amt
                extra_row["supplement_value"] = round(max(0, diff), 2)
                li_qty = li.get("qty", 0)
                li_unit = li.get("unit", "")
                li_up = li.get("unit_price", 0)
                qty_diff = li_qty - carrier_qty if li_qty and carrier_qty else 0
                if abs(diff) < 0.50:
                    extra_row["status"] = "match"
                    extra_row["note"] = f"Carrier includes {carrier_qty:.0f} {li_unit}" + (f" @ ${carrier_up:.2f}/{li_unit}" if carrier_up else "")
                elif diff > 0:
                    extra_row["status"] = "under"
                    parts = []
                    if qty_diff > 1:
                        parts.append(f"Required: {li_qty:.0f} {li_unit}, Carrier: {carrier_qty:.0f} {li_unit}, Short {qty_diff:.0f} {li_unit}")
                    if li_up and carrier_up and abs(li_up - carrier_up) > 0.50:
                        parts.append(f"Unit price: Xact ${li_up:.2f} vs Carrier ${carrier_up:.2f}")
                    code_cit = li.get("code_citation")
                    if code_cit:
                        parts.append(f"Per {code_cit['code_tag']}: {code_cit.get('requirement', '')[:100]}")
                    extra_row["note"] = ". ".join(parts) if parts else f"Required: {li_qty:.0f} {li_unit}, Carrier: {carrier_qty:.0f} {li_unit}"
                else:
                    extra_row["status"] = "over"
                    extra_row["note"] = f"Carrier includes {carrier_qty:.0f} {li_unit}" + (f" @ ${carrier_up:.2f}/{li_unit}" if carrier_up else "")
            else:
                li_qty = li.get("qty", 0)
                li_unit = li.get("unit", "")
                li_up = li.get("unit_price", 0)
                extra_row["carrier_desc"] = "NOT INCLUDED"
                extra_row["carrier_amount"] = 0
                extra_row["carrier_qty"] = 0
                extra_row["matched_by"] = "missing"
                extra_row["status"] = "missing"
                extra_row["supplement_value"] = round(ext, 2)
                parts = [f"NOT INCLUDED — Required: {li_qty:.0f} {li_unit}" + (f" @ ${li_up:.2f}/{li_unit}" if li_up else "")]
                code_cit = li.get("code_citation")
                if code_cit:
                    parts.append(f"Per {code_cit['code_tag']}: {code_cit.get('requirement', '')[:100]}")
                elif li.get("supplement_argument"):
                    parts.append(li["supplement_argument"])
                extra_row["note"] = ". ".join(parts)
            comparison_rows.append(extra_row)

        # ── PASS 6: Carrier-only items (grouped by their section) ──
        for ci_idx, ci in enumerate(carrier_items):
            if ci_idx in used_carrier_indices:
                continue
            carrier_amt = ci.get("carrier_amount", 0) or 0
            if carrier_amt < 5:
                continue
            ci_desc = ci.get("carrier_desc") or ci.get("item", "")
            ci_section = carrier_sections.get(ci_idx, "GENERAL")
            carrier_qty = ci.get("qty", 0) or 0
            carrier_unit = ci.get("unit", "")
            comparison_rows.append({
                "item": ci.get("item") or ci_desc,
                "carrier_desc": ci_desc,
                "carrier_amount": carrier_amt,
                "carrier_qty": carrier_qty,
                "carrier_unit": carrier_unit,
                "usarm_desc": "",
                "usarm_amount": 0,
                "matched_by": "carrier_only",
                "status": "carrier_only",
                "category": ci_section,
                "trade": ci_section.lower(),
                "note": f"Carrier-only: {carrier_qty:.0f} {carrier_unit}" + (f" @ ${ci.get('unit_price', 0):.2f}/{carrier_unit}" if ci.get('unit_price') else "") + " — not on EagleView checklist",
                "review_flag": "Verify: legitimate scope item or padding?",
                "xact_code": ci.get("xact_code", ""),
                "supplement_value": 0,
            })

        # Sort by section (ROOFING → GUTTERS → SIDING → GENERAL) with carrier-only at end of each section
        _CAT_SORT = {"ROOFING": 0, "GUTTERS": 1, "SIDING": 2, "INTERIOR": 3, "GENERAL": 4, "CODE COMPLIANCE": 4, "DEBRIS": 5, "UNKNOWN": 6}
        comparison_rows.sort(key=lambda x: (
            _CAT_SORT.get((x.get("category") or "").upper(), 99),
            0 if x.get("matched_by") not in ("carrier_only",) else 1,
        ))

        return comparison_rows


    @staticmethod
    def _get_eagleview_qty(usarm_desc: str, measurements: dict):
        """Look up the EagleView ground-truth quantity for a USARM line item description.

        Maps description keywords to measurement fields for qty validation.
        """
        desc = usarm_desc.lower()
        _MEAS_MAP = {
            "ridge": "ridge_lf",
            "eave": "eave_lf",
            "rake": "rake_lf",
            "valley": "valley_lf",
            "drip edge": "eave_lf",  # drip edge = eave + rake
            "step flash": "step_lf",
            "gutter": "gutter_lf",
        }
        for keyword, meas_key in _MEAS_MAP.items():
            if keyword in desc:
                val = measurements.get(meas_key, 0)
                # Drip edge is eave + rake
                if keyword == "drip edge":
                    val = measurements.get("eave_lf", 0) + measurements.get("rake_lf", 0)
                return val

        # Roof area items (SQ)
        if any(k in desc for k in ("shingle", "roofing", "comp", "laminated", "slate")):
            return measurements.get("install_sq") or measurements.get("remove_sq")

        return None

    # ------------------------------------------------------------------
    # 6. Find Missing Items (Level 3 Feature)
    # ------------------------------------------------------------------

    def find_missing_items(self, carrier_line_items, measurements, market=None):
        """Identify IRC-required items missing from a carrier scope.

        Returns list of dicts: {description, irc_code, supplement_argument, estimated_qty, estimated_amount}
        """
        # Build what we'd include
        expected = self.build_line_items(measurements)
        expected_mandatory = [
            li for li in expected
            if self._is_mandatory(li["description"])
        ]

        # What the carrier included (by description matching)
        carrier_descs = set()
        for ci in carrier_line_items:
            desc = ci.get("carrier_desc", "") or ci.get("item", "")
            carrier_descs.add(_clean_desc(desc))

        missing = []
        for li in expected_mandatory:
            li_clean = _clean_desc(li["description"])

            # Check if carrier has something similar
            found = False
            for cd in carrier_descs:
                if cd in li_clean or li_clean in cd:
                    found = True
                    break
                if _similarity(cd, li_clean) >= 0.6:
                    found = True
                    break
                cd_words = _desc_words(cd)
                li_words = _desc_words(li_clean)
                overlap = cd_words & li_words
                if len(overlap) >= 3 or (len(overlap) >= 2 and len(li_words) <= 4):
                    found = True
                    break

            if not found:
                # Look up IRC info from registry
                reg_item = self.lookup_price(li["description"])
                irc_code = reg_item.get("irc_code") if reg_item else None
                supplement = reg_item.get("supplement_argument") if reg_item else None
                ext = round(li["qty"] * li["unit_price"], 2)

                missing.append({
                    "description": li["description"],
                    "irc_code": irc_code,
                    "supplement_argument": supplement,
                    "estimated_qty": li["qty"],
                    "unit": li["unit"],
                    "unit_price": li["unit_price"],
                    "estimated_amount": ext,
                })

        return missing

    def _is_mandatory(self, description):
        """Check if an item description matches a mandatory item."""
        desc_lower = description.lower()
        for item in self.items:
            if item.get("mandatory") and item["description"].lower() in desc_lower:
                return True
            if item.get("mandatory") and desc_lower in item["description"].lower():
                return True
        return False


# ======================================================================
# CLI for quick testing
# ======================================================================

if __name__ == "__main__":
    import sys

    reg = XactRegistry()
    print(f"Xactimate Registry v{reg.version} — {reg.market_name}")
    print(f"{len(reg.items)} items loaded\n")

    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        item = reg.lookup_price(query)
        if item:
            print(f"Match: {item['description']}")
            print(f"  Code: {item.get('xact_code', 'N/A')}")
            print(f"  Action: {item['action']}")
            print(f"  Price: ${item['unit_price']:.2f}/{item['unit']}")
            if item.get("irc_code"):
                print(f"  IRC: {item['irc_code']}")
            if item.get("supplement_argument"):
                print(f"  Supplement: {item['supplement_argument']}")
        else:
            print(f"No match found for: {query}")
    else:
        # Demo: build estimate from sample measurements
        sample = {
            "remove_sq": 19.27,
            "install_sq": 22,
            "ridge_lf": 88,
            "eave_lf": 109,
            "rake_lf": 165,
            "valley_lf": 61,
            "step_lf": 9,
            "penetrations": 0,
            "chimneys": 0,
            "pitch": 4,
            "stories": 1,
        }
        print("Demo: Building estimate from DUNLAP_18KENDALLAVE measurements")
        print(f"  Remove: {sample['remove_sq']} SQ | Install: {sample['install_sq']} SQ")
        print()

        items = reg.build_line_items(sample)
        total = 0
        for li in items:
            ext = round(li["qty"] * li["unit_price"], 2)
            total += ext
            print(f"  {li['description'][:55]:<55} {li['qty']:>8.2f} {li['unit']:<3} ${li['unit_price']:>9.2f}  = ${ext:>10.2f}")

        print(f"\n  {'Line Item Total':<55} {'':>8} {'':>3} {'':>10}    ${total:>10.2f}")
        tax = round(total * reg.tax_rate, 2)
        print(f"  {'Tax (' + str(reg.tax_rate*100) + '%)':<55} {'':>8} {'':>3} {'':>10}    ${tax:>10.2f}")
        print(f"  {'RCV':<55} {'':>8} {'':>3} {'':>10}    ${total + tax:>10.2f}")

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
}

# Default market per state (for states with multiple markets)
DEFAULT_MARKETS = {
    "NY": "NYBI8X_MAR26",
    "NJ": "NJCA8X_MAR26",
    "PA": "PAPH8X_MAR26",
    "MD": "MDBA8X_MAR26",
    "DE": "DEDO8X_MAR26",
}

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

# Prefixes/stopwords stripped during fuzzy matching
_PFX_RE = re.compile(
    r"^(r&r\s+|remove\s+|install\s+|detach\s*&?\s*reset\s+)", re.IGNORECASE
)
_SECTION_RE = re.compile(
    r"^(shed|dwelling\s*roof|front\s*elevation|rear\s*elevation|"
    r"left\s*elevation|right\s*elevation|debris\s*removal|"
    r"interior|garage|porch)\s*[-–—]\s*",
    re.IGNORECASE,
)
_ITEM_NUM_RE = re.compile(r"\s*[-–—]?\s*item\s*\d+\s*$", re.IGNORECASE)
_STOP_WORDS = frozenset(
    {"the", "a", "an", "for", "of", "and", "or", "w/", "w/out", "-", "to", "per"}
)


@functools.lru_cache(maxsize=512)
def _clean_desc(desc):
    """Strip action prefixes, section headers, item numbers, and normalize."""
    d = desc.lower().strip()
    d = _SECTION_RE.sub("", d).strip()
    d = _ITEM_NUM_RE.sub("", d).strip()
    d = _PFX_RE.sub("", d).strip()
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

        Returns market code string. For states not in DEFAULT_MARKETS, returns
        the default NY market with a warning (pricing will be approximate).
        """
        state_upper = (state or "").upper().strip()
        if not state_upper:
            logger.warning("No state provided for market resolution, defaulting to NY")
            return DEFAULT_MARKETS["NY"]

        default = DEFAULT_MARKETS.get(state_upper)
        if not default:
            logger.warning("State %s not in DEFAULT_MARKETS, defaulting to NY pricing", state_upper)
            return DEFAULT_MARKETS["NY"]

        if not city and not zip_code:
            return default

        # Try to find a better market match by city name using cached data
        if city:
            city_lower = city.lower().strip()
            try:
                all_data = _get_all_markets()
                for code, mdata in all_data.get("markets", {}).items():
                    if not code.startswith(state_upper):
                        continue
                    mname = mdata.get("name", "").lower()
                    if city_lower in mname or mname.split(",")[0].strip() in city_lower:
                        return code
            except (KeyError, AttributeError) as e:
                logger.debug("City matching failed for %s: %s", city, e)

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

    def build_line_items(self, measurements, config_hints=None):
        """Build complete line_items array from EagleView measurements.

        Args:
            measurements: dict with keys matching EagleView output:
                remove_sq, install_sq, ridge_lf, eave_lf, rake_lf,
                valley_lf, step_lf, penetrations, chimneys, pitch,
                stories, gutter_lf, downspout_lf, layers (optional)
            config_hints: dict with optional overrides:
                shingle_type ("laminated"|"3tab"), default "laminated"
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

        # Computed quantities (per CLAUDE.md formulas)
        ice_water_sf = (eave_lf * 6) + (valley_lf * 3)
        felt_sq = max(0, round(((install_sq * 100) - ice_water_sf) / 100, 2))
        starter_lf = eave_lf + rake_lf
        drip_edge_lf = round(starter_lf * 1.05, 2)  # 5% waste
        step_flash_lf = round(step_lf * 1.05, 2) if step_lf > 0 else 0  # 5% waste
        counter_flash_lf = step_flash_lf  # counterflashing same length as step

        items = []

        def _add(desc, qty, action=None, default_trade="roofing"):
            """Look up item by description and add to items list.
            Includes Xactimate code and supplement argument from registry."""
            self._append_item(items, desc, qty, action=action, default_trade=default_trade)

        # ── SHINGLE REMOVAL ──
        if shingle_type == "3tab":
            _add("Remove 3 tab - 25 yr. comp. shingle roofing - w/out felt", remove_sq, action="remove")
        else:
            _add("Remove Laminated comp. shingle rfg. - w/out felt", remove_sq, action="remove")

        # Additional layer removal (if > 1 layer)
        if layers > 1:
            _add("Add. layer of comp. shingles, remove & disp. - Laminated", remove_sq, action="remove")

        # ── SHINGLE INSTALLATION ──
        if shingle_type == "3tab":
            _add("3 tab - 25 yr. comp. shingle roofing - w/out felt", install_sq, action="install")
        else:
            _add("Laminated comp. shingle rfg. - w/out felt", install_sq, action="install")

        # ── UNDERLAYMENT ──
        _add("Roofing felt - 15 lb.", felt_sq, action="install")
        _add("Ice & water barrier", ice_water_sf, action="install")

        # ── STARTER & RIDGE ──
        _add("Asphalt starter - universal starter course", starter_lf, action="install")
        if shingle_type == "3tab":
            _add("R&R Hip/Ridge cap - cut from 3 tab - composition shingles", ridge_lf, action="r&r")
        else:
            _add("R&R Hip / Ridge cap - Standard profile - composition shingles", ridge_lf, action="r&r")

        # ── DRIP EDGE ──
        _add("R&R Drip edge", drip_edge_lf, action="r&r")

        # ── STEP FLASHING ──
        if step_lf > 0:
            _add("Remove Step flashing", step_lf, action="remove")
            _add("Step flashing", step_flash_lf, action="install")

        # ── COUNTERFLASHING / APRON FLASHING ──
        if step_lf > 0:
            _add("Remove Counterflashing - Apron flashing", step_lf, action="remove")
            _add("Counterflashing - Apron flashing", counter_flash_lf, action="install")

        # ── PIPE JACKS ──
        if penetrations > 0:
            _add("R&R Flashing - pipe jack", penetrations, action="r&r")

        # ── CHIMNEY FLASHING ──
        if chimneys > 0:
            _add("R&R Chimney flashing - average (32\" x 36\")", chimneys, action="r&r")

        # ── RIDGE VENT ──
        _add("R&R Continuous ridge vent - shingle-over style", ridge_lf, action="r&r")

        # ── STEEP CHARGES ──
        if pitch >= 7:
            if pitch <= 9:
                _add("Remove Additional charge for steep roof - 7/12 to 9/12 slope", remove_sq, action="remove")
                _add("Additional charge for steep roof - 7/12 to 9/12 slope", install_sq, action="install")
            elif pitch <= 12:
                _add("Remove Additional charge for steep roof - 10/12 to 12/12 slope", remove_sq, action="remove")
                _add("Additional charge for steep roof - 10/12 to 12/12 slope", install_sq, action="install")
            else:
                _add("Remove Additional charge for steep roof greater than 12/12 slope", remove_sq, action="remove")
                _add("Additional charge for steep roof greater than 12/12 slope", install_sq, action="install")

        # ── HIGH ROOF CHARGES ──
        if stories >= 2:
            _add("Remove Additional charge for high roof (2 stories or greater)", remove_sq, action="remove")
            _add("Additional charge for high roof (2 stories or greater)", install_sq, action="install")

        # ── GABLE CORNICE RETURNS ──
        gable_ends = hints.get("gable_ends", 0)
        if gable_ends > 0:
            if stories >= 2:
                _add("R&R Gable cornice return - laminated - 2 stories or greater",
                     gable_ends, action="r&r")
            else:
                _add("R&R Gable cornice return - laminated", gable_ends, action="r&r")

        # ── LABOR & EQUIPMENT (mandatory, scaled by roof size) ──
        roofer_hours = max(4, min(16, round(install_sq / 4)))
        _add("Roofer - per hour", roofer_hours, action="install")
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
            _add("R&R Gutter / downspout - aluminum - up to 5\"", gutter_lf, action="r&r")

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

            # Similarity
            sim = _similarity(carrier_clean, li_clean)
            score = sim + word_score

            if score > best_score:
                best_score = score
                best_item = li

        confidence = min(1.0, best_score)
        if confidence >= 0.5:
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
                            is_split = True
                    else:
                        break
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
                    i = j
                    continue

            aggregated.append(ci)
            i += 1

        if len(aggregated) < len(carrier_line_items):
            print(f"[SCOPE MATCH] Aggregated {len(carrier_line_items)} carrier items → {len(aggregated)} (combined {len(carrier_line_items) - len(aggregated)} split items)")

        return aggregated

    def pre_match_scope_comparison(self, carrier_line_items, usarm_line_items):
        """Pre-compute usarm_desc and usarm_amount for each carrier line item.

        Uses a 4-pass algorithm:
          Pass 0: Aggregate carrier tear-out/supply/install triples into combined R&R
          Pass 1: Code-based matching (exact, O(1)) — highest confidence
          Pass 2: Fuzzy description matching with negative exclusions — fallback
          Pass 3: Identify IRC-required items carrier omitted — appended as "NOT INCLUDED"

        Returns the carrier_line_items list with usarm_desc/usarm_amount/note added.
        """
        # ── PASS 0: Aggregate carrier tear-out/supply/install triples ──
        carrier_line_items = self._aggregate_carrier_triples(carrier_line_items)

        used_indices = set()
        result = []

        # Build code index for USARM items
        usarm_by_code = {}
        for idx, li in enumerate(usarm_line_items):
            code = (li.get("code") or "").upper().strip()
            if code:
                usarm_by_code.setdefault(code, []).append((idx, li))

        # ── PASS 1: Code-based matching ──
        for ci in carrier_line_items:
            ci_copy = dict(ci)
            carrier_code = (ci.get("xact_code") or "").upper().strip()
            carrier_desc = ci.get("carrier_desc", "") or ci.get("item", "")

            matched = False

            if carrier_code:
                # Try exact code match — prefer action-matching candidate
                candidates = usarm_by_code.get(carrier_code, [])
                carrier_is_remove = "remove" in carrier_desc.lower() or "tear" in carrier_desc.lower()
                # Sort candidates: action-matching ones first
                sorted_candidates = sorted(candidates, key=lambda c: (
                    0 if (carrier_is_remove == ("remove" in c[1].get("description", "").lower())) else 1
                ))
                for idx, li in sorted_candidates:
                    if idx in used_indices:
                        continue
                    ext = round(li["qty"] * li["unit_price"], 2)
                    ci_copy["usarm_desc"] = li["description"]
                    ci_copy["usarm_amount"] = ext
                    ci_copy["matched_by"] = "code"
                    ci_copy["supplement_argument"] = li.get("supplement_argument", "")
                    used_indices.add(idx)
                    matched = True
                    break

            if not matched:
                # Try to identify code from description via registry lookup
                reg_item = self.lookup_price(carrier_desc)
                if reg_item:
                    reg_code = (reg_item.get("xact_code") or "").upper()
                    if reg_code:
                        candidates = usarm_by_code.get(reg_code, [])
                        # Sort by action match (same fix as Pass 1)
                        sorted_cands = sorted(candidates, key=lambda c: (
                            0 if (carrier_is_remove == ("remove" in c[1].get("description", "").lower())) else 1
                        ))
                        for idx, li in sorted_cands:
                            if idx in used_indices:
                                continue
                            ext = round(li["qty"] * li["unit_price"], 2)
                            ci_copy["usarm_desc"] = li["description"]
                            ci_copy["usarm_amount"] = ext
                            ci_copy["matched_by"] = "code_inferred"
                            ci_copy["supplement_argument"] = li.get("supplement_argument", "")
                            used_indices.add(idx)
                            matched = True
                            break

            if not matched:
                ci_copy["_needs_fuzzy"] = True

            result.append(ci_copy)

        # ── PASS 2: Fuzzy matching for unmatched items ──
        for ci_copy in result:
            if not ci_copy.pop("_needs_fuzzy", False):
                continue

            carrier_desc = ci_copy.get("carrier_desc", "") or ci_copy.get("item", "")

            # Pass ALL remaining items to find the BEST match (not just first above threshold)
            remaining = [li for idx, li in enumerate(usarm_line_items)
                         if idx not in used_indices]
            remaining_indices = [idx for idx in range(len(usarm_line_items))
                                 if idx not in used_indices]

            if not remaining:
                continue

            matched_li, confidence = self.match_carrier_to_usarm(carrier_desc, remaining)
            if matched_li and confidence >= 0.5:
                # Find the original index of the matched item
                matched_idx = None
                for ri, li in zip(remaining_indices, remaining):
                    if li is matched_li:
                        matched_idx = ri
                        break

                ext = round(matched_li["qty"] * matched_li["unit_price"], 2)
                ci_copy["usarm_desc"] = matched_li["description"]
                ci_copy["usarm_amount"] = ext
                ci_copy["matched_by"] = "fuzzy"
                ci_copy["supplement_argument"] = matched_li.get("supplement_argument", "")
                if matched_idx is not None:
                    used_indices.add(matched_idx)

        # ── Generate variance notes ──
        for ci_copy in result:
            carrier_amt = ci_copy.get("carrier_amount", 0) or 0
            usarm_amt = ci_copy.get("usarm_amount", 0) or 0
            supp_arg = ci_copy.get("supplement_argument", "")

            if usarm_amt and carrier_amt:
                diff = usarm_amt - carrier_amt
                if abs(diff) < 0.50:
                    ci_copy["note"] = "Amounts match"
                elif diff > 0:
                    ci_copy["note"] = f"Underpaid ${diff:,.2f}"
                    if supp_arg:
                        ci_copy["note"] += f". {supp_arg}"
                else:
                    ci_copy["note"] = f"Overpaid ${abs(diff):,.2f}"
            elif not ci_copy.get("usarm_desc"):
                ci_copy["note"] = "No matching USARM line item"

        # ── Append unmatched USARM items as "NOT INCLUDED" ──
        for idx, li in enumerate(usarm_line_items):
            if idx in used_indices:
                continue
            ext = round(li["qty"] * li["unit_price"], 2)
            if ext < 10:
                continue  # Skip trivial items
            supp_arg = li.get("supplement_argument", "")
            irc_code = li.get("irc_code", "")
            note = "NOT INCLUDED in carrier scope"
            if irc_code:
                note += f" — required per IRC {irc_code}"
            if supp_arg:
                note += f". {supp_arg}"

            result.append({
                "item": li["description"],
                "carrier_desc": "NOT INCLUDED",
                "carrier_amount": 0,
                "usarm_desc": li["description"],
                "usarm_amount": ext,
                "matched_by": "missing",
                "supplement_argument": supp_arg,
                "note": note,
            })

        return result

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

"""
PDF Parsers — Extract structured data from three PDF types.

Each parser converts messy PDF text into clean dicts/lists that the
comparison engine can work with. The key insight: each PDF type has a
completely different layout, so each needs its own regex-based parser.

Design Decision: We use PyMuPDF (fitz) for text extraction because it
preserves spatial layout better than pdfplumber for Xactimate PDFs.
Falls back to pdfplumber if fitz unavailable.
"""

import re
import json
import os

# ─── Optional PDF libraries ───
try:
    import fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False


# ======================================================================
# EAGLEVIEW PARSER
# ======================================================================

class EagleViewParser:
    """
    Extract certified measurements from EagleView Premium Roof & Walls Report.

    EagleView PDFs have a consistent structure:
      - Page 1-2: Summary with roof area, pitch, lengths
      - Page 3-4: Roof diagram with facet details
      - Later pages: Wall area diagrams per elevation

    The key measurements we need:
      - Total roof area (SF) and squares (SQ)
      - Predominant pitch
      - Ridge/hip, valley, rake, eave lengths (LF)
      - Flashing and step flashing lengths
      - Stories
      - Wall areas by elevation (siding SF, masonry SF)
    """

    # Regex patterns for EagleView measurement extraction
    PATTERNS = {
        "total_area_sf": re.compile(r"Total\s+(?:Roof\s+)?Area[:\s]*([0-9,]+)\s*(?:sq\s*ft|SF)", re.I),
        "total_squares": re.compile(r"Total\s+Squares[:\s]*([0-9.]+)", re.I),
        "predominant_pitch": re.compile(r"Predominant\s+Pitch[:\s]*(\d+)\s*/\s*12", re.I),
        "roof_facets": re.compile(r"Total\s+(?:Roof\s+)?Facets[:\s]*(\d+)", re.I),
        "ridges_hips": re.compile(r"Ridges?\s*/?\s*Hips?[:\s]*(\d+)\s*ft", re.I),
        "ridges": re.compile(r"(?:Total\s+)?Ridges?[:\s]*(\d+)\s*ft", re.I),
        "hips": re.compile(r"(?:Total\s+)?Hips?[:\s]*(\d+)\s*ft", re.I),
        "valleys": re.compile(r"(?:Total\s+)?Valleys?[:\s]*(\d+)\s*ft", re.I),
        "rakes": re.compile(r"(?:Total\s+)?Rakes?[:\s]*(\d+)\s*ft", re.I),
        "eaves": re.compile(r"(?:Total\s+)?Eaves?[:\s]*(\d+)\s*ft", re.I),
        "flashing": re.compile(r"(?:Total\s+)?Flashing[:\s]*(\d+)\s*ft", re.I),
        "step_flashing": re.compile(r"Step\s+Flashing[:\s]*(\d+)\s*ft", re.I),
        "stories": re.compile(r"Stor(?:ies|y)[:\s]*([\d>]+)", re.I),
        "perimeter": re.compile(r"(?:Total\s+)?Perimeter[:\s]*(\d+)\s*ft", re.I),
        "total_siding_sf": re.compile(r"Total\s+Siding\s+Area[:\s]*([0-9,.]+)\s*(?:sq\s*ft|SF)", re.I),
        "total_masonry_sf": re.compile(r"Total\s+Masonry\s+Area[:\s]*([0-9,.]+)\s*(?:sq\s*ft|SF)", re.I),
        "total_wall_sf": re.compile(r"Total\s+Wall\s+Area[:\s]*([0-9,.]+)\s*(?:sq\s*ft|SF)", re.I),
    }

    # Wall elevation extraction
    ELEVATION_RE = re.compile(
        r"(North|South|East|West)\s+(?:Elevation)?\s*(?:Total)?\s*"
        r"Siding[:\s]*([0-9,.]+)\s*(?:SF)?\s*"
        r"Masonry[:\s]*([0-9,.]+)",
        re.I | re.DOTALL
    )

    def parse(self, pdf_path):
        """Parse EagleView PDF into structured measurements dict.

        Returns:
            dict with keys: total_area_sf, total_squares, pitch, ridges_hips_lf,
                  valleys_lf, rakes_lf, eaves_lf, flashing_lf, step_flashing_lf,
                  stories, facets, perimeter_lf, siding_sf, masonry_sf,
                  wall_elevations (list), raw_text (for debugging)
        """
        text = self._extract_text(pdf_path)

        measurements = {
            "source": "eagleview",
            "pdf_path": pdf_path,
            "raw_text_length": len(text),
        }

        # Extract each measurement using regex patterns
        for key, pattern in self.PATTERNS.items():
            match = pattern.search(text)
            if match:
                val = match.group(1).replace(",", "")
                # Handle ">1" for stories
                if ">" in val:
                    measurements[key] = float(val.replace(">", "")) + 0.5
                else:
                    try:
                        measurements[key] = float(val)
                    except ValueError:
                        measurements[key] = val

        # Normalize into standard field names the engine expects
        result = self._normalize(measurements)
        result["_raw"] = measurements
        return result

    def _normalize(self, raw):
        """Convert raw extracted values to engine-standard field names."""
        m = {}
        m["source"] = "eagleview"
        m["total_area_sf"] = raw.get("total_area_sf", 0)
        m["total_squares"] = raw.get("total_squares", m["total_area_sf"] / 100 if m["total_area_sf"] else 0)

        # Pitch — EagleView gives X/12, we store just X
        m["pitch"] = int(raw.get("predominant_pitch", 0))

        # Ridge/hip — sometimes combined, sometimes separate
        if "ridges_hips" in raw:
            m["ridge_hip_lf"] = raw["ridges_hips"]
        else:
            m["ridge_hip_lf"] = raw.get("ridges", 0) + raw.get("hips", 0)

        m["ridge_lf"] = raw.get("ridges", m["ridge_hip_lf"])
        m["valley_lf"] = raw.get("valleys", 0)
        m["rake_lf"] = raw.get("rakes", 0)
        m["eave_lf"] = raw.get("eaves", 0)
        m["flashing_lf"] = raw.get("flashing", 0)
        m["step_flashing_lf"] = raw.get("step_flashing", 0)
        m["facets"] = int(raw.get("roof_facets", 0))
        m["perimeter_lf"] = raw.get("perimeter", 0)

        # Stories
        stories_raw = raw.get("stories", 1)
        if isinstance(stories_raw, str) and ">" in stories_raw:
            m["stories"] = 2  # >1 means 2+
        else:
            m["stories"] = int(float(stories_raw)) if stories_raw else 1
        if m.get("stories", 0) == 0:
            m["stories"] = 2 if raw.get("stories", 0) > 1 else 1

        # Siding / walls
        m["total_siding_sf"] = raw.get("total_siding_sf", 0)
        m["total_masonry_sf"] = raw.get("total_masonry_sf", 0)
        m["total_wall_sf"] = raw.get("total_wall_sf", 0)

        # Compute derived measurements used by XactRegistry.build_line_items()
        m["remove_sq"] = m["total_squares"]
        # Install SQ = remove SQ × waste factor (pitch-dependent)
        waste = self._waste_factor(m["pitch"])
        m["install_sq"] = round(m["remove_sq"] * waste, 2)
        m["step_lf"] = m["step_flashing_lf"]
        m["penetrations"] = 0  # Must be set from photos/inspection
        m["chimneys"] = 0      # Must be set from photos/inspection

        # I&W calculation: (eave_lf × 6ft) + (valley_lf × 3ft × 2 sides)
        # For code compliance: 2 courses up from eaves (each ~3ft wide)
        m["ice_water_sf"] = round((m["eave_lf"] * 6) + (m["valley_lf"] * 3 * 2), 0)

        # Starter/drip edge: eaves + rakes
        m["starter_lf"] = m["eave_lf"] + m["rake_lf"]
        m["drip_edge_lf"] = round(m["starter_lf"] * 1.05, 0)  # 5% waste

        # Gutter estimate: eave_lf × 1.6 (includes downspouts)
        m["gutter_lf"] = round(m["eave_lf"] * 1.6, 0)

        return m

    def _waste_factor(self, pitch):
        """Pitch-based waste factor per Xactimate conventions."""
        # Xactimate auto-calculates waste based on complexity
        # Standard: 10% for simple, 15% for cut-up, + pitch adjustment
        if pitch <= 4:
            return 1.10
        elif pitch <= 7:
            return 1.12
        elif pitch <= 9:
            return 1.13
        elif pitch <= 12:
            return 1.15
        else:
            return 1.18

    def _extract_text(self, pdf_path):
        """Extract text from PDF using best available library."""
        if HAS_FITZ:
            doc = fitz.open(pdf_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
            return "\n".join(text_parts)
        elif HAS_PDFPLUMBER:
            with pdfplumber.open(pdf_path) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        else:
            raise ImportError(
                "No PDF library available. Install PyMuPDF: pip install pymupdf --break-system-packages"
            )


# ======================================================================
# CARRIER SCOPE PARSER (Xactimate format)
# ======================================================================

class CarrierScopeParser:
    """
    Parse carrier insurance scope PDFs (Xactimate format).

    Carrier scopes have this structure:
      - Header: Carrier name, estimate name, source
      - Area sections (Roof1, Ext_Surfaces, Interior, etc.)
      - Within each area: line items with QUANTITY, UNIT, TAX, RCV, AGE/LIFE, etc.
      - Footer: Totals, tax recap, loss summary

    Key challenge: Line items span multiple lines, with descriptions on one
    line and quantities/prices on the next. Notes appear below some items.

    Design Decision: We parse line-by-line looking for the quantity pattern
    (number + unit), then associate it with the preceding description line.
    """

    # Matches a line item quantity row:
    # "11.87 SQ    74.75    0.00    887.28    15/30 yrs    Avg.    NA    (0.00)    887.28"
    QTY_LINE_RE = re.compile(
        r"^\s*"
        r"([0-9,.]+)\s+"          # quantity
        r"(SQ|SF|LF|EA|HR|MO)\s+" # unit
        r"([0-9,.]+)\s+"          # unit_price
        r"([0-9,.]+)\s+"          # tax
        r"([0-9,.]+)\s+"          # RCV
        r"(\d+/[\d]+\s*(?:yrs?)?|0/NA|15/NA)\s+"  # age/life
        r"(Avg\.|Good|Poor|Fair)\s*"  # condition
        r"(NA|\d+%?)\s*"           # dep %
        r"\(([0-9,.]+)\)\s*"       # depreciation amount
        r"([0-9,.]+)",             # ACV
        re.IGNORECASE
    )

    # Simpler quantity line (some carriers use fewer columns)
    QTY_SIMPLE_RE = re.compile(
        r"^\s*"
        r"([0-9,.]+)\s+"          # quantity
        r"(SQ|SF|LF|EA|HR|MO)\s+" # unit
        r"([0-9,.]+)\s+"          # unit_price
        r"([0-9,.]+)\s+"          # tax
        r"([0-9,.]+)",            # RCV
        re.IGNORECASE
    )

    # Section headers
    SECTION_RE = re.compile(
        r"^(ROOF\s*COVERING|ACCESSORIES|MISCELLANEOUS|FRONT\s+ELEVATION|"
        r"BACK\s+ELEVATION|LEFT\s+ELEVATION|RIGHT\s+ELEVATION|"
        r"REAR\s+ELEVATION|INTERIOR|DEBRIS|GENERAL)\s*:?\s*$",
        re.IGNORECASE
    )

    # Area headers: "Roof1", "Ext_Surfaces", "Interior", "Garage"
    AREA_RE = re.compile(
        r"^(Roof\d+|Ext_Surfaces|Interior|Garage|Porch|Shed|Dwelling)",
        re.IGNORECASE
    )

    # Line item number + description: "22. Tear off, haul and dispose..."
    ITEM_DESC_RE = re.compile(
        r"^\s*(\d+)\.\s+(.+?)$"
    )

    # Totals line
    TOTALS_RE = re.compile(
        r"^Totals?:\s*(Roof\d+|Ext_Surfaces|Exterior|Interior|Line Item)",
        re.IGNORECASE
    )

    # Loss summary
    LOSS_RCV_RE = re.compile(r"Replacement\s+Cost.*?[\$]?([0-9,]+\.\d{2})", re.I)
    LOSS_DEP_RE = re.compile(r"(?:Less\s+)?Depreciation.*?[\$]?\(?([0-9,]+\.\d{2})\)?", re.I)
    LOSS_DED_RE = re.compile(r"(?:Less\s+)?Deductible.*?[\$]?\(?([0-9,]+\.\d{2})\)?", re.I)
    LOSS_NET_RE = re.compile(r"Net\s+Claim.*?[\$]?([0-9,]+\.\d{2})", re.I)

    def parse(self, pdf_path):
        """Parse carrier scope PDF into structured data.

        Returns:
            dict with keys:
                carrier_name, adjuster, date, price_list,
                areas: [{name, sections: [{name, line_items: [...]}]}],
                line_items: [flat list of all items],
                totals: {rcv, depreciation, deductible, acv, net_claim},
                measurements: {surface_area, perimeter, ridge, etc.}
        """
        text = self._extract_text(pdf_path)
        lines = text.split("\n")

        result = {
            "source": "carrier_scope",
            "pdf_path": pdf_path,
            "carrier_name": self._detect_carrier(text),
            "line_items": [],
            "areas": [],
            "totals": {},
            "measurements": {},
        }

        current_area = "Unknown"
        current_section = "General"
        pending_desc = None
        pending_item_num = None

        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue

            # Check for area header
            area_match = self.AREA_RE.match(line)
            if area_match:
                current_area = area_match.group(1)
                continue

            # Check for section header
            section_match = self.SECTION_RE.match(line)
            if section_match:
                current_section = section_match.group(1)
                continue

            # Check for totals (skip)
            if self.TOTALS_RE.match(line):
                continue

            # Check for item description
            desc_match = self.ITEM_DESC_RE.match(line)
            if desc_match:
                pending_item_num = int(desc_match.group(1))
                pending_desc = desc_match.group(2).strip()
                continue

            # Check for quantity line (full format)
            qty_match = self.QTY_LINE_RE.match(line)
            if not qty_match:
                qty_match = self.QTY_SIMPLE_RE.match(line)

            if qty_match and pending_desc:
                qty = float(qty_match.group(1).replace(",", ""))
                unit = qty_match.group(2).upper()
                unit_price = float(qty_match.group(3).replace(",", ""))
                tax = float(qty_match.group(4).replace(",", ""))
                rcv = float(qty_match.group(5).replace(",", ""))

                # Extended fields (if full format)
                dep_pct = None
                dep_amt = 0
                acv = rcv  # default
                if len(qty_match.groups()) >= 10:
                    dep_str = qty_match.group(8)
                    if dep_str and dep_str != "NA":
                        dep_pct = float(dep_str.replace("%", ""))
                    dep_amt = float(qty_match.group(9).replace(",", ""))
                    acv = float(qty_match.group(10).replace(",", ""))

                item = {
                    "item_num": pending_item_num,
                    "description": pending_desc,
                    "carrier_desc": pending_desc,  # For XactRegistry matching
                    "qty": qty,
                    "unit": unit,
                    "unit_price": unit_price,
                    "tax": tax,
                    "rcv": rcv,
                    "dep_pct": dep_pct,
                    "dep_amt": dep_amt,
                    "acv": acv,
                    "area": current_area,
                    "section": current_section,
                    "extension": round(qty * unit_price, 2),
                }

                result["line_items"].append(item)
                pending_desc = None
                pending_item_num = None
                continue

            # If we have a pending description and this line looks like a
            # continuation (no number prefix, not a section header), append it
            if pending_desc and not self.SECTION_RE.match(line) and not self.AREA_RE.match(line):
                # Could be a note line — check if next line is quantity
                # For now, keep the description as-is
                pass

        # Extract measurement info from text
        result["measurements"] = self._extract_measurements(text)

        # Extract financial summary
        result["totals"] = self._extract_totals(text)

        return result

    def _detect_carrier(self, text):
        """Detect carrier name from PDF text."""
        carriers = {
            "TRAVELERS": "Travelers",
            "TRAVCO": "Travco Insurance Company",
            "STATE FARM": "State Farm",
            "ALLSTATE": "Allstate",
            "LIBERTY MUTUAL": "Liberty Mutual",
            "USAA": "USAA",
            "NATIONWIDE": "Nationwide",
            "ERIE": "Erie Insurance",
            "PROGRESSIVE": "Progressive",
            "FARMERS": "Farmers Insurance",
            "AMERICAN FAMILY": "American Family",
            "HARTFORD": "The Hartford",
        }
        text_upper = text.upper()
        for key, name in carriers.items():
            if key in text_upper:
                return name
        return "Unknown Carrier"

    def _extract_measurements(self, text):
        """Extract measurement data from carrier scope header."""
        meas = {}
        patterns = {
            "surface_area": re.compile(r"([0-9,.]+)\s+Surface\s+Area", re.I),
            "total_perimeter": re.compile(r"([0-9,.]+)\s+Total\s+Perimeter", re.I),
            "total_ridge": re.compile(r"([0-9,.]+)\s+Total\s+Ridge", re.I),
            "total_hip": re.compile(r"([0-9,.]+)\s+Total\s+Hip", re.I),
            "num_squares": re.compile(r"([0-9,.]+)\s+Number\s+of\s+Squares", re.I),
            "ext_wall_area": re.compile(r"([0-9,.]+)\s+Exterior\s+Wall\s+Area", re.I),
            "sf_walls": re.compile(r"([0-9,.]+)\s+SF\s+Walls(?:\s|$)", re.I),
        }
        for key, pattern in patterns.items():
            match = pattern.search(text)
            if match:
                meas[key] = float(match.group(1).replace(",", ""))
        return meas

    def _extract_totals(self, text):
        """Extract financial totals from loss summary."""
        totals = {}
        for key, pattern in [
            ("rcv", self.LOSS_RCV_RE),
            ("depreciation", self.LOSS_DEP_RE),
            ("deductible", self.LOSS_DED_RE),
            ("net_claim", self.LOSS_NET_RE),
        ]:
            match = pattern.search(text)
            if match:
                totals[key] = float(match.group(1).replace(",", ""))
        return totals

    def _extract_text(self, pdf_path):
        """Extract text preserving layout."""
        if HAS_FITZ:
            doc = fitz.open(pdf_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text("text"))
            doc.close()
            return "\n".join(text_parts)
        elif HAS_PDFPLUMBER:
            with pdfplumber.open(pdf_path) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        else:
            raise ImportError("No PDF library. Install: pip install pymupdf --break-system-packages")


# ======================================================================
# USARM ESTIMATE PARSER
# ======================================================================

class USARMEstimateParser:
    """
    Parse USARM Xactimate estimate PDFs.

    USARM estimates follow our standard format generated by usarm_pdf_generator.py.
    They can also be manually-created Xactimate exports.

    The format is similar to carrier scopes but we know our own structure,
    so parsing is more targeted.
    """

    # Line item pattern from USARM estimates
    # "Remove Laminated comp. shingle roofing    13.38 SQ    $75.07    $1,004.44"
    USARM_LINE_RE = re.compile(
        r"^(.+?)\s+"
        r"([0-9,.]+)\s+"
        r"(SQ|SF|LF|EA|HR|MO)\s+"
        r"\$?([0-9,.]+)\s+"
        r"\$?([0-9,.]+)",
        re.IGNORECASE
    )

    # Category header
    CATEGORY_RE = re.compile(
        r"^(ROOFING|SIDING|GUTTERS|DEBRIS|INTERIOR|ACCESSORIES|MISCELLANEOUS)\s*$",
        re.IGNORECASE
    )

    def parse(self, pdf_path):
        """Parse USARM estimate PDF into structured line items.

        Returns:
            dict with keys: line_items, totals, categories
        """
        text = self._extract_text(pdf_path)
        lines = text.split("\n")

        result = {
            "source": "usarm_estimate",
            "pdf_path": pdf_path,
            "line_items": [],
            "totals": {},
            "categories": [],
        }

        current_category = "GENERAL"

        for line in lines:
            line = line.strip()
            if not line:
                continue

            cat_match = self.CATEGORY_RE.match(line)
            if cat_match:
                current_category = cat_match.group(1).upper()
                result["categories"].append(current_category)
                continue

            item_match = self.USARM_LINE_RE.match(line)
            if item_match:
                desc = item_match.group(1).strip()
                qty = float(item_match.group(2).replace(",", ""))
                unit = item_match.group(3).upper()
                unit_price = float(item_match.group(4).replace(",", ""))
                extension = float(item_match.group(5).replace(",", ""))

                result["line_items"].append({
                    "description": desc,
                    "qty": qty,
                    "unit": unit,
                    "unit_price": unit_price,
                    "extension": extension,
                    "category": current_category,
                })

        # Extract totals
        total_re = re.compile(r"(?:Line\s+Item\s+Total|TOTAL\s+RCV|RCV)[:\s]*\$?([0-9,]+\.\d{2})", re.I)
        tax_re = re.compile(r"Tax[:\s]*\$?([0-9,]+\.\d{2})", re.I)
        for pattern, key in [(total_re, "line_item_total"), (tax_re, "tax")]:
            match = pattern.search(text)
            if match:
                result["totals"][key] = float(match.group(1).replace(",", ""))

        return result

    def parse_from_config(self, config_path):
        """Parse USARM line items directly from claim_config.json.

        This is the PREFERRED method — no PDF parsing needed, exact data.
        """
        with open(config_path) as f:
            config = json.load(f)

        items = config.get("line_items", [])
        return {
            "source": "usarm_config",
            "config_path": config_path,
            "line_items": items,
            "totals": config.get("financials", {}),
            "categories": list(set(li.get("category", "") for li in items)),
        }

    def _extract_text(self, pdf_path):
        if HAS_FITZ:
            doc = fitz.open(pdf_path)
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text("text"))
            doc.close()
            return "\n".join(text_parts)
        elif HAS_PDFPLUMBER:
            with pdfplumber.open(pdf_path) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        else:
            raise ImportError("No PDF library. Install: pip install pymupdf --break-system-packages")

"""
Building Code Compliance Report — Document #6 in the USARM appeal package.

Generates a PDF with:
1. Cover page with jurisdiction + manufacturer logos
2. Annotated 3D house rendering with code callouts
3. Code detail cards with manufacturer installation diagrams
4. Summary table of all applicable codes
"""

import os
import html as _html
from compliance_svg import generate_house_svg, collect_annotations_from_config, CODE_TO_ZONE


def _h(text) -> str:
    """Escape text for safe HTML embedding."""
    return _html.escape(str(text) if text is not None else "")

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
"""


def _get_jurisdiction(state: str) -> dict:
    """Get jurisdiction info for a state."""
    state = state.upper()
    if state == "NY":
        return {"code": "RCNYS", "name": "Residential Code of New York State (2020)", "abbrev": "RCNYS"}
    elif state == "NJ":
        return {"code": "NJ UCC / IRC", "name": "NJ Uniform Construction Code (IRC 2018)", "abbrev": "NJ UCC"}
    elif state == "PA":
        return {"code": "PA UCC / IRC", "name": "PA Uniform Construction Code (IRC 2018)", "abbrev": "PA UCC"}
    elif state == "CT":
        return {"code": "CT SBC / IRC", "name": "CT State Building Code (IRC 2018)", "abbrev": "CT SBC"}
    else:
        return {"code": "IRC", "name": "International Residential Code (2018)", "abbrev": "IRC"}


def _build_cover_page(config: dict, jurisdiction: dict, annotation_count: int) -> str:
    """Build the cover page HTML."""
    prop = config.get("property", {})
    address = _h(f"{prop.get('address', '')}, {prop.get('city', '')}, {prop.get('state', '')} {prop.get('zip', '')}")
    claim_number = _h(config.get("carrier", {}).get("claim_number", ""))
    company = config.get("company", {})
    company_name = _h(company.get("name", "USA ROOF MASTERS"))
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


def _build_summary_table(annotations: list[dict], config: dict) -> str:
    """Build the summary table of all applicable codes."""
    jurisdiction = _get_jurisdiction(config.get("property", {}).get("state", "NY"))
    carrier_items = set()
    for li in config.get("line_items", []):
        carrier_match = li.get("carrier_match", "")
        if carrier_match and carrier_match != "NOT INCLUDED":
            desc = li.get("description", "").lower()
            carrier_items.add(desc[:30])

    rows = []
    for ann in annotations:
        cc = ann.get("full_citation", {})
        mfr_specs = cc.get("manufacturer_specs", [])
        mfr_names = ", ".join(s.get("manufacturer", "") for s in mfr_specs[:2]) if mfr_specs else "—"
        has_void = any(s.get("warranty_void") for s in mfr_specs)

        # Determine if carrier included this item
        zone = ann.get("zone", "")
        status_class = "status-included"
        status_text = "Included"
        # Simple heuristic: if the code is marked as missing in scope comparison
        if ann.get("is_critical"):
            status_class = "status-missing"
            status_text = "VERIFY"

        rows.append(f'''
        <tr>
            <td><b>{ann.get("code_tag", "")}</b></td>
            <td>{ann.get("title", "")}</td>
            <td>{ann.get("measurement", "")}</td>
            <td>{mfr_names}</td>
            <td>{"WARRANTY VOID" if has_void else "—"}</td>
        </tr>''')

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
            </tr>
        </thead>
        <tbody>
            {"".join(rows)}
        </tbody>
    </table>
    <div class="footer">
        Jurisdiction: {jurisdiction["name"]} | Report generated by {config.get("company", {}).get("name", "USA ROOF MASTERS")}
    </div>
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
</body>
</html>'''

    # 5. Write to output directory
    output_dir = config.get("_paths", {}).get("output", "/tmp")
    output_path = os.path.join(output_dir, "06_CODE_COMPLIANCE_REPORT.html")
    with open(output_path, "w") as f:
        f.write(html)

    print(f"[COMPLIANCE] Report generated: {len(annotations)} codes, "
          f"jurisdiction={jurisdiction['abbrev']}, path={output_path}")
    return output_path


def has_measurements(config: dict) -> bool:
    """Check if the config has enough measurement data for the compliance report."""
    m = config.get("measurements", {})
    eave = m.get("eave", 0) or 0
    rake = m.get("rake", 0) or 0
    area = m.get("total_area", 0) or m.get("area_sq", 0) or 0
    return eave > 0 or rake > 0 or area > 0

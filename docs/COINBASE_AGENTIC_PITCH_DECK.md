# DumbRoof × Agentic.market — Launch Partner Deck

**Audience:** Brian Armstrong, Nick Prince, Coinbase BD/Ventures
**Purpose:** Position DumbRoof as the agent-native vertical-SaaS launch partner for Agentic.market
**Length:** 12 slides
**Format target:** Render to 16:9 PDF via Canva or Vercel Satori on execution

---

## Slide 1 — Cover

**Visual:** DumbRoof neon logo on dark background, large.
**Subtitle:** *The agent-native vertical for Agentic.market*
**Footer:** Tom Kovack Jr · Founder & CEO · April 2026

**Speaker note:** Open with the line: "We are not pitching you on building this. It is built. We are pitching you on launching it together."

---

## Slide 2 — The 72-Hour Headless Thesis

**Visual:** Three side-by-side tweet cards.

> **Marc Benioff** (April 20, 2026) — *"Welcome Salesforce Headless 360: No Browser Required! Our API is the UI."*

> **Greg Isenberg** (April 22, 2026) — *"There's $1T up for grabs for agent-first startups… SaaS becomes the dumb backend. The startup IS the agent."*

> **Brian Armstrong** (April 20, 2026) — *"For the agentic economy to overtake the human economy, agents need a way to discover services."*

**Headline below the three:** *Three signals. Same week. Same shift.*

**Speaker note:** All three voices. Same conclusion. The browser is no longer the UI; the agent is. We've been operating that way for 18 months.

---

## Slide 3 — The Vertical: Roofing Insurance Supplements

**Visual:** US map of hail/wind storm tracks 2025–2026, overlaid with $ figures.

- **$50B** — annual U.S. residential roofing services market
- **$5B+** — annual underpaid insurance claims (NAIC + industry estimates)
- **117,000+** — licensed U.S. roofing contractors
- **~80%** — claims that are underpaid on first scope
- **0** — agent-native solutions in production today (until DumbRoof)

**Speaker note:** This is a hidden TAM. Carriers underpay; contractors don't have time or expertise to fight back. The current "solution" is a $400/hour public adjuster taking 20% of recovery. We charge 1% of that and outperform.

---

## Slide 4 — What We Built: Richard

**Visual:** Architecture diagram. Box labeled "Richard (Claude Opus 4.7)" in the center, with 35 tool icons radiating outward (email, photos, Xactimate, NOAA, Supabase, Stripe, AccuLynx, CompanyCam, etc.).

**Stats bar across top:**
- **35** registered tools
- **MCP-native** (Model Context Protocol from day one)
- **51-table** Supabase data warehouse
- **123,942** rows of training data
- **117** claims processed live
- **$6.9M** RCV through the platform

**Speaker note:** Richard is not a chatbot bolted onto a SaaS. Richard is the SaaS. Email comes in → Richard reads it. PDF arrives → Richard extracts it. User asks question → Richard answers via tool calls. The chat panel is just one of many surfaces.

---

## Slide 5 — Agent-Native by Construction (Not Retrofit)

**Visual:** Side-by-side comparison.

| | Traditional roofing SaaS | DumbRoof |
|---|---|---|
| Primary surface | Web dashboard | Agent (chat / email / API) |
| Per-feature build | Hand-coded UI per workflow | Agent picks the right tool |
| New integrations | Months of dev work | One MCP wrapper |
| State across sessions | Session-scoped | Persistent agent memory + claim_events log |
| User onboarding | Multi-step wizard | "Connect your Gmail" → agent does the rest |
| Cost to scale | Linear in headcount | Linear in API calls |

**Speaker note:** Greg Isenberg said the winners will be ex-operators who built agent-first vertical software. We're it. We were building it before he tweeted the thesis.

---

## Slide 6 — x402 Fit: Public Richard API

**Visual:** Sequence diagram.
1. Caller agent → POST /v1/agent/process-claim
2. Server → 402 Payment Required (x402 challenge)
3. Caller signs USDC payment via Coinbase agentic-wallet-skill
4. Caller retries with X-Payment header
5. Server → 202 Accepted with job_id
6. Caller polls → 200 with 5-PDF claim package

**Pricing table:**

| Endpoint | Price | Use case |
|---|---|---|
| `process-claim` | $50.00 | Full claim package |
| `draft-supplement` | $5.00 | Supplement letter only |
| `annotate-photo` | $0.50 | Single photo damage tag |
| `pricing` / `job-poll` | Free | Discovery + status |

**Speaker note:** This is the cleanest possible x402 case study. High-value transaction, replay-protected, auto-refund on failure, on-chain verifiable.

---

## Slide 7 — Traction

**Visual:** Big numbers, dark dashboard styling.

- **117** claims processed end-to-end
- **12** wins (claims with carrier-acknowledged increases)
- **$2.0M+** supplements awarded to date
- **$6.9M** USARM RCV in pipeline
- **$0.41 – $1.15** cost per claim (depends on photo count)
- **48 hours** average turnaround per claim
- **305** Apollo enrichment credits used (lead-gen layer)

**Footer note:** *Real claims, real payouts, real contractors. Not a prototype.*

**Speaker note:** Every number on this slide is auditable in the Supabase warehouse. This is not vaporware.

---

## Slide 8 — IP & Moat

**Visual:** Patent figure (figure 1 from USPTO provisional, the system architecture diagram).

- **USPTO provisional** filed 2026-02-26 — 66 claims, 18 figures
- **Non-provisional due** 2027-02-26 (10-month window remaining)
- **Trademark:** dumbroof.ai (filed/pending) + 3 more in process
- **Entity:** Dumb Roof Technologies LLC, Wyoming (formed 2026-03-12, EIN 41-4822546)
- **Operator moat:** Tom owns USARM (21-year operating roofer) — every Xactimate code, every carrier denial pattern, every adjuster behavior burned into product DNA

**Speaker note:** Three layers of moat: legal (patent), data (51-table warehouse), and operational (founder is the customer).

---

## Slide 9 — The Ask

**Visual:** Three boxes with checkmarks.

✅ **Featured launch listing** on Agentic.market homepage
✅ **Joint case study + blog post** — "How DumbRoof and Coinbase built the first paying agent vertical"
✅ **Tweet from Brian on launch day** — co-announcement with `@dumbroofai`

**Bonus ask (parallel track):** Intro to **Coinbase Ventures** for a $5M seed round conversation.

**Speaker note:** We're not asking for capital from Agentic.market. We're asking for the launch slot. Capital conversation is separate.

---

## Slide 10 — What We Offer

**Visual:** Four boxes.

📊 **Real-world case study** — first paying agent-to-agent commerce in production
🎙️ **Podcast appearance** — Tom on Greg Isenberg's Startup Ideas Pod (already targeted) + any Coinbase show
🤝 **90-day commitment** — onboard N caller-agents (target: 50 contractor-CRM agents using Richard via x402)
🔓 **First-look data access** — joint research on agentic commerce patterns from our 51-table warehouse

---

## Slide 11 — Team

**Visual:** Three headshots side by side.

- **Tom Kovack Jr.** — Founder & CEO. 21 years operating USA Roof Masters. Built Richard solo.
- **Marcus Valeriano** — COO candidate. McKinsey + Johns Hopkins. Operator background.
- **Jared Ferreira** — CTO candidate. Meta engineer. Distributed-systems background.

**Footer:** *Advisory board, additional hires, and Coinbase Ventures relationship to be confirmed post-Series-Seed.*

---

## Slide 12 — Close

**Visual:** Same neon logo, large.

> *"We are the agent-native vertical you said you were looking for.*
> *Let's launch together."*

**Footer:** Tom Kovack Jr · TKovack@dumbroof.ai · 267-679-1504

---

## Production Notes

- **Render target:** 16:9, 1920×1080 PDF
- **Tooling options:**
  1. **Canva MCP** — fastest, brand-consistent, easy to revise
  2. **Vercel Satori** — programmatic PDF from Markdown via existing satori dep
  3. **Reveal.js** + headless Chrome — if interactive web version needed for live presentation
- **Brand assets:** `dumbroof-web/marketing/brand/dumbroof_neon_logo.png`, `icon-400.png`, `13_dumbroof_free.png`
- **Color palette:** Black background (#000), neon indigo (#6366F1), neon cyan (#22D3EE), white text
- **Font:** Geist (Vercel) or system-default sans
- **Charts:** Use real Supabase data — pull live from `claims`, `claim_outcomes`, `claim_brain_audit`
- **Accessibility:** All slides have speaker-note text for non-visual presentation

## Render command (when authorized)

```bash
# Option A: Canva MCP
mcp__claude_ai_Canva__generate-design-structured \
  --template "presentation_16_9" \
  --content @COINBASE_AGENTIC_PITCH_DECK.md \
  --brand_kit "dumbroof_neon"

# Option B: Vercel Satori (if Canva not preferred)
cd dumbroof-web && pnpm tsx scripts/render-pitch-deck.ts \
  --input docs/COINBASE_AGENTIC_PITCH_DECK.md \
  --output docs/COINBASE_AGENTIC_PITCH_DECK.pdf
```

---

*Authorize Tom-side before any rendering or send-out. Deck and email are coupled — do not send one without the other.*

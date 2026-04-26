---
marp: true
theme: uncover
class:
  - invert
paginate: true
size: 16:9
backgroundColor: "#0a0a14"
color: "#ffffff"
style: |
  section {
    font-family: -apple-system, "Geist", "Inter", system-ui, sans-serif;
    padding: 60px;
  }
  section.lead h1 {
    font-size: 84px;
    color: #6366F1;
    text-align: center;
    margin-bottom: 24px;
  }
  section.lead h2 {
    color: #22D3EE;
    text-align: center;
    font-weight: 400;
  }
  section h1 {
    color: #6366F1;
    font-size: 56px;
    margin-bottom: 24px;
  }
  section h2 {
    color: #22D3EE;
    font-size: 32px;
    margin-bottom: 16px;
  }
  section h3 {
    color: #A6F25A;
    font-size: 24px;
  }
  blockquote {
    border-left: 4px solid #6366F1;
    background: rgba(99,102,241,0.08);
    padding: 16px 24px;
    color: #ffffff;
    font-style: italic;
    border-radius: 4px;
  }
  table {
    font-size: 22px;
    border-collapse: collapse;
    margin: 0 auto;
  }
  table th {
    background: rgba(99,102,241,0.15);
    color: #22D3EE;
    padding: 8px 16px;
    border: 1px solid rgba(255,255,255,0.1);
  }
  table td {
    padding: 8px 16px;
    border: 1px solid rgba(255,255,255,0.08);
  }
  strong {
    color: #A6F25A;
  }
  code {
    background: rgba(255,255,255,0.08);
    color: #22D3EE;
    padding: 2px 6px;
    border-radius: 4px;
  }
  ul li {
    line-height: 1.6;
    font-size: 22px;
  }
  .stat {
    font-size: 96px;
    color: #A6F25A;
    font-weight: 800;
    text-align: center;
    line-height: 1.0;
  }
  .stat-label {
    font-size: 20px;
    color: #ffffff;
    text-align: center;
    opacity: 0.7;
    margin-top: 8px;
  }
  .footer-note {
    font-size: 16px;
    opacity: 0.5;
    text-align: center;
    margin-top: 48px;
  }
---

<!-- _class: lead -->

# DumbRoof

## The agent-native vertical for Agentic.market

<div class="footer-note">Tom Kovack Jr · Founder & CEO · April 2026</div>

---

# The 72-Hour Headless Thesis

> **Marc Benioff** (Apr 20) — *"Welcome Salesforce Headless 360: No Browser Required. Our API is the UI."*

> **Greg Isenberg** (Apr 22) — *"There's $1T up for grabs for agent-first startups… SaaS becomes the dumb backend. The startup IS the agent."*

> **Brian Armstrong** (Apr 20) — *"For the agentic economy to overtake the human economy, agents need a way to discover services."*

### Three signals. Same week. Same shift.

---

# The Vertical

## Roofing Insurance Supplements

| Metric | Value |
|---|---|
| U.S. residential roofing market | **$50B/yr** |
| Annual underpaid claims | **$5B+** |
| Licensed U.S. roofing contractors | **117,000+** |
| Claims underpaid on first scope | **~80%** |
| Agent-native solutions in production today | **0** (until DumbRoof) |

A hidden TAM most Silicon Valley investors haven't seen.

---

# What We Built: Richard

| | |
|---|---|
| Tools registered | **43** |
| Architecture | MCP-native from day one |
| Data warehouse | **51 tables · 123,942 rows** |
| Claims processed | **117** |
| RCV through platform | **$6.9M** |

Richard is not a chatbot bolted onto a SaaS.
Richard **is** the SaaS — chat, email, API, all routed to the same agent.

---

# Agent-Native (Not Retrofit)

|  | Traditional roofing SaaS | DumbRoof |
|---|---|---|
| Primary surface | Web dashboard | Agent (chat / email / API) |
| Per-feature build | Hand-coded UI | Agent picks the right tool |
| New integrations | Months of dev | One MCP wrapper |
| State across sessions | Session-scoped | Persistent agent memory |
| User onboarding | Multi-step wizard | "Connect your Gmail" → done |
| Cost to scale | Linear in headcount | Linear in API calls |

We were building this **before** the thesis tweets landed.

---

# x402 Fit: Public Richard API

```
caller → POST /v1/agent/process-claim
server → 402 Payment Required (x402 challenge)
caller → signs USDC payment via agentic-wallet-skill
caller → retries with X-Payment header
server → 202 Accepted with job_id
caller → polls → 200 with 5-PDF claim package
```

| Endpoint | Price |
|---|---|
| `process-claim` | **$50** |
| `draft-supplement` | **$5** |
| `annotate-photo` | **$0.50** |
| `pricing` / `job-poll` | Free |

Replay-protected, refund-on-failure, on-chain auditable.

---

# Traction

<div class="stat">117</div>
<div class="stat-label">claims processed end-to-end</div>

<div class="stat">$2.0M+</div>
<div class="stat-label">supplements awarded YTD</div>

<div class="stat">12</div>
<div class="stat-label">wins · 48-hour avg turnaround</div>

<div class="footer-note">Every number auditable in our Supabase warehouse.</div>

---

# IP & Moat

- **USPTO provisional** filed 2026-02-26 — 66 claims, 18 figures
- **Non-provisional due** 2027-02-26 (10-month window)
- **Trademark:** dumbroof.ai filed/pending
- **Entity:** Dumb Roof Technologies LLC (Wyoming, EIN 41-4822546)
- **Operator moat:** CEO is a 21-year operating roofer (USA Roof Masters)

Three layers: legal · data · operational.
The hardest one to copy is the operator one.

---

# The Ask

✅ **Featured launch listing** on Agentic.market
✅ **Joint case study + blog post** — "The first paying agent-vertical in production"
✅ **Tweet from Brian on launch day** — co-announce with @dumbroofai

**Bonus track:** intro to Coinbase Ventures for a $5M seed conversation.

---

# What We Offer

📊 **Real-world case study** — first paying agent-to-agent commerce in production

🎙️ **Podcast appearance** — Tom on Greg Isenberg's Startup Ideas Pod (already targeted) + any Coinbase show

🤝 **90-day commitment** — onboard 50 caller-agents (contractor-CRM agents using Richard via x402)

🔓 **First-look data access** — joint research from our 51-table warehouse on agentic commerce patterns

---

# Team

- **Tom Kovack Jr.** — Founder & CEO. 21 years operating USA Roof Masters. Built Richard solo.
- **Marcus Valeriano** — COO candidate. McKinsey + Johns Hopkins.
- **Jared Ferreira** — CTO candidate. Meta engineer. Distributed systems.

<div class="footer-note">Advisory board, additional hires, Coinbase Ventures relationship — to be confirmed post-Series-Seed.</div>

---

<!-- _class: lead -->

# Let's launch together.

## We are the agent-native vertical you said you were looking for.

<div class="footer-note">Tom Kovack Jr · TKovack@dumbroof.ai · 267-679-1504</div>

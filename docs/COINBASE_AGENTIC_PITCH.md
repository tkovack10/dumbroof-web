# Coinbase / Agentic.market — Launch Partner Pitch

**Status:** Draft for Tom's review
**Author:** Tom Kovack Jr (CEO, Dumb Roof Technologies LLC)
**Targets:** Brian Armstrong (CEO, Coinbase), Nick Prince / `nick.base.eth` (Agentic.market lead), Coinbase BD team
**Date:** 2026-04-26

---

## Cover Email (formal)

**To:** brian@coinbase.com (cc: nick@base.org, partnerships@coinbase.com)
**Subject:** Launch partner for Agentic.market — agent-native insurance vertical, ready today

---

Brian, Nick —

I caught your post on Agentic.market last weekend (and Brian's quote-tweet of Nick's launch). The thesis lines up exactly with what we've been building for the last 18 months at Dumb Roof Technologies.

**The short version:** DumbRoof is an agent-native vertical SaaS for U.S. roofing contractors. Our agent, Richard, ingests damage photos, EagleView measurements, and a carrier's claim scope, and outputs a complete insurance-supplement package — forensic causation report, Xactimate-style estimate, scope comparison, and ready-to-send carrier email. 35 tools, MCP-native, full audit trail, 117 claims processed, $6.9M in contractor RCV through the platform. USPTO provisional patent filed February 2026.

We are not retrofitting a SaaS for the agent era. We were *built* this way. The chat is one of many surfaces — the same agent answers email, processes uploads, and runs scheduled cadences. Greg Isenberg's "UX → AX" thesis is our day-one architecture, not a roadmap item.

**Why this is interesting for Agentic.market:**

1. **We are launch-ready.** Richard already has a tool-calling agent loop, an approval-gate model, and a full audit log. Wrapping the existing handlers in an x402-callable public endpoint is a 1–2 week sprint, not a roadmap.
2. **A vertical with hidden TAM.** Insurance-claim supplementing is a $5B+ U.S. market hidden inside the $50B roofing services industry. Every major roofer in the country is a potential consumer of agent-driven supplement automation.
3. **A use case other agents will actually want.** Property-management AIs, homeowner AIs, roofing CRM agents (AccuLynx, JobNimbus, ServiceTitan) — all of them produce or touch claim-relevant data. Richard is a natural sub-task call in any of those workflows.
4. **An operator-led story.** I personally own a roofing company (USA Roof Masters, Bensalem, PA — 21 years). I am exactly the "ex-operator who understands a vertical workflow cold" Greg called out in his tweet. The unfair advantage isn't the code — it's knowing every Xactimate code, every carrier denial pattern, and every adjuster shortcut by name.

**What I'd like to propose:**

- DumbRoof becomes a featured launch partner / case study for Agentic.market.
- We expose Richard publicly as `api.dumbroof.ai/v1/agent/*` with x402 micropayments ($50/claim, $5/supplement-letter, $0.50/photo-annotation).
- Co-marketing: a joint blog post, a podcast appearance with one of your team, a tweet from Brian on launch day.
- We commit to onboarding a stated number of paying caller-agents in the first 90 days.

**What we offer in return:**

- A real-world, revenue-generating case study showing Agentic.market delivering paid agentic commerce, not just a developer demo.
- A vertical with national distribution upside — every U.S. roofing contractor is a potential downstream caller via their existing CRM.
- First-look access to our 51-table claim data warehouse for joint research on agentic commerce patterns.

**The deck is attached** (`COINBASE_AGENTIC_PITCH_DECK.pdf`). The Richard public-API spec is at `https://api.dumbroof.ai/docs/spec`.

I'd love a 30-minute call this week. I have flexibility Tuesday afternoon through Friday morning Eastern Time.

— Tom

Tom Kovack Jr.
Founder & CEO, Dumb Roof Technologies LLC
267-679-1504 cell · TKovack@dumbroof.ai
USPTO #: <provisional filed 2026-02-26>
LinkedIn: linkedin.com/in/tomkovack

---

## One-Page Executive Summary (attach inline + as PDF)

### DumbRoof + Agentic.market — Why this fits

| Lens | DumbRoof's position |
|---|---|
| **Thesis match** | Agent-native by construction. 35 tools, MCP-native, no UI required. |
| **Vertical** | U.S. residential roofing claim supplements. $5B+ underpaid annually. |
| **Traction** | 117 claims processed. 12 wins. $6.9M USARM RCV in pipeline. $2M+ supplements awarded. |
| **IP** | USPTO provisional filed 2026-02-26 (66 claims, 18 figures). Non-provisional due 2027-02-26. |
| **Agent surface** | Public Richard API ready to wrap (`/v1/agent/process-claim`, `/draft-supplement`, `/annotate-photo`). |
| **Pricing model** | Per-call x402 in USDC on Base. $0.50 – $50 per call. Replay-protected. Auto-refund on failure. |
| **Operator credibility** | CEO is a 21-year operating roofer. Owns USA Roof Masters. Knows every carrier, every code, every line item. |
| **Launch readiness** | 1–2 week sprint to live x402 endpoint. Listing on Agentic.market in same window. |

### What we want
1. Featured launch listing on agentic.market.
2. Joint blog post + case study.
3. Tweet from Brian on launch day.
4. Intro to the Coinbase Ventures team (parallel conversation).

### What we deliver
1. First paying enterprise vertical on Agentic.market.
2. Co-authored case study showing agent-to-agent payment in production.
3. Public commitment of N onboarded caller-agents in 90 days.
4. First-look access to our claim data warehouse for joint agentic commerce research.

---

## Internal Notes (do NOT include in send-out)

- Brian's tweet timestamp: April 20. Nick's announcement: April 20. Window is hot — send within 7 days.
- Use `tom@dumbroof.ai` (paid-upgrade-flavor sender per memory) NOT `tkovack@usaroofmasters.com`. Brand is Dumb Roof Technologies, not USARM.
- BCC `arivera@dumbroof.ai` (advisor) per dumbroof.ai BCC scoping rule (memory: `feedback_usarm_bcc_scoping.md`). Do NOT BCC `tkovack@usaroofmasters.com` since this email is on dumbroof.ai brand.
- Attach: `COINBASE_AGENTIC_PITCH_DECK.pdf` rendered from `COINBASE_AGENTIC_PITCH_DECK.md`.
- Attach: `RICHARD_API_SPEC.md` rendered as PDF or hosted at a public URL.
- Mention the USPTO non-provisional deadline (2027-02-26) — creates a natural urgency for them to engage during the patent window.
- Do NOT cite revenue or ARR figures in the email — keep it about the agent surface and the strategic fit. Save financials for the deck and the call.

---

## Follow-up Plan

- **D+0** Send email + attach deck.
- **D+3** If no reply: short bump email — "Following up on Agentic.market launch partner inquiry."
- **D+7** If no reply: DM Brian on X with the same hook (1 sentence + link to the deck).
- **D+10** If no reply: DM Nick on Farcaster.
- **D+14** If no reply: send a short Loom (90-second walkthrough of Richard live processing a claim).
- **D+21** If no reply: pause and pivot — they're not the right partner; consider Anthropic / Replicate / xAI as alternates.

---

*This pitch is the canonical Coinbase outreach. Final send must be authorized by Tom. Do not send without explicit go-ahead.*

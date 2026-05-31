import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-symbility";
const TITLE =
  "DumbRoof vs Symbility: Carrier Estimating Platform vs Supplement Software (2026)";
const DESCRIPTION =
  "Symbility is a claims-estimating platform used widely on the carrier and adjuster side; DumbRoof is contractor-side software that builds the supplement to send back. Honest comparison of where each fits in a roofing insurance claim.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs Symbility",
    "Symbility alternative roofing",
    "Symbility supplement",
    "carrier estimating platform vs supplement",
    "Symbility roof claim",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs Symbility"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs Symbility"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="Symbility and Xactimate are the two big claims-estimating platforms, used widely on the carrier and adjuster side; DumbRoof is contractor-side software that builds the supplement you send back to the carrier. They sit on opposite sides of the same claim."
      directAnswerBody="Symbility is a professional estimating platform — the kind of tool an adjuster or estimator uses to write the claim estimate, with its own line-item structure and pricing. DumbRoof's job is the contractor's reply: take the carrier's estimate (whether written in Symbility or Xactimate), compare it line-by-line against a complete scope, and produce a forensic causation report, an Xactimate-style supplement estimate, and code citations that recover what was left off. If you're an adjuster who needs to write estimates, you need a platform like Symbility; if you're a roofer who needs to supplement an underpaid one, DumbRoof is built for that."
      otherLabel="Symbility"
      tableCaption="DumbRoof vs Symbility at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof:
            "Contractor-side insurance-supplement software.",
          other:
            "Professional claims-estimating platform (carrier/adjuster side).",
        },
        {
          feature: "Primary user",
          dumbroof:
            "Roofing contractors, public adjusters, attorneys, homeowners.",
          other:
            "Insurance adjusters and estimators writing claim estimates.",
        },
        {
          feature: "Core job",
          dumbroof:
            "Reply to the carrier's estimate with a documented supplement.",
          other:
            "Author the claim estimate with line items and pricing.",
        },
        {
          feature: "Forensic causation report",
          dumbroof: "Yes — generated automatically.",
          other:
            "Not its purpose; it estimates, it doesn't write causation narratives.",
        },
        {
          feature: "Scope comparison vs carrier estimate",
          dumbroof:
            "Yes — line-by-line to surface omissions.",
          other:
            "It is the estimate; comparison against it is the contractor's task.",
        },
        {
          feature: "Best for",
          dumbroof:
            "Recovering underpaid scope from the contractor side, fast.",
          other:
            "Professionals who write and manage claim estimates day to day.",
        },
      ]}
      sections={[
        {
          id: "what-symbility-is",
          heading: "What Symbility Is Built For",
          paragraphs: [
            "Symbility (part of the broader claims-tech landscape alongside Xactimate) is a professional property-claims estimating platform. It's used heavily on the carrier and adjuster side to write claim estimates, with its own line-item catalog and regional pricing. For someone whose job is producing or managing estimates day in and day out, it's a serious professional tool.",
            "Like Xactimate, Symbility is a platform for writing estimates — not for building a contractor's reply to an underpaid one. A roofer staring at a low Symbility-written estimate doesn't primarily need another estimating platform; they need to document what that estimate left off and justify it to the carrier.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Does Instead",
          paragraphs: [
            "DumbRoof is the contractor-side answer. It reads the carrier's estimate — written in Symbility, Xactimate, or anything else — and compares it line-by-line against a complete scope to find every omission. Then it produces the reply: a forensic causation report, an Xactimate-style line-item supplement estimate, and the building-code citations that back each missing item.",
            "The output speaks the recognizable Xactimate-style line-item language so it maps cleanly to whatever platform the carrier used. The goal isn't to be a better estimating platform than Symbility — it's to be the fastest way for a contractor to turn an underpaid estimate into a documented, recoverable supplement.",
          ],
        },
        {
          id: "two-sides",
          heading: "Two Sides of the Same Claim",
          paragraphs: [
            "The clearest way to think about it: Symbility is often the tool that writes the estimate; DumbRoof is the tool that answers it. One is carrier/adjuster-facing estimating infrastructure; the other is contractor-facing supplement software.",
            "That means they're not really substitutes. A contractor doesn't usually adopt Symbility to fight a Symbility estimate — they use a supplement tool. And an adjuster writing estimates needs a platform like Symbility regardless of what contractors use to respond.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You're a contractor (or PA/attorney) responding to an underpaid estimate.",
        "You want a forensic report, supplement estimate, and scope comparison.",
        "You need to find and justify what the carrier's estimate omitted.",
        "You want a fast, code-cited reply that maps to the carrier's format.",
      ]}
      chooseOther={{
        heading: "Use Symbility when…",
        items: [
          "You're an adjuster or estimator who writes claim estimates daily.",
          "You need a professional estimating platform with its own catalog and pricing.",
          "A specific carrier or workflow requires native Symbility files.",
          "Your job is authoring estimates, not replying to them.",
        ],
      }}
      bottomLine={[
        "If your job is writing and managing claim estimates — typically on the carrier or adjuster side — Symbility is a professional platform built for that, and DumbRoof isn't a replacement for it.",
        "If your job is the contractor's reply — turning an underpaid estimate into a documented, code-cited supplement — DumbRoof is built for exactly that. They sit on opposite sides of the same claim, so it's less 'which platform' and more 'which side of the table are you on.'",
      ]}
      faqs={[
        {
          question: "Is DumbRoof a Symbility alternative?",
          answer:
            "Not in the usual sense. Symbility is a professional claims-estimating platform used mainly on the carrier and adjuster side to write estimates. DumbRoof is contractor-side software that replies to an underpaid estimate with a documented supplement. They're on opposite sides of the claim rather than direct substitutes.",
        },
        {
          question: "Can DumbRoof respond to a Symbility estimate?",
          answer:
            "Yes. DumbRoof reads the carrier's estimate regardless of the platform it was written in — Symbility, Xactimate, or otherwise — and compares it line-by-line against a complete scope to find omissions, then produces a forensic report, an Xactimate-style supplement estimate, and code citations.",
        },
        {
          question: "Do I need Symbility to use DumbRoof?",
          answer:
            "No. DumbRoof doesn't require a Symbility or Xactimate license. It produces an Xactimate-style supplement estimate that maps cleanly to whatever platform the carrier used, so you can respond to a Symbility-written estimate without owning the platform yourself.",
        },
        {
          question: "What's the difference between Symbility and Xactimate?",
          answer:
            "Both are professional property-claims estimating platforms widely used to write claim estimates, each with its own line-item catalog and pricing. For a contractor, the practical point is the same either way: you're responding to an estimate written in one of them, and DumbRoof builds that response in a recognizable Xactimate-style format.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/best-xactimate-alternative-for-roofers",
          label: "Best Xactimate Alternative for Roofers",
          kicker: "Best Xactimate Alternative",
        },
        {
          href: "/compare/dumbroof-vs-diy-roof-claim-supplement",
          label: "DumbRoof vs DIY Roof Claim Supplement",
          kicker: "vs DIY Supplement",
        },
      ]}
      relatedLearn={[
        {
          href: "/learn/insurance-didnt-pay-enough-for-roof",
          label: "Insurance Didn't Pay Enough to Replace My Roof",
          kicker: "Insurance Claims",
        },
        {
          href: "/learn/what-is-a-roofing-supplement",
          label: "What Is a Roofing Supplement?",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Answer the Carrier's Estimate — Fast"
      ctaBody="However the carrier wrote it, upload the estimate with your photos and measurements. DumbRoof finds the omissions and builds the documented supplement to send back."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

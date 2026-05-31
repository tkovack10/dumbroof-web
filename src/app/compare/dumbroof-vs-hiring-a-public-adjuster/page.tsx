import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-hiring-a-public-adjuster";
const TITLE =
  "DumbRoof vs Hiring a Public Adjuster: Which Is Right for Roofing Claims? (2026)";
const DESCRIPTION =
  "DumbRoof is software you run yourself to build a carrier-ready roof supplement; a public adjuster is a licensed professional you hire on contingency. Compare cost, control, speed, and when each makes sense for an underpaid roof claim.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs public adjuster",
    "public adjuster roof claim",
    "do I need a public adjuster for roof",
    "public adjuster cost roof claim",
    "roof claim supplement software",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs Public Adjuster"
      path={PATH}
      eyebrow="Approaches"
      h1="DumbRoof vs Hiring a Public Adjuster"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="DumbRoof is software you operate yourself to build a carrier-ready supplement; a public adjuster is a licensed professional you hire to manage the claim on your behalf, usually for a percentage of the recovery."
      directAnswerBody="If you are a roofing contractor or a homeowner who wants to document an underpaid claim quickly and keep the upside, DumbRoof generates the forensic report, the Xactimate-style estimate, and the scope comparison in minutes. If you want a licensed advocate to negotiate directly with the carrier and you are comfortable paying a contingency fee, a public adjuster is the right call. They are not mutually exclusive — some public adjusters use software like DumbRoof to build their estimates faster."
      otherLabel="Public Adjuster"
      tableCaption="DumbRoof vs Public Adjuster at a Glance"
      tableRows={[
        {
          feature: "What it is",
          dumbroof:
            "AI software that produces a forensic causation report, an Xactimate-style estimate, a scope comparison, and code citations.",
          other:
            "A state-licensed insurance professional who represents the policyholder and negotiates the claim with the carrier.",
        },
        {
          feature: "Who can use it",
          dumbroof:
            "Roofing contractors, public adjusters, attorneys, and homeowners on their own claim.",
          other:
            "Hired by the policyholder; licensing rules vary by state and some states cap fees.",
        },
        {
          feature: "Typical cost model",
          dumbroof:
            "Flat software subscription (free to start; published plans). You keep the recovery.",
          other:
            "Usually a contingency fee — a percentage of the additional amount recovered. (Percentages vary by state and contract; we don't quote a figure.)",
        },
        {
          feature: "Who advocates to the carrier",
          dumbroof:
            "You do. DumbRoof builds the documentation; a contractor stays within UPPA rules, a PA/attorney/homeowner can advocate directly.",
          other:
            "The public adjuster negotiates directly with the carrier on the policyholder's behalf — that is their licensed role.",
        },
        {
          feature: "Turnaround",
          dumbroof:
            "Package generated in minutes once photos, measurements, and the carrier scope are uploaded.",
          other:
            "Depends on caseload and negotiation; the PA manages timelines but the claim still moves at carrier speed.",
        },
        {
          feature: "Best for",
          dumbroof:
            "High-volume documentation, fast supplements, keeping the full recovery, and standardizing quality across many claims.",
          other:
            "Complex, contested, or large-loss claims where a licensed advocate negotiating directly adds the most value.",
        },
      ]}
      sections={[
        {
          id: "what-each-does",
          heading: "What Each One Actually Does",
          paragraphs: [
            "A public adjuster (PA) is licensed by the state to represent the policyholder — not the insurance company — in a claim. They inspect the loss, write or commission an estimate, and negotiate the settlement directly with the carrier. Because they work for the insured, a good PA can be invaluable on a complex or contested claim. They are paid on contingency, so their fee scales with what they recover.",
            "DumbRoof is not a person and not a firm — it is software. It takes the inputs that drive any roof supplement (inspection photos, roof measurements, and the carrier's own estimate) and produces the deliverables: a forensic causation report tying the damage to a weather event, an Xactimate-style line-item estimate, a line-by-line scope comparison against the carrier scope, and the building-code citations that justify each missing item. It does the documentation work; the human decides how to use it.",
            "The key distinction is advocacy versus documentation. A PA advocates. DumbRoof documents. Strong documentation makes advocacy easier — which is exactly why the two can work together rather than competing.",
          ],
        },
        {
          id: "cost",
          heading: "The Cost Trade-Off",
          paragraphs: [
            "The economics are the clearest difference. A public adjuster typically charges a percentage of the additional money recovered. On a large or badly underpaid claim that fee can be well worth it, because the PA's negotiation may recover far more than they cost. On a routine residential supplement, that same percentage can eat a meaningful slice of the recovery.",
            "DumbRoof is a flat subscription. Whatever the supplement recovers, you keep — the software cost is the same whether the claim is small or large. For a contractor running many claims a month, that flips the math entirely: the per-claim cost of documentation approaches zero, and there is no contingency leaking out of every file.",
            "We deliberately do not quote public-adjuster fee percentages here — they vary by state, by firm, and by contract, and several states regulate or cap them. Check your state's rules and the PA's engagement letter.",
          ],
        },
        {
          id: "compliance",
          heading: "A Compliance Note for Contractors",
          paragraphs: [
            "Roofing contractors should understand the line that public adjusters are licensed to cross and they are not. In most states, only a licensed public adjuster (or attorney, or the policyholder themselves) may negotiate or advocate a claim with the carrier. Contractors who use public-adjusting language can run into Unauthorized Public Adjusting (UPPA) problems.",
            "DumbRoof is built with this in mind: it adapts its output to the user's role, so a contractor gets documentation framed appropriately (a scope clarification, not a demand), while a public adjuster or attorney gets full advocacy language because that is their job. The software helps you stay on the right side of the line instead of guessing.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You run many claims and want fast, standardized, code-cited documentation on every one.",
        "You want to keep the full recovery instead of paying a contingency fee.",
        "You are a contractor who needs role-appropriate, UPPA-safe documentation.",
        "You want the forensic report and Xactimate-style estimate generated in minutes, not days.",
      ]}
      chooseOther={{
        heading: "Hire a public adjuster when…",
        items: [
          "The claim is large, complex, or already contested and needs licensed negotiation.",
          "You want a professional to handle every carrier interaction for you.",
          "You're a homeowner who doesn't want to manage the claim and accepts a contingency fee.",
          "The carrier has denied in bad faith and you want an advocate before involving an attorney.",
        ],
      }}
      togetherNote="Many public adjusters use estimating software to build their scopes faster. A PA can run the claim and negotiate, while DumbRoof produces the forensic report and Xactimate-style estimate the PA submits — so the advocate spends time advocating, not formatting line items."
      bottomLine={[
        "Choose DumbRoof if you want to produce carrier-ready supplement documentation yourself, fast, at a flat cost, and keep the full recovery — the common case for contractors and hands-on homeowners.",
        "Choose a public adjuster if you want a licensed professional to take the claim off your plate and negotiate directly, and the claim is large or contested enough to justify a contingency fee. And remember the two aren't exclusive: the strongest claims often pair a PA's advocacy with software-grade documentation underneath it.",
      ]}
      faqs={[
        {
          question: "Is DumbRoof a public adjuster?",
          answer:
            "No. DumbRoof is AI software that builds the documentation for a roof claim supplement — a forensic causation report, an Xactimate-style estimate, a scope comparison, and code citations. It does not negotiate with the carrier or act as a licensed representative. A public adjuster is a licensed professional who advocates the claim on the policyholder's behalf.",
        },
        {
          question: "Can a contractor use DumbRoof instead of a public adjuster?",
          answer:
            "Yes, for documentation. A contractor can use DumbRoof to produce a complete, code-cited supplement package. What a contractor generally cannot do — in most states — is negotiate or advocate the claim like a public adjuster, due to Unauthorized Public Adjusting (UPPA) rules. DumbRoof adapts its language to the contractor role to help stay compliant.",
        },
        {
          question: "Which is cheaper, DumbRoof or a public adjuster?",
          answer:
            "DumbRoof is a flat software subscription, so you keep the full recovery. A public adjuster typically charges a contingency fee — a percentage of the additional amount recovered. On small, routine supplements the flat cost usually wins; on large or contested claims a public adjuster's negotiation can recover enough to justify the fee. Fee percentages vary by state and contract.",
        },
        {
          question: "Can I use both a public adjuster and DumbRoof?",
          answer:
            "Yes. They serve different functions — documentation versus advocacy. A public adjuster can negotiate the claim while DumbRoof produces the forensic report and Xactimate-style estimate the PA submits, which lets the adjuster spend more time on negotiation and less on building line items.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-diy-roof-claim-supplement",
          label: "DumbRoof vs DIY Roof Claim Supplement",
          kicker: "vs DIY Supplement",
        },
        {
          href: "/compare/best-xactimate-alternative-for-roofers",
          label: "Best Xactimate Alternative for Roofers",
          kicker: "Best Xactimate Alternative",
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
      ctaHeading="Build the Documentation Yourself — in Minutes"
      ctaBody="Upload your photos, measurements, and the carrier estimate. DumbRoof generates the forensic report, Xactimate-style estimate, and scope comparison — and you keep the full recovery."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

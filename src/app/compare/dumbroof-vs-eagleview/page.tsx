import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-eagleview";
const TITLE =
  "DumbRoof vs EagleView: Aerial Measurements vs Supplement Software (2026)";
const DESCRIPTION =
  "EagleView delivers accurate aerial roof measurement reports; DumbRoof uses measurements — from EagleView or elsewhere — to build a forensic insurance supplement. They're complementary: measurements feed into DumbRoof. Honest comparison for roofers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs EagleView",
    "EagleView insurance supplement",
    "EagleView alternative",
    "aerial roof measurements vs supplement",
    "EagleView roof claim",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs EagleView"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs EagleView"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="EagleView measures the roof; DumbRoof builds the claim. EagleView produces accurate aerial measurement reports — squares, pitches, eaves, valleys, ridges. DumbRoof takes measurements like those, plus the carrier's estimate and photos, and produces the supplement."
      directAnswerBody="This isn't a competition — it's a hand-off. Accurate measurements are an input to a good supplement, and EagleView is one of the most trusted ways to get them. DumbRoof is the next step: it turns measurements (from EagleView or another source) into a forensic causation report, an Xactimate-style line-item estimate, and a line-by-line scope comparison against the carrier scope. You need both kinds of work done; they just sit at different stages of the claim."
      otherLabel="EagleView"
      tableCaption="DumbRoof vs EagleView at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof: "Insurance-supplement generation software.",
          other: "Aerial imagery and roof-measurement reporting.",
        },
        {
          feature: "Core output",
          dumbroof:
            "Forensic report, Xactimate-style estimate, scope comparison, code citations.",
          other:
            "Accurate roof measurement report: squares, pitch, eaves, valleys, ridges, rakes.",
        },
        {
          feature: "Role in the claim",
          dumbroof:
            "Consumes measurements to build the supplement that recovers money.",
          other:
            "Provides the measurement foundation the estimate and supplement rely on.",
        },
        {
          feature: "Produces an estimate",
          dumbroof: "Yes — Xactimate-style line-item supplement estimate.",
          other:
            "No — it measures; it doesn't write the estimate or supplement.",
        },
        {
          feature: "Carrier scope comparison",
          dumbroof: "Yes — line-by-line against the carrier's estimate.",
          other: "No.",
        },
        {
          feature: "Best for",
          dumbroof:
            "Building the claim from measurements and the carrier scope.",
          other:
            "Getting trusted, defensible roof measurements without climbing.",
        },
      ]}
      sections={[
        {
          id: "what-eagleview-is",
          heading: "What EagleView Is Built For",
          paragraphs: [
            "EagleView is a leader in aerial roof measurement. From aerial and satellite imagery it produces a detailed measurement report — total squares, predominant and per-facet pitch, eave, valley, ridge, hip, and rake lengths — without anyone climbing on the roof. Those measurements are widely trusted by contractors and carriers alike, which is exactly why they carry weight in a claim.",
            "Measurements are the foundation of any accurate estimate. If the squares are wrong, every line item is wrong. So EagleView solves a critical input — but it stops at measurement. It doesn't read the carrier's estimate, find the omissions, or write the supplement.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "Where DumbRoof Picks Up",
          paragraphs: [
            "DumbRoof takes the measurement foundation and builds the claim on top of it. Give it the roof measurements (an EagleView report works well), the carrier's estimate, and inspection photos, and it produces a forensic causation report, an Xactimate-style line-item estimate calculated against those measurements, a line-by-line scope comparison that surfaces every omission, and the building-code citations that justify each item.",
            "The measurements drive the quantities — accurate eave and valley footage means accurate ice and water shield, drip edge, and starter quantities, which is where carriers often undercount. DumbRoof turns the geometry into a defensible, code-cited supplement.",
          ],
        },
        {
          id: "together",
          heading: "Measurements In, Supplement Out",
          paragraphs: [
            "The workflow is a clean pipeline: get trusted measurements from EagleView, then feed them into DumbRoof along with the carrier scope and photos to produce the supplement. Accurate measurements in means an accurate, harder-to-dispute supplement out.",
            "DumbRoof is deliberately measurement-source-flexible — it isn't locked to one provider. But the principle is the same regardless of source: the better and more defensible the measurements, the stronger the resulting estimate and supplement.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You have measurements and need to turn them into a claim.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "Your gap is the supplement document, not the measurement.",
        "You want measurement-driven quantities turned into code-cited line items.",
      ]}
      chooseOther={{
        heading: "Choose EagleView when…",
        items: [
          "You need accurate, defensible roof measurements without climbing.",
          "You want squares, pitch, eave/valley/ridge lengths in a trusted report.",
          "Your gap is the measurement foundation, not the claim document.",
          "You want measurements carriers and contractors both recognize.",
        ],
      }}
      togetherNote="Get trusted measurements from EagleView, then feed them into DumbRoof with the carrier scope and photos. Accurate eave and valley footage drives accurate ice-and-water-shield, drip-edge, and starter quantities — exactly where carriers undercount. Measurements in, supplement out."
      bottomLine={[
        "If your gap is measurement, EagleView is a trusted way to get defensible roof geometry, and DumbRoof doesn't replace it.",
        "If your gap is the claim document, DumbRoof turns those measurements (plus the carrier scope and photos) into the supplement that recovers money. They're sequential, not competing — most accurate claims use trusted measurements feeding into supplement software.",
      ]}
      faqs={[
        {
          question: "Is EagleView a supplement tool?",
          answer:
            "No. EagleView produces aerial roof measurement reports — squares, pitch, eave/valley/ridge lengths — from imagery. It doesn't read the carrier's estimate, build a line-item estimate, or write a supplement. Turning measurements into a forensic supplement is DumbRoof's job.",
        },
        {
          question: "Can DumbRoof use EagleView measurements?",
          answer:
            "Yes. DumbRoof is built to consume roof measurements — an EagleView report works well — alongside the carrier's estimate and photos to produce the supplement. Accurate measurements drive accurate line-item quantities, especially for ice and water shield, drip edge, and starter strip.",
        },
        {
          question: "Does DumbRoof replace EagleView?",
          answer:
            "No. They sit at different stages of the claim — EagleView provides the measurement foundation; DumbRoof builds the supplement on top of it. The two form a pipeline: measurements in, supplement out. DumbRoof is also flexible about the measurement source.",
        },
        {
          question: "Why do accurate measurements matter for a supplement?",
          answer:
            "Measurements set the quantities for every line item. If the squares, eave footage, or valley length are wrong, the estimate and supplement are wrong — and carriers frequently undercount these. Feeding trusted measurements into DumbRoof produces defensible quantities and a harder-to-dispute supplement.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-hover",
          label: "DumbRoof vs Hover",
          kicker: "vs Hover",
        },
        {
          href: "/compare/dumbroof-vs-companycam",
          label: "DumbRoof vs CompanyCam",
          kicker: "vs CompanyCam",
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
      ctaHeading="Turn Measurements Into a Supplement"
      ctaBody="Bring your EagleView (or any) measurements, the carrier's estimate, and photos. DumbRoof builds the forensic report, Xactimate-style estimate, and scope comparison in minutes."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-hover";
const TITLE =
  "DumbRoof vs Hover: 3D Property Measurements vs Supplement Software (2026)";
const DESCRIPTION =
  "Hover builds interactive 3D measurement models of a property from phone photos; DumbRoof uses measurements to build a forensic insurance supplement. They're complementary — measurements feed into DumbRoof. Honest comparison for roofing contractors.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs Hover",
    "Hover insurance supplement",
    "Hover alternative",
    "3D roof measurements vs supplement",
    "Hover roof claim",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs Hover"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs Hover"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="Hover turns phone photos of a house into an interactive 3D model with roof and exterior measurements; DumbRoof turns measurements and the carrier's estimate into an insurance supplement. Hover measures the property; DumbRoof builds the claim."
      directAnswerBody="Like EagleView, Hover sits on the measurement side of the workflow — its standout feature is a 3D model built from ground-level smartphone photos, useful for both roof and full-exterior (siding, windows) measurement. DumbRoof is the next step: it consumes measurements (from Hover or elsewhere), plus the carrier's estimate and inspection photos, to produce a forensic causation report, an Xactimate-style estimate, and a scope comparison. They're sequential, not competing."
      otherLabel="Hover"
      tableCaption="DumbRoof vs Hover at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof: "Insurance-supplement generation software.",
          other:
            "3D property modeling and measurement from smartphone photos.",
        },
        {
          feature: "Core output",
          dumbroof:
            "Forensic report, Xactimate-style estimate, scope comparison, code citations.",
          other:
            "Interactive 3D model with roof and exterior (siding, windows) measurements.",
        },
        {
          feature: "Role in the claim",
          dumbroof:
            "Consumes measurements to build the supplement that recovers money.",
          other:
            "Provides the measurement model the estimate and supplement build on.",
        },
        {
          feature: "Produces an estimate",
          dumbroof: "Yes — Xactimate-style line-item supplement estimate.",
          other:
            "Generates measurement-based material lists; not a carrier supplement.",
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
            "Capturing 3D roof and exterior measurements from phone photos.",
        },
      ]}
      sections={[
        {
          id: "what-hover-is",
          heading: "What Hover Is Built For",
          paragraphs: [
            "Hover's distinctive capability is building an interactive 3D model of a property from a set of ground-level smartphone photos. From that model it derives roof measurements and full-exterior measurements — siding, windows, doors — which makes it especially useful when a claim involves more than just the roof. A rep can capture the photos on-site with a phone and get back a measured model.",
            "That model is a measurement and visualization asset. It informs material orders and estimates, but it isn't a carrier-facing supplement. Hover measures and visualizes the property; it doesn't analyze the carrier's estimate or author the forensic claim document.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "Where DumbRoof Picks Up",
          paragraphs: [
            "DumbRoof takes the measurements and builds the claim. Feed it roof (and, where relevant, exterior) measurements, the carrier's estimate, and inspection photos, and it produces a forensic causation report, an Xactimate-style line-item estimate calculated against the measurements, a line-by-line scope comparison against the carrier scope, and the building-code citations that justify each item.",
            "Because Hover also captures exterior measurements, it pairs naturally with claims that include siding and windows — where DumbRoof's discipline of including the full scope (house wrap, wall flashing, window wraps) turns those measurements into recoverable line items the carrier often misses.",
          ],
        },
        {
          id: "together",
          heading: "Measurements In, Supplement Out",
          paragraphs: [
            "The pipeline mirrors the EagleView story: capture measurements with Hover, then feed them into DumbRoof with the carrier scope and photos to build the supplement. Accurate measurements produce accurate, harder-to-dispute quantities.",
            "DumbRoof is intentionally flexible about the measurement source, so a shop can use Hover, EagleView, or its own measurements and still get the same supplement output. The point isn't which measurement tool — it's that good measurements feed a good supplement.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You have measurements and need to turn them into a claim.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "Your gap is the supplement document, not the measurement model.",
        "Your claim includes siding/windows and you want full-scope line items.",
      ]}
      chooseOther={{
        heading: "Choose Hover when…",
        items: [
          "You want a 3D model and measurements from phone photos on-site.",
          "Your claim involves exterior scope (siding, windows) too.",
          "You want visualization to plan material orders and estimates.",
          "Your gap is capturing measurements, not building the claim document.",
        ],
      }}
      togetherNote="Capture a 3D measurement model with Hover, then feed those roof and exterior measurements into DumbRoof with the carrier scope and photos. For siding-and-windows claims especially, that turns Hover's exterior measurements into full-scope, code-cited line items carriers often omit."
      bottomLine={[
        "If your gap is measurement and visualization — especially full-exterior — Hover is built for that, and DumbRoof doesn't replace it.",
        "If your gap is the claim document, DumbRoof turns those measurements (plus the carrier scope and photos) into a forensic supplement that recovers money. They're sequential: measurements in, supplement out, and DumbRoof works with whatever measurement source you prefer.",
      ]}
      faqs={[
        {
          question: "Is Hover a supplement tool?",
          answer:
            "No. Hover builds an interactive 3D model and measurements of a property from smartphone photos, including roof and exterior (siding, windows). It doesn't read the carrier's estimate or author a supplement. Turning measurements into a forensic supplement is DumbRoof's job.",
        },
        {
          question: "Can DumbRoof use Hover measurements?",
          answer:
            "Yes. DumbRoof consumes roof and exterior measurements — Hover's models work well — alongside the carrier's estimate and photos to build the supplement. This is especially useful for claims that include siding and windows, where DumbRoof turns exterior measurements into full-scope line items.",
        },
        {
          question: "Does DumbRoof replace Hover?",
          answer:
            "No. They sit at different stages — Hover captures the measurement model; DumbRoof builds the supplement on top of it. The two form a pipeline: measurements in, supplement out. DumbRoof is flexible about the measurement source.",
        },
        {
          question: "Which is better for a siding and windows claim?",
          answer:
            "Hover is strong for capturing exterior measurements (siding, windows) from phone photos. DumbRoof then turns those measurements into a supplement that includes the full exterior scope — house wrap, wall flashing, window wraps — that carriers commonly omit. For a complete siding/windows claim, you'd use both: measure with Hover, document with DumbRoof.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-eagleview",
          label: "DumbRoof vs EagleView",
          kicker: "vs EagleView",
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
      ctaHeading="Turn Your 3D Measurements Into a Supplement"
      ctaBody="Bring your Hover (or any) measurements, the carrier's estimate, and photos. DumbRoof builds the forensic report, Xactimate-style estimate, and scope comparison in minutes."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

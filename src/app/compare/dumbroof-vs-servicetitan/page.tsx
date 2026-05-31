import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-servicetitan";
const TITLE =
  "DumbRoof vs ServiceTitan: Field-Service Platform vs Roofing Supplement Software (2026)";
const DESCRIPTION =
  "ServiceTitan is a broad field-service management platform for home-services businesses; DumbRoof is purpose-built roofing insurance-supplement software. They solve different problems and can run side by side. Honest comparison for roofing contractors.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs ServiceTitan",
    "ServiceTitan roofing",
    "ServiceTitan insurance supplement",
    "field service software vs supplement",
    "ServiceTitan alternative roofing",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs ServiceTitan"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs ServiceTitan"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="ServiceTitan is a broad field-service management platform for home-services businesses; DumbRoof is purpose-built roofing insurance-supplement software. One runs the operation across many trades; the other does one roofing-specific job extremely well."
      directAnswerBody="ServiceTitan handles scheduling, dispatch, CRM, invoicing, payroll, and reporting for field-service companies — strong for high-volume service operations and multi-trade shops. DumbRoof does the narrow, roofing-specific job ServiceTitan isn't built for: reading a carrier's estimate and producing a forensic causation report, an Xactimate-style supplement estimate, and a scope comparison that recovers underpaid claim money. If you need an operational backbone, ServiceTitan is a platform for that; if you need to win insurance supplements, DumbRoof is the specialist. They're complementary."
      otherLabel="ServiceTitan"
      tableCaption="DumbRoof vs ServiceTitan at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof:
            "Roofing insurance-supplement software (specialist).",
          other:
            "Field-service management platform for home services (generalist).",
        },
        {
          feature: "Scope",
          dumbroof:
            "One roofing-specific job: building the carrier-ready supplement.",
          other:
            "End-to-end operations: scheduling, dispatch, CRM, invoicing, payroll, reporting.",
        },
        {
          feature: "Trade focus",
          dumbroof:
            "Roofing claims specifically (with siding/exterior scope too).",
          other:
            "Many trades — HVAC, plumbing, electrical, roofing, and more.",
        },
        {
          feature: "Forensic causation report",
          dumbroof: "Yes — generated automatically.",
          other:
            "Not a field-service-platform function.",
        },
        {
          feature: "Xactimate-style supplement estimate",
          dumbroof:
            "Yes — line-item supplement, no Xactimate license required.",
          other:
            "Has invoicing/estimating for service work, not carrier supplements.",
        },
        {
          feature: "Best for",
          dumbroof:
            "Recovering underpaid insurance money on roofing claims.",
          other:
            "Running a high-volume, possibly multi-trade field-service operation.",
        },
      ]}
      sections={[
        {
          id: "what-servicetitan-is",
          heading: "What ServiceTitan Is Built For",
          paragraphs: [
            "ServiceTitan is a comprehensive field-service management platform. It's strongest as the operational backbone of a home-services business: scheduling and dispatching crews, managing the call center and CRM, generating invoices, handling payroll and commissions, and reporting on the whole operation. It serves many trades, which makes it a natural fit for larger or multi-trade companies that want everything in one system.",
            "That breadth is the point — and the boundary. A generalist operations platform isn't built to read an insurance carrier's roof estimate, find the omitted line items, and author a forensic, code-cited supplement. That's a deep, roofing-claims-specific task outside its core.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Specializes In",
          paragraphs: [
            "DumbRoof is the specialist for that exact task. Give it the carrier's estimate, the roof measurements, and inspection photos, and it produces the supplement: a forensic causation report tying damage to a weather event, an Xactimate-style line-item estimate, a line-by-line scope comparison surfacing every omission, and the building-code citations that justify each item.",
            "This is depth, not breadth. DumbRoof doesn't schedule crews or run payroll — it goes deep on one high-value roofing problem (recovering underpaid claims) that a broad platform treats only superficially, if at all.",
          ],
        },
        {
          id: "together",
          heading: "Specialist Alongside the Platform",
          paragraphs: [
            "For a roofing company that runs on ServiceTitan, the sensible setup is to keep the platform for operations and add DumbRoof for claims. Operations, scheduling, and invoicing live in ServiceTitan; when a carrier underpays a roof claim, DumbRoof builds the supplement, and the recovered amount flows back into the financials the platform tracks.",
            "You don't replace your operations platform to gain supplement capability, and you don't expect a generalist platform to match a specialist's depth on claims. Running both is the normal answer.",
          ],
        },
      ]}
      chooseDumbroof={[
        "Your roofing claims are underpaid and you need carrier-ready documentation.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "You already run operations on a platform and just need the claims piece.",
        "You want roofing-claims depth, not a generalist's surface coverage.",
      ]}
      chooseOther={{
        heading: "Choose ServiceTitan when…",
        items: [
          "You need an operational backbone: scheduling, dispatch, CRM, invoicing, payroll.",
          "You run high volume or multiple trades and want one system.",
          "Your bottleneck is running the operation, not roofing claims.",
          "You want company-wide reporting across the whole business.",
        ],
      }}
      togetherNote="Run ServiceTitan as your operations platform and add DumbRoof for roofing claims. Scheduling, dispatch, and invoicing stay in ServiceTitan; when a carrier underpays, DumbRoof builds the supplement and the recovered amount flows back into the financials the platform tracks."
      bottomLine={[
        "If you need a broad operational platform — especially at high volume or across multiple trades — ServiceTitan is built for that, and DumbRoof doesn't replace it.",
        "If you need to recover underpaid roofing-insurance money, DumbRoof's specialist depth does what a generalist platform can't. It's a breadth-vs-depth call, and for most roofing shops the answer is to run the operations platform and add the claims specialist alongside it.",
      ]}
      faqs={[
        {
          question: "Is DumbRoof a ServiceTitan alternative?",
          answer:
            "Not directly. ServiceTitan is a broad field-service management platform (scheduling, dispatch, CRM, invoicing, payroll) serving many trades. DumbRoof is a roofing-claims specialist that builds insurance supplements. They solve different problems — operations versus claims — so they're typically run side by side rather than as substitutes.",
        },
        {
          question: "Does ServiceTitan build roofing insurance supplements?",
          answer:
            "ServiceTitan handles operations and service-work invoicing, but authoring a carrier-ready roofing supplement — analyzing the carrier's estimate, comparing it against a complete scope, writing a forensic causation report, and citing code — is a roofing-claims-specific job that DumbRoof specializes in, not a core field-service-platform function.",
        },
        {
          question: "Can DumbRoof work alongside ServiceTitan?",
          answer:
            "Yes. Keep ServiceTitan as the operational backbone and add DumbRoof for claims. Operations and invoicing live in ServiceTitan; when a carrier underpays a roof claim, DumbRoof builds the supplement, and the recovered amount flows back into the financials the platform tracks.",
        },
        {
          question: "Should a roofing company use a platform or a specialist tool?",
          answer:
            "It's not either/or. A platform like ServiceTitan runs the operation; a specialist like DumbRoof goes deep on a single high-value problem (recovering underpaid roof claims). Larger and multi-trade shops often benefit from a platform plus specialist tools for the workflows that need depth.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-acculynx",
          label: "DumbRoof vs AccuLynx",
          kicker: "vs AccuLynx",
        },
        {
          href: "/compare/dumbroof-vs-jobnimbus",
          label: "DumbRoof vs JobNimbus",
          kicker: "vs JobNimbus",
        },
        {
          href: "/compare/best-xactimate-alternative-for-roofers",
          label: "Best Xactimate Alternative for Roofers",
          kicker: "Best Xactimate Alternative",
        },
      ]}
      relatedLearn={[
        {
          href: "/learn/how-to-automate-insurance-invoicing",
          label: "How to Automate Insurance Invoicing",
          kicker: "Business Operations",
        },
        {
          href: "/learn/insurance-didnt-pay-enough-for-roof",
          label: "Insurance Didn't Pay Enough to Replace My Roof",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Add the Roofing-Claims Specialist"
      ctaBody="Keep running operations on your platform. When a carrier underpays a roof claim, upload the estimate, photos, and measurements — DumbRoof builds the supplement that recovers the difference."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

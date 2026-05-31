import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-acculynx";
const TITLE = "DumbRoof vs AccuLynx: CRM vs Insurance Supplement Software (2026)";
const DESCRIPTION =
  "AccuLynx is a roofing CRM that runs the whole business — leads, jobs, production, and accounting. DumbRoof is AI software that builds carrier-ready insurance supplements. They solve different problems and work well side by side. Honest comparison for roofers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs AccuLynx",
    "AccuLynx insurance supplement",
    "AccuLynx alternative",
    "roofing CRM vs supplement software",
    "AccuLynx supplementing",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs AccuLynx"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs AccuLynx"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="AccuLynx is a roofing CRM and business-management platform; DumbRoof is insurance-supplement software. This isn't really an either/or — AccuLynx runs your company, and DumbRoof builds the carrier-ready supplement for the claims flowing through it."
      directAnswerBody="AccuLynx manages leads, contacts, jobs, production scheduling, photos, document storage, and accounting — the operating system of a roofing business. DumbRoof does one thing AccuLynx isn't built to do: take a carrier's estimate and produce a forensic causation report, an Xactimate-style line-item estimate, and a scope comparison that recovers underpaid money. If you're choosing between them, you're probably asking the wrong question — most shops keep their CRM and add a supplement tool. If you must pick one, pick the one that solves your bigger bottleneck right now."
      otherLabel="AccuLynx"
      tableCaption="DumbRoof vs AccuLynx at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof:
            "Insurance-supplement software (claims documentation).",
          other:
            "Roofing CRM and end-to-end business-management platform.",
        },
        {
          feature: "Core job",
          dumbroof:
            "Turn the carrier scope + photos + measurements into a carrier-ready supplement.",
          other:
            "Run the business: leads, contacts, jobs, scheduling, production, documents, accounting.",
        },
        {
          feature: "Forensic causation report",
          dumbroof: "Yes — generated automatically.",
          other:
            "Not a CRM function; AccuLynx stores documents but doesn't author forensic reports.",
        },
        {
          feature: "Xactimate-style estimate",
          dumbroof:
            "Yes — line-item supplement estimate, no Xactimate license required.",
          other:
            "Has estimating/proposal features for the sales side, not carrier supplement generation.",
        },
        {
          feature: "Carrier scope comparison",
          dumbroof:
            "Yes — line-by-line against the carrier's estimate.",
          other:
            "Not its focus.",
        },
        {
          feature: "Best for",
          dumbroof:
            "The claims side: recovering underpaid insurance money with documentation.",
          other:
            "The whole operation: pipeline, production, and financial management.",
        },
      ]}
      sections={[
        {
          id: "what-acculynx-is",
          heading: "What AccuLynx Is Built For",
          paragraphs: [
            "AccuLynx is one of the most established roofing CRMs. It's the system of record for a roofing company: capturing leads, managing contacts and jobs, scheduling crews, tracking production, storing photos and documents, handling ordering, and connecting to accounting. For a growing shop, that single source of truth is what keeps the operation from living in spreadsheets and texts.",
            "What a CRM is not built to do is author the forensic, carrier-facing documents that recover underpaid claims. AccuLynx will happily store the carrier's estimate and your photos; it won't read that estimate, compare it against a complete scope, and write a code-cited supplement. That's a different category of software.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Adds",
          paragraphs: [
            "DumbRoof is purpose-built for the claims gap. Point it at a carrier's estimate, the roof measurements, and the inspection photos, and it produces the supplement package: a forensic causation report, an Xactimate-style line-item estimate, a line-by-line scope comparison that surfaces every omission, and the building-code citations that back the code-required items.",
            "That's the work that otherwise eats an estimator's afternoon — or, more often, doesn't get done at all, leaving real money on the table. DumbRoof makes it fast and repeatable, claim after claim.",
          ],
        },
        {
          id: "together",
          heading: "Why Most Shops Keep Both",
          paragraphs: [
            "The natural setup is AccuLynx as the operating system and DumbRoof as the claims engine. The CRM holds the customer, the job, the photos, and the documents; when a carrier underpays, DumbRoof builds the supplement, which then gets stored back against the job in the CRM and tracked through to recovery.",
            "Replacing your CRM is a big, disruptive decision. Adding a focused supplement tool alongside it is not. That's why 'DumbRoof vs AccuLynx' usually resolves to 'DumbRoof with AccuLynx' — they're complementary, not competing.",
          ],
        },
      ]}
      chooseDumbroof={[
        "Your claims are getting underpaid and you need carrier-ready documentation.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "You already have a CRM and just need the supplement piece.",
        "You want code-cited supplements produced in minutes, every time.",
      ]}
      chooseOther={{
        heading: "Choose AccuLynx when…",
        items: [
          "You need a system of record for leads, jobs, production, and accounting.",
          "Your bottleneck is running the operation, not the claims documentation.",
          "You want crew scheduling, ordering, and financials in one place.",
          "You're standardizing how the whole business is managed.",
        ],
      }}
      togetherNote="Run AccuLynx as your CRM and add DumbRoof for the claims side. The CRM tracks the customer and job; DumbRoof builds the supplement when the carrier underpays, and the finished package lives back in the CRM against the job."
      bottomLine={[
        "If you need to run your roofing business — pipeline, production, financials — AccuLynx is a CRM built for exactly that, and DumbRoof doesn't replace it.",
        "If you need to recover underpaid insurance money, DumbRoof builds the forensic supplement your CRM can't. For most shops the right move is to keep the CRM and add DumbRoof for claims — they solve different problems and complement each other cleanly.",
      ]}
      faqs={[
        {
          question: "Is DumbRoof an AccuLynx alternative?",
          answer:
            "Not directly — they're different categories. AccuLynx is a roofing CRM that runs the whole business (leads, jobs, production, accounting). DumbRoof is insurance-supplement software that builds carrier-ready forensic reports and Xactimate-style estimates. Most shops keep their CRM and add DumbRoof for the claims side rather than replacing one with the other.",
        },
        {
          question: "Does AccuLynx build insurance supplements?",
          answer:
            "AccuLynx stores documents and has sales-side estimating features, but authoring a carrier-ready supplement — reading the carrier's estimate, comparing it line-by-line against a complete scope, writing a forensic causation report, and citing code — is DumbRoof's specific purpose, not a core CRM function.",
        },
        {
          question: "Can DumbRoof work alongside AccuLynx?",
          answer:
            "Yes. The common setup is AccuLynx as the system of record and DumbRoof as the claims engine. The CRM holds the customer, job, and documents; DumbRoof builds the supplement when a carrier underpays, and the finished package is tracked back against the job.",
        },
        {
          question: "Which should I buy first, a CRM or supplement software?",
          answer:
            "It depends on your bigger bottleneck. If your operation is chaotic — leads, scheduling, and financials scattered — a CRM like AccuLynx solves that. If your operation runs fine but carriers keep underpaying claims, DumbRoof recovers money you're currently leaving on the table. Many shops eventually run both.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-jobnimbus",
          label: "DumbRoof vs JobNimbus",
          kicker: "vs JobNimbus",
        },
        {
          href: "/compare/dumbroof-vs-servicetitan",
          label: "DumbRoof vs ServiceTitan",
          kicker: "vs ServiceTitan",
        },
        {
          href: "/compare/dumbroof-vs-companycam",
          label: "DumbRoof vs CompanyCam",
          kicker: "vs CompanyCam",
        },
      ]}
      relatedLearn={[
        {
          href: "/learn/how-to-automate-insurance-invoicing",
          label: "How to Automate Insurance Invoicing",
          kicker: "Business Operations",
        },
        {
          href: "/learn/what-is-a-roofing-supplement",
          label: "What Is a Roofing Supplement?",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Add the Claims Engine to Your CRM"
      ctaBody="Keep running your business in your CRM. When a carrier underpays, upload the estimate, photos, and measurements — DumbRoof builds the supplement that recovers the difference."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

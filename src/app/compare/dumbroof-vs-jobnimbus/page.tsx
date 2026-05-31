import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-jobnimbus";
const TITLE = "DumbRoof vs JobNimbus: CRM vs Insurance Supplement Software (2026)";
const DESCRIPTION =
  "JobNimbus is a roofing CRM and project-pipeline platform; DumbRoof is AI software that builds carrier-ready insurance supplements. Different jobs, and they complement each other. Honest comparison of where each one fits for a roofing contractor.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs JobNimbus",
    "JobNimbus insurance supplement",
    "JobNimbus alternative",
    "roofing CRM vs supplement software",
    "JobNimbus supplementing",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs JobNimbus"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs JobNimbus"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="JobNimbus is a roofing CRM and pipeline platform; DumbRoof is insurance-supplement software. They sit at different points in the job — JobNimbus manages the workflow, DumbRoof builds the carrier-ready supplement — so for most contractors this is a 'both' rather than an 'either.'"
      directAnswerBody="JobNimbus organizes leads, contacts, jobs, tasks, boards, photos, and documents, and tracks each job through a visual pipeline. DumbRoof takes a carrier's estimate plus photos and measurements and produces a forensic causation report, an Xactimate-style line-item estimate, and a scope comparison that recovers underpaid money. If your problem is keeping jobs organized and moving, JobNimbus solves it. If your problem is carriers underpaying claims, DumbRoof solves that. Choosing one over the other usually means picking which bottleneck hurts more today."
      otherLabel="JobNimbus"
      tableCaption="DumbRoof vs JobNimbus at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof: "Insurance-supplement software (claims documentation).",
          other: "Roofing CRM and project-pipeline management platform.",
        },
        {
          feature: "Core job",
          dumbroof:
            "Build a carrier-ready supplement from the carrier scope, photos, and measurements.",
          other:
            "Manage leads, jobs, tasks, and the visual pipeline from lead to completion.",
        },
        {
          feature: "Forensic causation report",
          dumbroof: "Yes — generated automatically.",
          other: "Not a CRM function; it stores documents, doesn't author them.",
        },
        {
          feature: "Xactimate-style estimate",
          dumbroof:
            "Yes — line-item supplement estimate, no Xactimate license required.",
          other:
            "Has sales-side estimating/proposal tools, not carrier supplement generation.",
        },
        {
          feature: "Carrier scope comparison",
          dumbroof: "Yes — line-by-line against the carrier's estimate.",
          other: "Not its focus.",
        },
        {
          feature: "Best for",
          dumbroof:
            "Recovering underpaid insurance money through documentation.",
          other:
            "Keeping the pipeline organized and jobs moving end to end.",
        },
      ]}
      sections={[
        {
          id: "what-jobnimbus-is",
          heading: "What JobNimbus Is Built For",
          paragraphs: [
            "JobNimbus is a popular roofing CRM known for its visual, board-style pipeline. It captures leads, keeps contacts and jobs organized, assigns tasks, stores photos and documents, and shows where every job sits from first contact to completion. For a contractor who wants the whole team looking at the same pipeline, that visibility is the core value.",
            "Like any CRM, what it is not built to do is read a carrier's estimate and author a forensic supplement. It will store the estimate and the photos; it won't analyze the scope, find the omissions, and write the code-cited case for more money. That's a separate job.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Adds",
          paragraphs: [
            "DumbRoof handles exactly that separate job. Feed it the carrier's estimate, the roof measurements, and the inspection photos, and it produces the supplement: a forensic causation report, an Xactimate-style line-item estimate, a line-by-line scope comparison that surfaces every omission, and the building-code citations that justify the code-required items.",
            "It targets the claims revenue a pipeline tool simply doesn't address — the drip edge, starter strip, ice and water shield, step flashing, and overhead and profit that carriers routinely leave off and that quietly shrink margins when nobody supplements.",
          ],
        },
        {
          id: "together",
          heading: "Using Them Together",
          paragraphs: [
            "The clean setup is JobNimbus running the pipeline and DumbRoof running the claims. A job moves through the JobNimbus board as normal; when the carrier's estimate comes in low, DumbRoof builds the supplement, and the finished package is attached back to the job and tracked to recovery.",
            "Swapping out a CRM is disruptive and rarely worth it just to gain supplement capability. Adding a focused supplement tool alongside the CRM you already use is low-friction — which is why this comparison usually ends in 'both.'",
          ],
        },
      ]}
      chooseDumbroof={[
        "Carriers are underpaying and you need carrier-ready documentation.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "You're happy with your pipeline tool and only need the supplement piece.",
        "You want consistent, code-cited supplements produced fast.",
      ]}
      chooseOther={{
        heading: "Choose JobNimbus when…",
        items: [
          "You need a visual pipeline to keep jobs and tasks organized.",
          "Your bottleneck is workflow and team visibility, not claims.",
          "You want leads, contacts, jobs, and documents in one CRM.",
          "You're standardizing how the team tracks work end to end.",
        ],
      }}
      togetherNote="Run JobNimbus as your pipeline CRM and add DumbRoof for claims. The job moves through your board as usual; when the carrier underpays, DumbRoof builds the supplement and the finished package attaches back to the job."
      bottomLine={[
        "If your need is pipeline and organization, JobNimbus is a CRM built for that, and DumbRoof doesn't replace it.",
        "If your need is recovering underpaid insurance money, DumbRoof builds the forensic supplement your CRM can't. The two are complementary — most contractors keep the CRM and add DumbRoof for the claims side.",
      ]}
      faqs={[
        {
          question: "Is DumbRoof a JobNimbus alternative?",
          answer:
            "Not directly. JobNimbus is a roofing CRM and pipeline-management platform; DumbRoof is insurance-supplement software that builds forensic reports and Xactimate-style estimates. They handle different jobs, so most contractors keep their CRM and add DumbRoof for the claims side rather than replacing one with the other.",
        },
        {
          question: "Does JobNimbus create insurance supplements?",
          answer:
            "JobNimbus stores documents and has sales-side estimating tools, but authoring a carrier-ready supplement — analyzing the carrier's estimate, comparing it line-by-line against a complete scope, writing a forensic causation report, and citing code — is DumbRoof's specific purpose, not a core CRM function.",
        },
        {
          question: "Can I use DumbRoof with JobNimbus?",
          answer:
            "Yes. The common setup is JobNimbus running the pipeline and DumbRoof running claims. The job moves through your JobNimbus board; when the carrier underpays, DumbRoof builds the supplement, and the finished package is attached back to the job and tracked to recovery.",
        },
        {
          question: "Which matters more for margins, a CRM or supplement software?",
          answer:
            "A CRM protects margins indirectly by keeping jobs organized and nothing slipping through the cracks. Supplement software protects margins directly by recovering underpaid scope on each claim. If carriers are routinely underpaying you, DumbRoof addresses the more immediate margin leak; if jobs are getting lost or stalled, the CRM does.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-acculynx",
          label: "DumbRoof vs AccuLynx",
          kicker: "vs AccuLynx",
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
          href: "/learn/insurance-didnt-pay-enough-for-roof",
          label: "Insurance Didn't Pay Enough to Replace My Roof",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Keep Your Pipeline — Add the Supplement Engine"
      ctaBody="Manage jobs in JobNimbus as usual. When the carrier's estimate is low, upload it with your photos and measurements and DumbRoof builds the supplement that recovers the difference."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

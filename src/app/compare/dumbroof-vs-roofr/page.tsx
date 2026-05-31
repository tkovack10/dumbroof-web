import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-roofr";
const TITLE =
  "DumbRoof vs Roofr: Which Is Right for Roofing Insurance Claims? (2026)";
const DESCRIPTION =
  "Roofr is a roofing sales platform for measurements, proposals, and estimates; DumbRoof is AI software that builds carrier-ready insurance supplements. See where each fits, where they overlap, and how a sales tool and a supplement tool can work together.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs Roofr",
    "Roofr alternative",
    "Roofr insurance supplement",
    "roofing proposal software vs supplement",
    "Roofr roofing software",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs Roofr"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs Roofr"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="Roofr and DumbRoof solve different parts of a roofing business. Roofr is a sales and proposal platform — roof measurements, instant estimates, and homeowner-facing proposals. DumbRoof is insurance-supplement software — forensic reports, Xactimate-style estimates, and scope comparisons against the carrier's estimate."
      directAnswerBody="If your priority is closing retail and insurance sales with clean measurements and polished proposals, Roofr is built for that workflow. If your priority is recovering underpaid insurance money by documenting what the carrier's estimate missed, DumbRoof is built for that. They overlap around 'estimates,' but the purpose differs: Roofr's estimate sells the job; DumbRoof's estimate proves the supplement to the carrier. Many roofers reasonably use a sales/measurement tool for the front of the job and a supplement tool for the claim side."
      otherLabel="Roofr"
      tableCaption="DumbRoof vs Roofr at a Glance"
      tableRows={[
        {
          feature: "Primary purpose",
          dumbroof:
            "Build a carrier-ready insurance supplement that recovers underpaid claim money.",
          other:
            "Power the roofing sales workflow: measurements, instant estimates, and homeowner proposals.",
        },
        {
          feature: "Core outputs",
          dumbroof:
            "Forensic causation report, Xactimate-style estimate, scope comparison, code citations.",
          other:
            "Roof measurement reports, sales estimates, and branded proposals for homeowners.",
        },
        {
          feature: "Audience for the document",
          dumbroof:
            "The insurance carrier / adjuster reviewing a supplement.",
          other:
            "The homeowner deciding whether to buy the job.",
        },
        {
          feature: "Carrier scope comparison",
          dumbroof:
            "Yes — line-by-line against the carrier's estimate to surface omissions.",
          other:
            "Not its focus; built for selling rather than supplementing a carrier scope.",
        },
        {
          feature: "Forensic causation",
          dumbroof:
            "Yes — ties damage to a documented weather event.",
          other:
            "Not a sales-platform function.",
        },
        {
          feature: "Best for",
          dumbroof:
            "The insurance-claim side: documenting and recovering underpaid scope.",
          other:
            "The sales side: fast measurements, estimates, and proposals to win the job.",
        },
      ]}
      sections={[
        {
          id: "what-roofr-is",
          heading: "What Roofr Is Built For",
          paragraphs: [
            "Roofr is a roofing sales platform. Its strengths are speed at the front of the job: pulling roof measurements, turning them into instant estimates, and packaging them into clean, branded proposals a homeowner can review and sign. For a sales-driven roofing company, that workflow shortens the time from inspection to signed contract, which is exactly what a sales tool should do.",
            "That focus is also its boundary. A proposal that wins a homeowner's signature is a different document from a supplement that convinces an insurance adjuster to release more money. The first is persuasive and customer-facing; the second is forensic and carrier-facing.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Is Built For",
          paragraphs: [
            "DumbRoof starts where the carrier's estimate is too low. It takes the inspection photos, the roof measurements, and the carrier's own estimate, and produces the documents that recover underpaid money: a forensic causation report tying the damage to a weather event, an Xactimate-style line-item estimate, a line-by-line scope comparison that shows exactly what the carrier omitted, and the building-code citations that justify each missing item.",
            "The deliverable is aimed at an adjuster, not a homeowner. Its job is to make a denial or underpayment indefensible by documenting it — drip edge required by code, ice and water shield in the valleys, step flashing that can't be reused, overhead and profit owed when three trades are involved.",
          ],
        },
        {
          id: "overlap",
          heading: "Where They Overlap — and Where They Don't",
          paragraphs: [
            "The honest overlap is the word 'estimate.' Both tools produce estimates, and both use roof measurements. But the estimates serve opposite audiences. Roofr's estimate is a sales artifact; DumbRoof's estimate is a supplement artifact built to map against a carrier scope.",
            "Because of that, the two are more often complementary than competitive. A roofing company can use a sales/measurement platform to win the job and collect clean measurements, then feed those measurements into DumbRoof to build the insurance supplement when the carrier underpays. Using one does not preclude the other.",
          ],
        },
      ]}
      chooseDumbroof={[
        "Your bottleneck is recovering underpaid insurance money, not closing sales.",
        "You need a forensic causation report and a carrier scope comparison.",
        "You want Xactimate-style supplement estimates with code citations.",
        "Your documents need to convince an adjuster, not a homeowner.",
      ]}
      chooseOther={{
        heading: "Choose Roofr when…",
        items: [
          "Your priority is fast measurements, sales estimates, and homeowner proposals.",
          "You want a polished, branded customer-facing sales workflow.",
          "You're optimizing the front of the job: inspection to signed contract.",
          "You don't currently need carrier-facing supplement documentation.",
        ],
      }}
      togetherNote="A sales platform and a supplement tool aren't rivals. Use Roofr (or any measurement/proposal tool) to win the job and collect measurements, then use DumbRoof to build the insurance supplement when the carrier's estimate falls short."
      bottomLine={[
        "Choose Roofr if your need is the sales workflow — measurements, estimates, and proposals that close jobs.",
        "Choose DumbRoof if your need is the insurance claim — forensic documentation, Xactimate-style estimates, and scope comparisons that recover underpaid money. They sit on opposite ends of the same job, so for many roofers the answer is 'both, for different reasons.'",
      ]}
      faqs={[
        {
          question: "Is Roofr the same as DumbRoof?",
          answer:
            "No. Roofr is a roofing sales platform focused on measurements, instant estimates, and homeowner proposals. DumbRoof is insurance-supplement software focused on forensic causation reports, Xactimate-style estimates, scope comparisons against the carrier's estimate, and code citations. They serve different parts of the job — sales versus claims.",
        },
        {
          question: "Can I use Roofr and DumbRoof together?",
          answer:
            "Yes, and many roofers do. A sales/measurement platform like Roofr handles the front of the job and produces clean measurements; DumbRoof uses those measurements plus the carrier's estimate to build the insurance supplement. One sells the job, the other recovers underpaid claim money.",
        },
        {
          question: "Does Roofr build insurance supplements?",
          answer:
            "Roofr is built for the sales side — measurements, estimates, and proposals aimed at homeowners. Building a carrier-ready supplement (forensic causation, a line-by-line scope comparison against the carrier's estimate, and code citations) is DumbRoof's specific purpose. For that job, DumbRoof is the tool designed for it.",
        },
        {
          question: "Which is better for an underpaid insurance claim?",
          answer:
            "For recovering an underpaid insurance claim, DumbRoof is built specifically for that outcome — it documents what the carrier's estimate missed and justifies each item. A sales platform optimizes a different goal (winning the job), so on the claim side DumbRoof is the better fit.",
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
          href: "/learn/what-is-a-roofing-supplement",
          label: "What Is a Roofing Supplement?",
          kicker: "Insurance Claims",
        },
        {
          href: "/learn/insurance-didnt-pay-enough-for-roof",
          label: "Insurance Didn't Pay Enough to Replace My Roof",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Win the Job, Then Recover the Claim"
      ctaBody="When the carrier's estimate comes in low, upload it with your photos and measurements. DumbRoof builds the forensic supplement that recovers the difference."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

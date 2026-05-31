import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-diy-roof-claim-supplement";
const TITLE =
  "DumbRoof vs DIY Roof Claim Supplement: Build It Yourself or Automate It? (2026)";
const DESCRIPTION =
  "Building a roof supplement by hand means spreadsheets, Word letters, manual code lookups, and hours per claim. DumbRoof AI-generates a forensic causation report, Xactimate-style estimate, scope comparison, and code citations in minutes. Compare effort, accuracy, and cost.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DIY roof claim supplement",
    "how to write a roof supplement",
    "roof supplement software",
    "supplement roof insurance claim yourself",
    "Xactimate alternative roofing",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs DIY Supplement"
      path={PATH}
      eyebrow="Approaches"
      h1="DumbRoof vs Building a Roof Supplement Yourself"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="A DIY roof supplement means assembling everything by hand — measuring squares, building line items in a spreadsheet, looking up code sections, writing a cover letter, and organizing photos. DumbRoof automates all of that into a forensic package in minutes."
      directAnswerBody="The DIY route is free in dollars but expensive in hours, and it is easy to leave money on the table by forgetting line items like drip edge, starter strip, ice and water shield, step flashing, or overhead and profit. DumbRoof cross-references the carrier's estimate against a complete scope, so the items most commonly omitted get caught automatically — with the code citation that justifies each one. The honest trade-off: DIY costs only your time and gives total control; DumbRoof costs a subscription and gives speed, consistency, and fewer missed items."
      otherLabel="DIY (Manual)"
      tableCaption="DumbRoof vs DIY Supplement at a Glance"
      tableRows={[
        {
          feature: "Time per claim",
          dumbroof:
            "Minutes once inputs are uploaded — the report, estimate, and comparison generate together.",
          other:
            "Often 2-4 hours: measuring, building line items, code lookups, writing the letter, organizing photos.",
        },
        {
          feature: "Line-item completeness",
          dumbroof:
            "Compares the carrier scope against a complete scope and flags commonly omitted items automatically.",
          other:
            "Depends entirely on the writer's memory and experience; easy to forget drip edge, starter, I&W, O&P.",
        },
        {
          feature: "Code citations",
          dumbroof:
            "Auto-attaches the relevant IRC / local code sections to code-required items.",
          other:
            "Manual research per item — accurate only if you look up the current adopted code.",
        },
        {
          feature: "Forensic causation report",
          dumbroof:
            "Generated automatically, tying observed damage to a documented weather event.",
          other:
            "Rarely produced DIY — it's the hardest piece to write well by hand.",
        },
        {
          feature: "Consistency across claims",
          dumbroof:
            "Every claim follows the same forensic structure and quality bar.",
          other:
            "Varies claim to claim and person to person.",
        },
        {
          feature: "Cost",
          dumbroof:
            "Flat subscription (free to start; published plans).",
          other:
            "No software cost — you pay in time, and in missed scope.",
        },
      ]}
      sections={[
        {
          id: "what-diy-takes",
          heading: "What Building a Supplement by Hand Actually Takes",
          paragraphs: [
            "A real roof supplement is more than a request for more money — it is a documented case. To build one by hand you need to: confirm the roof measurements (squares, eaves, valleys, rakes), build a complete line-item estimate at correct unit prices, compare it line-by-line against the carrier's estimate to find every gap, research which missing items current building code requires, write a professional cover letter or scope clarification, and organize photo evidence so each item is provable.",
            "Each of those steps is doable by an experienced estimator. Together, they routinely run two to four hours per claim. For a contractor handling several claims a week, that is most of a workday spent formatting documents instead of selling and building roofs.",
            "The bigger risk isn't time — it's omission. The line items carriers most often leave off (drip edge, starter strip, ice and water shield, pipe boots, step flashing, ridge cap, underlayment upgrades, and overhead and profit) are exactly the ones a busy person forgets to add back when working from memory.",
          ],
        },
        {
          id: "how-dumbroof-differs",
          heading: "How DumbRoof Changes the Workflow",
          paragraphs: [
            "DumbRoof inverts the process. Instead of building the supplement from a blank page, you upload the inputs — inspection photos, roof measurements, and the carrier's estimate — and the AI produces the deliverables. It generates a forensic causation report, an Xactimate-style line-item estimate, a scope comparison that surfaces every gap against the carrier scope, and the building-code citations that back the code-required items.",
            "Because the comparison runs against a complete scope rather than your memory, the commonly omitted items get flagged systematically. And because the output is structured and repeatable, every claim meets the same quality bar — the tenth supplement of the week looks as thorough as the first.",
            "You still review and own the result. DumbRoof does the heavy assembly; you make the judgment calls and decide what to submit.",
          ],
        },
        {
          id: "when-diy-still-wins",
          heading: "When DIY Still Makes Sense",
          paragraphs: [
            "DIY is genuinely the right answer in some cases. If you do one supplement a year, the time cost is trivial and there's no reason to subscribe to software. If you have an in-house Xactimate expert who already produces flawless scopes quickly, the marginal gain from automation is smaller. And if a claim is unusual enough that no template fits, hand-crafting it gives you total control over every line.",
            "The case for DumbRoof grows with volume and with how much money routine omissions are costing you. The more claims you run, the more the per-claim time savings and the caught-omissions compound.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You run claims regularly and the per-claim hours add up.",
        "You keep losing money to forgotten line items (drip edge, starter, I&W, O&P).",
        "You want a forensic causation report you'd never have time to write by hand.",
        "You need consistent, code-cited documentation on every file.",
      ]}
      chooseOther={{
        heading: "Stick with DIY when…",
        items: [
          "You only file a supplement once in a while.",
          "You already have an in-house Xactimate expert producing flawless scopes fast.",
          "A claim is unusual enough that no standard structure fits.",
          "You want zero software cost and accept the time and omission trade-offs.",
        ],
      }}
      togetherNote="Even DIY estimators can use DumbRoof as a completeness check — generate the scope comparison, see which items the carrier left off, then decide what to include. It catches the omissions a tired human misses at 9pm on the fifth claim of the day."
      bottomLine={[
        "If you file supplements occasionally and have the skills, DIY is free and fully under your control — there's no shame in a clean hand-built scope.",
        "If you file regularly, or you keep discovering money you forgot to claim, DumbRoof pays for itself in recovered hours and recovered line items. The forensic causation report alone is something most contractors never produce by hand simply because it takes too long — and it's often the difference between a carrier reopening a file and ignoring it.",
      ]}
      faqs={[
        {
          question: "Can I write a roof insurance supplement myself?",
          answer:
            "Yes. A DIY supplement requires confirming roof measurements, building a complete line-item estimate, comparing it against the carrier's estimate to find gaps, researching code requirements, writing a cover letter, and organizing photo evidence. It typically takes two to four hours per claim and depends heavily on the writer's experience to avoid omitting common line items.",
        },
        {
          question: "What gets missed most often in a DIY supplement?",
          answer:
            "The items carriers most frequently leave off — and that DIY writers most often forget to add back — are drip edge, starter strip, ice and water shield, pipe boots, step flashing, ridge cap, underlayment upgrades, and overhead and profit (O&P). DumbRoof's scope comparison flags these automatically by checking the carrier estimate against a complete scope.",
        },
        {
          question: "Does DumbRoof require an Xactimate license?",
          answer:
            "No. DumbRoof produces an Xactimate-style line-item estimate without you needing an Xactimate license. Xactimate is the estimating standard carriers use, and DumbRoof's output is formatted to be recognizable and submittable in that context.",
        },
        {
          question: "Is DIY cheaper than DumbRoof?",
          answer:
            "DIY has no software cost, but you pay in time (often hours per claim) and in scope you forget to include. DumbRoof is a flat subscription. For occasional filers DIY usually wins on raw cost; for regular filers the time saved and the line items recovered typically outweigh the subscription.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/best-xactimate-alternative-for-roofers",
          label: "Best Xactimate Alternative for Roofers",
          kicker: "Best Xactimate Alternative",
        },
        {
          href: "/compare/dumbroof-vs-hiring-a-public-adjuster",
          label: "DumbRoof vs Hiring a Public Adjuster",
          kicker: "vs Public Adjuster",
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
      ctaHeading="Stop Building Supplements From a Blank Page"
      ctaBody="Upload your inputs and let DumbRoof assemble the forensic report, Xactimate-style estimate, scope comparison, and code citations — then review and submit."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

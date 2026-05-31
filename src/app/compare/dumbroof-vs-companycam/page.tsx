import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";
import { absoluteUrl } from "@/lib/seo/site";

const PATH = "/compare/dumbroof-vs-companycam";
const TITLE =
  "DumbRoof vs CompanyCam: Photo Documentation vs Supplement Generation (2026)";
const DESCRIPTION =
  "CompanyCam is a job-site photo-documentation app that captures, tags, and organizes roofing photos. DumbRoof turns those photos plus the carrier scope into a forensic insurance supplement. They're complementary — photos feed into DumbRoof. Honest comparison.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  keywords: [
    "DumbRoof vs CompanyCam",
    "CompanyCam insurance supplement",
    "CompanyCam alternative",
    "roofing photo app vs supplement",
    "CompanyCam roof claim",
  ],
  openGraph: { title: TITLE, description: DESCRIPTION, type: "article" },
};

export default function Page() {
  return (
    <ComparisonPage
      breadcrumbLabel="vs CompanyCam"
      path={PATH}
      eyebrow="Tools"
      h1="DumbRoof vs CompanyCam"
      headline={TITLE}
      description={DESCRIPTION}
      directAnswerLead="CompanyCam is a photo-documentation app, not an estimate or supplement generator. It captures, tags, time-stamps, and organizes job-site photos so your evidence is consistent and searchable. DumbRoof takes that photo evidence, plus the carrier's estimate and measurements, and produces the actual supplement."
      directAnswerBody="This is one of the clearest 'use them together' pairings. CompanyCam solves the input problem — getting clean, organized, geotagged photos off the roof. DumbRoof solves the output problem — turning those photos plus the carrier scope into a forensic causation report, an Xactimate-style estimate, and a scope comparison. Good photos make a stronger supplement, so the two reinforce each other rather than compete."
      otherLabel="CompanyCam"
      tableCaption="DumbRoof vs CompanyCam at a Glance"
      tableRows={[
        {
          feature: "Category",
          dumbroof: "Insurance-supplement generation software.",
          other: "Job-site photo capture, tagging, and documentation app.",
        },
        {
          feature: "Core job",
          dumbroof:
            "Turn photos + carrier scope + measurements into a carrier-ready supplement.",
          other:
            "Capture, time-stamp, geotag, organize, and share job-site photos.",
        },
        {
          feature: "Produces an estimate",
          dumbroof: "Yes — Xactimate-style line-item supplement estimate.",
          other:
            "No — it's a photo app, not an estimate generator.",
        },
        {
          feature: "Forensic causation report",
          dumbroof: "Yes — ties damage to a documented weather event.",
          other:
            "No — it documents photos; it doesn't author causation analysis.",
        },
        {
          feature: "Carrier scope comparison",
          dumbroof: "Yes — line-by-line against the carrier's estimate.",
          other: "No.",
        },
        {
          feature: "Best for",
          dumbroof:
            "Building the supplement from the evidence.",
          other:
            "Capturing and organizing the evidence in the first place.",
        },
      ]}
      sections={[
        {
          id: "what-companycam-is",
          heading: "What CompanyCam Is Built For",
          paragraphs: [
            "CompanyCam is a photo-documentation app for the trades. Every photo is automatically time-stamped and location-tagged, organized by project, and searchable, so the whole team's job-site photos live in one consistent place. You can annotate, add notes, and share galleries. For roofing, that means your damage photos, tear-off photos, and completion photos are captured and organized the moment they're taken.",
            "It's important to be precise about the category: CompanyCam is a photo-documentation app, not an estimate or supplement generator. That's not a knock — it's simply what it is. It makes evidence excellent; it doesn't turn that evidence into a carrier-facing claim document.",
          ],
        },
        {
          id: "what-dumbroof-is",
          heading: "What DumbRoof Does With the Photos",
          paragraphs: [
            "DumbRoof is where photos become a claim. It takes inspection photos — including the kind CompanyCam captures — together with the carrier's estimate and the roof measurements, and produces the supplement: a forensic causation report, an Xactimate-style line-item estimate, a line-by-line scope comparison against the carrier scope, and the building-code citations that justify each missing item.",
            "Photos are evidence; a supplement is the argument that evidence supports. Drip edge in a photo only helps if it lands in a line item with a code citation in a document an adjuster reviews. DumbRoof makes that translation automatically.",
          ],
        },
        {
          id: "together",
          heading: "The Natural Pairing",
          paragraphs: [
            "These two are about as complementary as software gets. Use CompanyCam (or any organized photo workflow) on the roof to capture clean, time-stamped, well-tagged evidence. Then feed those photos into DumbRoof to build the supplement. Better-organized photos make a stronger, faster supplement — the inputs and the outputs are on the same team.",
            "One caution that applies to any photo source: automated photo descriptions and tags can be wrong, so the evidence should always be verified visually before it's relied on in a claim. Good capture plus careful review plus DumbRoof's documentation is the strongest combination.",
          ],
        },
      ]}
      chooseDumbroof={[
        "You already have photos and need to turn them into a supplement.",
        "You want a forensic report, Xactimate-style estimate, and scope comparison.",
        "Your gap is the claim document, not the photo capture.",
        "You want code citations attached to the items your photos prove.",
      ]}
      chooseOther={{
        heading: "Choose CompanyCam when…",
        items: [
          "You need consistent, time-stamped, geotagged job-site photos.",
          "Your team's photos are scattered and you want them organized and searchable.",
          "You want to annotate and share photo galleries across the crew.",
          "Your gap is capturing evidence, not building the claim document.",
        ],
      }}
      togetherNote="Capture organized, time-stamped photos with CompanyCam on the roof, then feed them into DumbRoof to build the supplement. Cleaner photo evidence in means a stronger, faster supplement out. Just verify photo tags and descriptions visually — automated descriptions can be wrong."
      bottomLine={[
        "If your gap is capturing and organizing evidence, CompanyCam is built for exactly that, and DumbRoof doesn't replace it.",
        "If your gap is turning that evidence into a carrier-ready supplement, DumbRoof is the tool — CompanyCam is a photo app, not a supplement generator. The strongest workflow uses both: capture with one, document with the other.",
      ]}
      faqs={[
        {
          question: "Is CompanyCam a supplement tool?",
          answer:
            "No. CompanyCam is a job-site photo-documentation app — it captures, time-stamps, geotags, organizes, and shares photos. It does not generate estimates or insurance supplements. Turning photos plus the carrier's estimate into a forensic supplement is DumbRoof's job.",
        },
        {
          question: "Can I use CompanyCam photos with DumbRoof?",
          answer:
            "Yes — that's the natural pairing. Capture organized, time-stamped photos with CompanyCam on the roof, then feed those photos (with the carrier's estimate and measurements) into DumbRoof to build the supplement. Cleaner photo evidence produces a stronger, faster supplement.",
        },
        {
          question: "Does DumbRoof replace CompanyCam?",
          answer:
            "No. They solve different problems — CompanyCam captures and organizes evidence; DumbRoof turns evidence into a claim document. Many roofers run both: CompanyCam for photo capture and DumbRoof for the supplement.",
        },
        {
          question: "Do photos alone win a supplement?",
          answer:
            "Photos are evidence, but a supplement is the documented argument that evidence supports. A photo of missing drip edge only helps if it becomes a line item with a code citation in a document the adjuster reviews. DumbRoof makes that translation — and you should always verify automated photo tags visually before relying on them.",
        },
      ]}
      relatedComparisons={[
        {
          href: "/compare/dumbroof-vs-eagleview",
          label: "DumbRoof vs EagleView",
          kicker: "vs EagleView",
        },
        {
          href: "/compare/dumbroof-vs-hover",
          label: "DumbRoof vs Hover",
          kicker: "vs Hover",
        },
        {
          href: "/compare/dumbroof-vs-acculynx",
          label: "DumbRoof vs AccuLynx",
          kicker: "vs AccuLynx",
        },
      ]}
      relatedLearn={[
        {
          href: "/learn/what-is-a-roofing-supplement",
          label: "What Is a Roofing Supplement?",
          kicker: "Insurance Claims",
        },
        {
          href: "/learn/adjuster-missed-damage-on-my-roof",
          label: "Adjuster Missed Damage on My Roof",
          kicker: "Insurance Claims",
        },
      ]}
      ctaHeading="Turn Your Photos Into a Supplement"
      ctaBody="You already have the photos. Upload them with the carrier's estimate and your measurements, and DumbRoof builds the forensic report, Xactimate-style estimate, and scope comparison."
      ctaHref="/sample"
      ctaLabel="View a Sample Report"
    />
  );
}

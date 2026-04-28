import type { Metadata } from "next";
import { InstantFunnel } from "@/components/instant-funnel";

// Funnel landing for Meta Ad 1 ("Instant Forensic — A").
// Pattern lifted from Perplexity Computer's roofing-bid funnel: artifact-first
// (upload), email-second (auth wall). Mounted at /instant-forensic so the ad's
// destination URL stays decoupled from /signup and the rest of the marketing
// site — see plan immutable-yawning-snail.md > Isolation Guarantees.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Instant Forensic Report | DumbRoof",
  description:
    "Drop your roof damage photos. Richard scores every slope, identifies the cause, and generates a forensic report you can hand to your insurance company. Free.",
  robots: { index: false, follow: false }, // ad-only landing — keep out of organic SERPs
  openGraph: {
    title: "Turn roof damage photos into a forensic report",
    description:
      "Free forensic causation report in under a minute. Upload photos, get a report you can send to your carrier.",
  },
};

export default function InstantForensicPage() {
  return (
    <InstantFunnel
      funnel="forensic"
      collectsDolStormType
      copy={{
        h1: "Turn roof damage photos into a forensic report",
        sub: "Drop your photos. Richard scores every slope, identifies the cause, and gives you a forensic report you can hand to your insurance company.",
        checkmarks: [
          "Reading EXIF + GPS metadata on each photo",
          "Running Damage Score on every slope",
          "Cross-referencing NOAA hail/wind data for your date of loss",
          "Building your forensic causation report",
        ],
        lockButton: "Unlock your forensic report",
        successHeadline:
          "Your forensic causation report is built and waiting in your dashboard.",
      }}
      inputs={[
        {
          folder: "photos",
          label: "Upload your roof damage photos",
          description:
            "JPG, PNG, HEIC, or a ZIP. Multiple files OK. iPhone uploads keep GPS metadata — best for slope mapping.",
          accept: "image/*,.heic,.heif,.zip",
          multiple: true,
          required: true,
        },
      ]}
    />
  );
}

import type { Metadata } from "next";
import { InstantFunnel } from "@/components/instant-funnel";

// Funnel landing for Meta Ad 2 ("Instant Supplement — A").
// Companion to /instant-forensic — see plan immutable-yawning-snail.md.
// Two drop zones (measurements + carrier scope) feed the full 5-doc Richard
// pipeline: Xactimate-style estimate, scope comparison, code compliance,
// supplement letter draft.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Instant Supplement | DumbRoof",
  description:
    "Drop your EagleView and the carrier's scope. Richard prices every line at your local market, runs the comparison, flags code violations, and unlocks the supplement dashboard. Free.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Turn an underpaid carrier scope into a winning supplement",
    description:
      "Xactimate-style estimate + scope comparison + supplement letter — in 60 seconds.",
  },
};

export default function InstantSupplementPage() {
  return (
    <InstantFunnel
      funnel="supplement"
      copy={{
        h1: "Turn an underpaid carrier scope into a winning supplement",
        sub: "Drop your EagleView and the carrier's scope. Richard builds the Xactimate-style estimate, runs the scope comparison, flags code violations, and unlocks the supplement dashboard.",
        checkmarks: [
          "Reading EagleView measurements + carrier scope line items",
          "Pricing every line at your local Xactimate market",
          "Running scope comparison + flagging code violations",
          "Building your supplement letter and dashboard access",
        ],
        lockButton: "Unlock your supplement dashboard",
        successHeadline:
          "Your Xactimate-style estimate, scope comparison, and supplement draft are ready.",
      }}
      inputs={[
        {
          folder: "measurements",
          label: "Upload your measurements",
          description: "EagleView, HOVER, GAF, or any roof report PDF.",
          accept: "application/pdf,.pdf",
          multiple: false,
          required: true,
        },
        {
          folder: "scope",
          label: "Upload the carrier scope",
          description: "The estimate or scope document the insurance company sent you.",
          accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic",
          multiple: false,
          required: true,
        },
      ]}
    />
  );
}

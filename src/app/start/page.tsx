import type { Metadata } from "next";
import { StartChat } from "@/components/start-chat";

// Anonymous Richard-chat landing — the Meta-ads destination.
// Drops a visitor straight into a Richard conversation: greet → single agentic
// drop box → stage the report anonymously (instant-intake token) → prompt
// account creation. ADDITIVE — the homepage and /fb signup landings are
// untouched. Ad-only, so keep it out of organic SERPs.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your roof claim with Richard | DumbRoof",
  description:
    "Send Richard your roof photos, a measurement report, or your carrier's estimate and he'll start your insurance claim — free.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Start your roof claim — just send Richard what you've got",
    description:
      "Drop a few roof photos, a measurement report, or the carrier's estimate. Richard figures out the rest.",
  },
};

export default function StartPage() {
  return <StartChat />;
}

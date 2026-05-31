import type { Metadata } from "next";
import { PLANS } from "@/lib/stripe-config";
import { JsonLd } from "@/components/json-ld";
import { offerCatalog, breadcrumbList } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site";
import PricingClient from "./pricing-client";

export const metadata: Metadata = {
  title: "Pricing — DumbRoof",
  description:
    "Simple, transparent pricing for roofing contractors. Start free with 3 claims, then scale from $149/mo (Pro) to $799/mo (Enterprise). Every plan includes the full forensic document package.",
  alternates: { canonical: absoluteUrl("/pricing") },
};

// Public monthly prices are shown on the page, so emit an OfferCatalog with one
// Offer per plan (faithful to PLANS in src/lib/stripe-config.ts). The global
// SoftwareApplication entity (with its AggregateOffer) lives in the root layout
// — emitting an OfferCatalog here (instead of a second SoftwareApplication)
// avoids declaring a duplicate product entity on the same page.
const offersSchema = offerCatalog({
  offers: Object.values(PLANS).map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    price: String(plan.price),
    priceCurrency: "USD",
    url: absoluteUrl("/pricing"),
  })),
});

const breadcrumbSchema = breadcrumbList([
  { name: "Home", path: "/" },
  { name: "Pricing", path: "/pricing" },
]);

export default function PricingPage() {
  return (
    <>
      <JsonLd data={offersSchema} />
      <JsonLd data={breadcrumbSchema} />
      <PricingClient />
    </>
  );
}

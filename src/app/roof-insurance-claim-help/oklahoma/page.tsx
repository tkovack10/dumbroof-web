import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocationPage } from "@/components/location-page";
import { getLocation, locationPath } from "@/lib/seo/locations";
import { absoluteUrl, SITE } from "@/lib/seo/site";

const SLUG = "oklahoma";
const location = getLocation(SLUG);

export const metadata: Metadata = location
  ? {
      title: location.title,
      description: location.description,
      alternates: { canonical: absoluteUrl(locationPath(SLUG)) },
      openGraph: {
        title: location.title,
        description: location.description,
        url: absoluteUrl(locationPath(SLUG)),
        siteName: SITE.name,
        type: "article",
      },
    }
  : {};

export default function Page() {
  if (!location) notFound();
  return <LocationPage location={location} />;
}

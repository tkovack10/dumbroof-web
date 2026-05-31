/**
 * Pure schema.org JSON-LD builders. Each returns a plain object ready to be
 * passed to the <JsonLd> component. URLs anchor on the canonical host via the
 * SITE registry so structured data and canonicals always agree.
 *
 * NOTE: We intentionally do NOT emit aggregateRating anywhere — there are no
 * real on-page reviews backing a rating, and a fabricated rating violates
 * Google's structured-data policy and undermines AEO trust.
 */
import { SITE, absoluteUrl } from "./site";

type Json = Record<string, unknown>;

export function organization(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: SITE.logo,
    description: SITE.shortDescription,
    founder: {
      "@type": "Person",
      name: SITE.founder,
      jobTitle: SITE.founderTitle,
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE.address.streetAddress,
      addressLocality: SITE.address.addressLocality,
      addressRegion: SITE.address.addressRegion,
      postalCode: SITE.address.postalCode,
      addressCountry: SITE.address.addressCountry,
    },
    contactPoint: {
      "@type": "ContactPoint",
      email: SITE.email,
      contactType: "sales",
    },
    sameAs: [...SITE.sameAs],
  };
}

export function website(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    description: SITE.longDescription,
    publisher: { "@type": "Organization", name: SITE.publisher },
  };
}

export function softwareApplication(opts?: { offers?: Json }): Json {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE.url,
    description: SITE.shortDescription,
    offers:
      opts?.offers ?? {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free to start",
      },
    creator: { "@type": "Organization", name: SITE.publisher },
  };
}

export function offerCatalog(opts: {
  offers: Json[];
  name?: string;
  path?: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "OfferCatalog",
    name: opts.name ?? `${SITE.name} Plans`,
    url: absoluteUrl(opts.path ?? "/pricing"),
    // Reference the global SoftwareApplication entity by URL instead of
    // re-declaring a second SoftwareApplication node on the pricing page.
    itemOffered: { "@type": "SoftwareApplication", name: SITE.name, url: SITE.url },
    itemListElement: opts.offers,
  };
}

export function breadcrumbList(items: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqPage(qas: { question: string; answer: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qas.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: { "@type": "Answer", text: qa.answer },
    })),
  };
}

export function article(opts: {
  headline: string;
  description: string;
  path: string;
  datePublished?: string;
  dateModified?: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(opts.path) },
    url: absoluteUrl(opts.path),
    author: { "@type": "Organization", name: SITE.name },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      logo: { "@type": "ImageObject", url: SITE.logo },
    },
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
  };
}

export function howTo(opts: {
  name: string;
  description: string;
  steps: { name: string; text: string }[];
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: opts.name,
    description: opts.description,
    step: opts.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
}

export function service(opts: {
  name: string;
  description: string;
  serviceType?: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    description: opts.description,
    ...(opts.serviceType ? { serviceType: opts.serviceType } : {}),
    provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
  };
}

export function webPage(opts: {
  name: string;
  description: string;
  path: string;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: opts.name,
    description: opts.description,
    url: absoluteUrl(opts.path),
  };
}

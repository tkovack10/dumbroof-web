import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const siteUrl = "https://www.dumbroof.ai";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "dumbroof.ai | AI-Powered Insurance Claim Intelligence",
    template: "%s | dumbroof.ai",
  },
  description:
    "The most sophisticated roofing restoration technology ever built. Upload source docs, receive forensic-grade appeal packages in 15 minutes. $1.37M in carrier movement. 10 wins.",
  keywords: [
    "roofing claims",
    "insurance supplement",
    "roofing supplement service",
    "AI roofing estimate",
    "forensic causation report",
    "roof damage insurance",
    "storm damage claim",
    "Xactimate estimate",
    "insurance claim denial",
    "roofing restoration technology",
    "overhead and profit",
    "building code compliance",
  ],
  authors: [{ name: "Dumb Roof Technologies" }],
  creator: "Dumb Roof Technologies",
  publisher: "Dumb Roof Technologies",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "dumbroof.ai",
    title: "dumbroof.ai | AI-Powered Insurance Claim Intelligence",
    description:
      "Upload source docs. Receive 5 forensic-grade appeal documents in 15 minutes. $1.37M in carrier movement across 34 claims.",
    images: [
      {
        url: `${siteUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "dumbroof.ai — Insurance Restoration Intelligence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@DumbRoofAI",
    creator: "@DumbRoofAI",
    title: "dumbroof.ai | AI-Powered Insurance Claim Intelligence",
    description:
      "Upload source docs. Receive 5 forensic-grade appeal documents in 15 minutes.",
    images: [`${siteUrl}/og-image.png`],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Dumb Roof Technologies",
  url: siteUrl,
  logo: `${siteUrl}/icon.svg`,
  founder: {
    "@type": "Person",
    name: "Tom Kovack Jr.",
    jobTitle: "CEO",
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "3070 Bristol Pike, Building 1, Suite 122",
    addressLocality: "Bensalem",
    addressRegion: "PA",
    postalCode: "19020",
    addressCountry: "US",
  },
  sameAs: [
    "https://x.com/DumbRoofAI",
    "https://www.linkedin.com/company/dumbroofai",
    "https://www.instagram.com/dumbroofai",
    "https://www.tiktok.com/@dumbroofai",
    "https://www.youtube.com/@DumbRoofAI",
    "https://www.facebook.com/DumbRoofAI",
  ],
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "dumbroof.ai",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI-powered insurance claim intelligence platform that generates forensic-grade appeal packages from source documents in 15 minutes.",
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "USD",
    lowPrice: "0",
    highPrice: "1499",
    offerCount: "5",
  },
  creator: {
    "@type": "Organization",
    name: "Dumb Roof Technologies",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareJsonLd),
          }}
        />
      </head>
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}

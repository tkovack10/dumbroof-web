import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PLANS } from "@/lib/stripe-config";
import { Providers } from "@/components/providers";
import { GlassBackground } from "@/components/glass-background";
import "./globals.css";

// GA4 measurement ID — set in Vercel env vars after creating a clean property
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
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
    highPrice: String(PLANS.enterprise.price),
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Preconnect to critical third-party origins — saves ~50ms per first request */}
        <link rel="preconnect" href="https://hdiyncxkaadxnhwiyagn.supabase.co" />
        <link rel="dns-prefetch" href="https://hdiyncxkaadxnhwiyagn.supabase.co" />
        <link rel="preconnect" href="https://www.googletagmanager.com" />
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
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=766657346239697&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </head>
      <body className={`${inter.className} antialiased`}>
        <GlassBackground />
        <Providers>
          {children}
        </Providers>
        <Analytics />
        <SpeedInsights />
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}', {
                  page_path: window.location.pathname,
                });
              `}
            </Script>
          </>
        )}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '766657346239697');
            fbq('track', 'PageView');
          `}
        </Script>
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
              var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
              ttq.load('D703AIRC77U33JRDUG8G');
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      </body>
    </html>
  );
}

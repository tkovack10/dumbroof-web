import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dumb Roof Technologies | AI-Powered Insurance Claim Intelligence",
  description:
    "The most sophisticated roofing restoration technology ever built. Upload source docs, receive forensic-grade appeal packages in 15 minutes.",
  keywords: [
    "roofing claims",
    "insurance supplement",
    "Xactimate estimate",
    "roof damage",
    "storm damage",
    "forensic report",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import { ImageResponse } from "next/og";
import { SITE } from "@/lib/seo/site";

// Default Open Graph image (Next 15 file convention). Replaces the dead
// /og-image.png reference so social + AI cards unfurl correctly.
export const alt = "DumbRoof — AI insurance claim supplements for roofers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "linear-gradient(135deg, #06091a 0%, #0a0a1f 55%, #1a0a24 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 108,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {SITE.name}
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 46,
            fontWeight: 500,
            color: "rgba(255,255,255,0.7)",
            maxWidth: 960,
            lineHeight: 1.2,
          }}
        >
          {SITE.tagline}
        </div>
        <div
          style={{
            marginTop: 56,
            fontSize: 28,
            color: "rgba(255,255,255,0.45)",
          }}
        >
          dumbroof.ai
        </div>
      </div>
    ),
    { ...size }
  );
}

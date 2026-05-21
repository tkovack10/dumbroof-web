import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The richard-trainer cron reads backend/richard_prompts/*.md at runtime to
  // avoid re-recommending topics that are already covered. Vercel's serverless
  // build trace doesn't follow filesystem reads to files outside src/, so we
  // explicitly include them in the cron's bundle.
  outputFileTracingIncludes: {
    "/api/cron/richard-trainer": ["./backend/richard_prompts/**/*.md"],
    // TEMP REMOVED 2026-05-21 for diagnosis: trace include for retail
    // templates suspected of poisoning all dynamic function bundles in the
    // dd18a7c build. /api/retail-templates will return empty templates while
    // this is removed (fs.readFileSync can't find the JSON files). If the
    // /  hang clears with this removed, root cause confirmed.
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.dumbroof.ai",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

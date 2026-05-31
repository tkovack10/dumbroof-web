import type { MetadataRoute } from "next";
import { SITE, DISALLOWED_PATHS } from "@/lib/seo/site";

/**
 * Answer-engine-first robots posture.
 *
 * Tiers:
 *  1. `*` and every named answer/search engine get `allow: '/'` PLUS the SAME
 *     disallow list (private/transactional routes). Giving the named bots the
 *     same disallow list as `*` fixes the prior leak, where the named-bot rules
 *     used a bare `allow: '/'` with no disallows — letting GPTBot/etc. crawl
 *     /admin, /dashboard, /api, etc.
 *  2. Pure training-data scrapers are disallowed entirely (owner's choice to
 *     block training crawls).
 *
 * Note: Google-Extended is dual-purpose — it powers both Gemini grounding /
 * AI Overviews AND Google's model training. It is intentionally ALLOWED here
 * so the site surfaces in Gemini and AI Overviews; the training tradeoff is
 * accepted to stay visible in Google's answer surfaces.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [...DISALLOWED_PATHS];

  // Engines that read pages to ANSWER user queries (cite-back / search index).
  // Each carries the same disallow list as `*`.
  const answerEngines = [
    "*",
    "OAI-SearchBot",
    "ChatGPT-User",
    "PerplexityBot",
    "Perplexity-User",
    "ClaudeBot",
    "Claude-User",
    "anthropic-ai",
    "Googlebot",
    "Google-Extended", // dual-purpose (Gemini grounding + training) — kept ALLOWED on purpose
    "Bingbot",
    "Applebot",
    "Applebot-Extended",
    "Amazonbot",
    "DuckDuckBot",
  ];

  // Pure training-data scrapers — blocked entirely.
  const trainingScrapers = [
    "GPTBot",
    "CCBot",
    "Bytespider",
    "Diffbot",
    "Omgilibot",
    "ImagesiftBot",
    "PetalBot",
  ];

  return {
    rules: [
      ...answerEngines.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow,
      })),
      ...trainingScrapers.map((userAgent) => ({
        userAgent,
        disallow: "/",
      })),
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";
import { statSync } from "node:fs";
import path from "node:path";
import { SITE, PUBLIC_ROUTES, absoluteUrl } from "@/lib/seo/site";

const APP_DIR = path.join(process.cwd(), "src", "app");

/**
 * Resolve a public route to its source page file and return its mtime.
 * Falls back to build time if the file can't be stat'd, so a future route
 * layout change can never break the sitemap build.
 */
function lastModified(routePath: string): Date {
  const segment = routePath === "/" ? "" : routePath.replace(/^\//, "");
  const file = path.join(APP_DIR, segment, "page.tsx");
  try {
    return statSync(file).mtime;
  } catch {
    return new Date();
  }
}

// Data-driven from the shared PUBLIC_ROUTES registry (src/lib/seo/site.ts) so
// the sitemap, llms.txt, and canonicals all read ONE source of truth.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: route.path === "/" ? SITE.url : absoluteUrl(route.path),
    lastModified: lastModified(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}

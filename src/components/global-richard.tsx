"use client";

import { useEffect, useState } from "react";
import { RichardLauncher } from "@/components/richard-launcher";

/**
 * Mounts the floating Richard launcher on every authenticated page (wired in
 * src/app/dashboard/layout.tsx). This is the company/portfolio-scope Richard —
 * the per-claim "Ask Richard" tab on the claim page stays as-is, so a claim
 * page intentionally has BOTH (Tom: "I like the Ask Richard tab, but I also
 * want the floating chat on all of the pages — the more Richard the better").
 *
 * Reads ?richard=new from the URL at mount to auto-open (re-engagement CTAs
 * deep-link here), then strips the param so back/refresh doesn't re-trigger.
 * Uses window.location instead of useSearchParams so the server layout needs
 * no Suspense boundary.
 */
export function GlobalRichard({ userId }: { userId: string }) {
  const [initiallyOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("richard") === "new";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("richard") === "new") {
      url.searchParams.delete("richard");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);

  return (
    <RichardLauncher userId={userId} scope="dashboard" initiallyOpen={initiallyOpen} />
  );
}

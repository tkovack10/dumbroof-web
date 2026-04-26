import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { FbLanding } from "@/components/fb-landing";
import { FB_VARIANTS, isValidVariant, type FbVariant } from "@/lib/fb-variants";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Pre-render only the known variants. Anything else returns 404 (rather than
// rendering with the default config and silently masking a bad ad URL).
export function generateStaticParams() {
  return (Object.keys(FB_VARIANTS) as FbVariant[])
    .filter((v) => v !== "default")
    .map((variant) => ({ variant }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ variant: string }>;
}) {
  const { variant } = await params;
  if (!isValidVariant(variant) || variant === "default") {
    return { title: "DumbRoof", robots: { index: false, follow: false } };
  }
  const cfg = FB_VARIANTS[variant];
  return {
    title: cfg.metaTitle,
    description: cfg.metaDescription,
    robots: { index: false, follow: false },
  };
}

function fmtBigMoney(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M+`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K+`;
  return `$${val.toLocaleString()}`;
}

const getStats = unstable_cache(
  async () => {
    try {
      const [webClaims, webWins, localClaims, localWins] = await Promise.all([
        supabaseAdmin.from("claims").select("contractor_rcv"),
        supabaseAdmin.from("claims").select("settlement_amount").eq("claim_outcome", "won"),
        supabaseAdmin.from("claim_outcomes").select("usarm_rcv").eq("source", "cli"),
        supabaseAdmin
          .from("claim_outcomes")
          .select("settlement_amount")
          .eq("source", "cli")
          .eq("win", true),
      ]);
      const rcv =
        (webClaims.data || []).reduce((s, c) => s + (c.contractor_rcv ?? 0), 0) +
        (localClaims.data || []).reduce((s, c) => s + (c.usarm_rcv ?? 0), 0);
      const won =
        (webWins.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0) +
        (localWins.data || []).reduce((s, c) => s + (c.settlement_amount ?? 0), 0);
      return { processed: fmtBigMoney(rcv), approved: fmtBigMoney(won) };
    } catch {
      return { processed: "$6.9M+", approved: "$2.0M+" };
    }
  },
  ["fb-landing-stats"],
  { revalidate: 300, tags: ["hero-stats"] }
);

export default async function FbLandingVariant({
  params,
}: {
  params: Promise<{ variant: string }>;
}) {
  const { variant } = await params;
  if (!isValidVariant(variant) || variant === "default") notFound();

  const stats = await getStats();
  return <FbLanding variant={variant} stats={stats} source={`fb_landing_${variant}`} />;
}

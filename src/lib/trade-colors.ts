/**
 * Trade color system — canonical per Tom 2026-05-18.
 *
 * Every surface that shows a trade (work order, production block, expense
 * category, retail estimate line, claim row) MUST pull its color from here.
 * One source of truth so the eye can pattern-match across screens:
 *
 *   🟥 Roofing — red
 *   🟦 Siding  — blue
 *   🟨 Gutters — yellow
 *   🟧 Misc    — orange
 *
 * Color values are hex (not CSS vars) so they work in inline styles, SVG
 * fills, and email HTML. Each entry also exposes:
 *   - bg: low-opacity background tint for chips/cards
 *   - border: medium-opacity border for outline-only treatments
 *   - label: human display (capitalized)
 *   - emoji: for quick visual mnemonic in toast/email copy
 */

export type TradeKey =
  | "roofing"
  | "siding"
  | "gutters"
  | "downspouts"
  | "flashing"
  | "skylights"
  | "misc";

interface TradeColor {
  key: TradeKey;
  label: string;
  color: string; // primary hex
  bg: string; // 14%-opacity overlay for chip backgrounds
  border: string; // 45%-opacity overlay for borders
  emoji: string;
}

export const TRADE_COLORS: Record<TradeKey, TradeColor> = {
  roofing: {
    key: "roofing",
    label: "Roofing",
    color: "#EF4444", // red-500
    bg: "rgba(239, 68, 68, 0.14)",
    border: "rgba(239, 68, 68, 0.45)",
    emoji: "🟥",
  },
  siding: {
    key: "siding",
    label: "Siding",
    color: "#3B82F6", // blue-500
    bg: "rgba(59, 130, 246, 0.14)",
    border: "rgba(59, 130, 246, 0.45)",
    emoji: "🟦",
  },
  gutters: {
    key: "gutters",
    label: "Gutters",
    color: "#FACC15", // yellow-400
    bg: "rgba(250, 204, 21, 0.14)",
    border: "rgba(250, 204, 21, 0.45)",
    emoji: "🟨",
  },
  downspouts: {
    // Lives with gutters in the user mental model — same yellow but lighter
    key: "downspouts",
    label: "Downspouts",
    color: "#FCD34D", // yellow-300 (slightly lighter than gutters)
    bg: "rgba(252, 211, 77, 0.14)",
    border: "rgba(252, 211, 77, 0.45)",
    emoji: "🟨",
  },
  flashing: {
    // Lives with roofing in the trade — same red family but slightly muted
    key: "flashing",
    label: "Flashing",
    color: "#F87171", // red-400 (slightly lighter than roofing)
    bg: "rgba(248, 113, 113, 0.14)",
    border: "rgba(248, 113, 113, 0.45)",
    emoji: "🟥",
  },
  skylights: {
    // Roof-adjacent but visually distinct — keep in the red family at a darker shade
    key: "skylights",
    label: "Skylights",
    color: "#DC2626", // red-600 (darker than roofing)
    bg: "rgba(220, 38, 38, 0.14)",
    border: "rgba(220, 38, 38, 0.45)",
    emoji: "🟥",
  },
  misc: {
    key: "misc",
    label: "Misc",
    color: "#F97316", // orange-500
    bg: "rgba(249, 115, 22, 0.14)",
    border: "rgba(249, 115, 22, 0.45)",
    emoji: "🟧",
  },
};

/**
 * Normalize free-form trade strings ("Roof", "ROOFING", "gutters & downspouts")
 * to a canonical TradeKey. Falls back to "misc" for anything unmatched.
 */
export function tradeKey(input: string | null | undefined): TradeKey {
  const raw = (input || "").trim().toLowerCase();
  if (!raw) return "misc";
  if (raw === "roof" || raw.startsWith("roofing")) return "roofing";
  if (raw === "siding" || raw.includes("siding")) return "siding";
  if (raw === "gutter" || raw.startsWith("gutter")) return "gutters";
  if (raw === "downspout" || raw.startsWith("downspout")) return "downspouts";
  if (raw === "flashing") return "flashing";
  if (raw === "skylight" || raw.startsWith("skylight")) return "skylights";
  return "misc";
}

/**
 * Convenience accessor: get the full color spec from any input string.
 *   tradeColor("ROOFING") → { color: "#EF4444", bg, border, emoji, label }
 */
export function tradeColor(input: string | null | undefined): TradeColor {
  return TRADE_COLORS[tradeKey(input)];
}

/**
 * Map a job_expenses.type value to the matching trade color so the Job P&L
 * breakdown matches the production board / work order.
 *
 *   material      → roofing (red)    — primary trade cost
 *   labor         → siding (blue)    — secondary
 *   dumpster      → gutters (yellow) — tertiary
 *   subcontractor → misc (orange)
 *   permit/rental → misc (orange)
 *
 * NOTE: This is a UI convention, not a hard trade mapping — an expense of
 * type "material" might really be siding material. But the buckets are
 * about expense-class, and rotating through R/B/Y/O makes the
 * <JobPnlCard> breakdown bars visually distinct at a glance.
 */
const EXPENSE_TYPE_TO_TRADE: Record<string, TradeKey> = {
  material: "roofing",
  labor: "siding",
  dumpster: "gutters",
  subcontractor: "misc",
  permit: "misc",
  rental: "misc",
  misc: "misc",
};

export function expenseTypeColor(type: string | null | undefined): TradeColor {
  const key = EXPENSE_TYPE_TO_TRADE[(type || "").toLowerCase()] ?? "misc";
  return TRADE_COLORS[key];
}

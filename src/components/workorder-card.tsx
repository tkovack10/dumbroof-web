"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tradeColor, tradeKey } from "@/lib/trade-colors";

interface LineItem {
  trade?: string | null;
  category?: string | null;
  usarm_desc?: string | null;
  checklist_desc?: string | null;
  ev_qty?: number | null;
  ev_unit?: string | null;
  usarm_amount?: number | null;
}

interface TradeRoll {
  trade: string;
  qty: number;
  unit: string;
  items: number;
  amount: number;
}

// Sort order: roofing → siding → gutters → downspouts → flashing → skylights → misc
const TRADE_ORDER = ["roofing", "siding", "gutters", "downspouts", "flashing", "skylights", "misc"];

function normalizeTrade(t: string | null | undefined): string {
  return tradeKey(t);
}

function fmtNum(n: number): string {
  if (n === Math.floor(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * What's in this claim's scope, rolled up by trade.
 * Reuses the existing `line_items` jsonb column on claims.
 */
export function WorkorderCard({ claimId }: { claimId: string }) {
  const [rolls, setRolls] = useState<TradeRoll[] | null>(null);
  const [miscItems, setMiscItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("claims")
        .select("line_items, financials")
        .eq("id", claimId)
        .maybeSingle();

      if (cancelled) return;

      const items = ((data?.line_items as LineItem[]) || []).filter(Boolean);
      const grouped = new Map<string, TradeRoll>();
      const misc: LineItem[] = [];

      for (const li of items) {
        const trade = normalizeTrade(li.trade);
        const qty = typeof li.ev_qty === "number" ? li.ev_qty : 0;
        const unit = li.ev_unit ?? "";
        const amt = typeof li.usarm_amount === "number" ? li.usarm_amount : 0;

        if (trade === "misc") {
          misc.push(li);
        }

        // Roll up. Prefer the dominant unit per trade; here we just take
        // the first one we see — line items for the same trade should agree.
        const existing = grouped.get(trade);
        if (!existing) {
          grouped.set(trade, {
            trade,
            qty,
            unit,
            items: 1,
            amount: amt,
          });
        } else {
          // Only sum qty when units match
          existing.qty += unit === existing.unit ? qty : 0;
          existing.items += 1;
          existing.amount += amt;
        }
      }

      const sorted = Array.from(grouped.values()).sort(
        (a, b) =>
          TRADE_ORDER.indexOf(a.trade) - TRADE_ORDER.indexOf(b.trade)
      );

      setRolls(sorted);
      setMiscItems(misc);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [claimId]);

  if (loading || !rolls) {
    return (
      <div className="glass-card p-4 animate-shimmer h-32" />
    );
  }

  if (rolls.length === 0) {
    return (
      <div className="glass-card p-4">
        <p className="text-sm text-[var(--gray-muted)]">
          No scope items on this claim yet.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">What's in scope</h3>
        <span className="text-xs text-[var(--gray-dim)]">
          From EagleView line items
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {rolls
          .filter((r) => r.trade !== "misc")
          .map((r) => {
            const tc = tradeColor(r.trade);
            return (
              <div
                key={r.trade}
                className="p-3 rounded-xl border bg-white/[0.02]"
                style={{ borderColor: tc.border }}
              >
                <p
                  className="text-xs uppercase tracking-wide font-bold"
                  style={{ color: tc.color }}
                >
                  {tc.label}
                </p>
                <p className="font-mono text-xl font-bold text-white mt-1">
                  {fmtNum(r.qty)}{" "}
                  <span className="text-xs text-[var(--gray-muted)] font-normal uppercase">
                    {r.unit || "—"}
                  </span>
                </p>
                <p className="text-[10px] text-[var(--gray-dim)] mt-1">
                  {r.items} line {r.items === 1 ? "item" : "items"} · {fmtMoney(r.amount)}
                </p>
              </div>
            );
          })}
      </div>

      {miscItems.length > 0 && (
        <div className="pt-3 border-t border-[var(--border-glass)]">
          <p className="text-xs uppercase tracking-wide text-[var(--gray-muted)] font-bold mb-2">
            Miscellaneous work
          </p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {miscItems.map((li, i) => (
              <li key={i} className="text-xs text-[var(--gray)] flex items-baseline gap-2">
                <span className="text-[var(--gray-dim)]">·</span>
                <span className="truncate flex-1">
                  {li.usarm_desc || li.checklist_desc || "Untitled item"}
                </span>
                {typeof li.ev_qty === "number" && li.ev_qty > 0 && (
                  <span className="font-mono text-[var(--gray-muted)] text-[10px]">
                    {fmtNum(li.ev_qty)} {li.ev_unit ?? ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

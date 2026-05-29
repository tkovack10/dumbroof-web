import { NextRequest, NextResponse } from "next/server";

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Validate a Stripe coupon for display purposes (e.g. the pricing page reflects
 * the FIRSTCLAIM50 discount the claim-page CTA promises). Read-only: this only
 * retrieves the coupon, it never creates or modifies one. Returns the safe
 * discount fields so the client can show a struck-through price.
 *
 * If the coupon is missing/invalid (e.g. created in test mode only, so it 404s
 * against a live key), we return { valid: false } rather than an error — the
 * page then shows full price with no false discount claim, and the existing
 * checkout flow degrades gracefully via the create-checkout fallback.
 */
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("coupon") || "").trim();
  if (!code) {
    return NextResponse.json({ valid: false });
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.error("[validate-coupon] STRIPE_SECRET_KEY not set");
    return NextResponse.json({ valid: false });
  }

  try {
    const res = await fetch(`${STRIPE_API}/coupons/${encodeURIComponent(code)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();

    // Non-2xx (404 missing coupon, 401 key issue, etc.) → treat as no discount.
    if (!res.ok) {
      console.warn(
        `[validate-coupon] coupon "${code}" not retrievable:`,
        data?.error?.message || res.status
      );
      return NextResponse.json({ valid: false });
    }

    // Stripe marks expired / fully-redeemed coupons as valid:false.
    if (!data?.valid) {
      return NextResponse.json({ valid: false });
    }

    return NextResponse.json({
      valid: true,
      id: data.id as string,
      percentOff: (data.percent_off ?? null) as number | null,
      amountOff: (data.amount_off ?? null) as number | null, // in cents
      currency: (data.currency ?? null) as string | null,
      duration: (data.duration ?? null) as string | null, // "once" | "repeating" | "forever"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[validate-coupon] lookup failed for "${code}":`, message);
    return NextResponse.json({ valid: false });
  }
}

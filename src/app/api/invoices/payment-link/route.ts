import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError, canAccessClaim } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";

/**
 * POST — Create a Stripe Payment Link for an invoice.
 * The link can be embedded in the invoice email so homeowners can pay online.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;

  const body = await req.json();
  const { invoice_id } = body;

  if (!invoice_id) {
    return NextResponse.json({ error: "invoice_id required" }, { status: 400 });
  }

  // Get the invoice
  const { data: invoiceRows } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", invoice_id)
    .limit(1);

  const invoice = invoiceRows?.[0] || null;
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const authorized = await canAccessClaim(userId, invoice.claim_id);
  if (!authorized) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (invoice.amount_due <= 0) {
    return NextResponse.json({ error: "No amount due" }, { status: 400 });
  }

  try {
    const stripe = getStripe();

    // Get claim address + user_id for the description and Connect account lookup
    const { data: claimRows } = await supabaseAdmin
      .from("claims")
      .select("address, user_id")
      .eq("id", invoice.claim_id)
      .limit(1);

    const address = claimRows?.[0]?.address || "Property";
    const claimUserId = claimRows?.[0]?.user_id;

    // Check if the user has a connected Stripe account (for direct payouts)
    let connectedAccountId: string | null = null;
    if (claimUserId) {
      const { data: profile } = await supabaseAdmin
        .from("company_profiles")
        .select("stripe_connect_account_id, stripe_connect_status")
        .eq("user_id", claimUserId)
        .limit(1)
        .single();
      if (profile?.stripe_connect_status === "active" && profile?.stripe_connect_account_id) {
        connectedAccountId = profile.stripe_connect_account_id;
      }
    }

    // Create a Stripe Payment Link via a Price (one-time)
    // If user has a connected account, create the price ON their account
    const stripeOpts = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

    const price = await stripe.prices.create({
      unit_amount: Math.round(invoice.amount_due * 100), // cents
      currency: "usd",
      product_data: {
        name: `Invoice ${invoice.invoice_number} — ${address}`,
      },
    }, stripeOpts);

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_id: invoice.id,
        claim_id: invoice.claim_id,
        invoice_number: invoice.invoice_number,
        ...(connectedAccountId ? { connected_account: connectedAccountId } : {}),
      },
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.dumbroof.ai"}/dashboard/claim/${invoice.claim_id}?paid=true`,
        },
      },
    }, stripeOpts);

    // Save payment link to invoice
    await supabaseAdmin
      .from("invoices")
      .update({ payment_link: paymentLink.url })
      .eq("id", invoice_id);

    return NextResponse.json({
      ok: true,
      payment_link: paymentLink.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create payment link";
    console.error("Stripe payment link error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

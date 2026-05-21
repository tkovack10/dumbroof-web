import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/retail-estimates/[id]/stripe-invoice
 *
 * Creates a Stripe invoice on the CONTRACTOR'S Stripe Connect account for
 * the saved estimate total. Stripe automatically emails the customer a
 * hosted invoice URL where they can pay via card / ACH.
 *
 * Requires:
 *   - company_profiles.stripe_connect_account_id (contractor onboarded
 *     to Stripe Connect via the platform)
 *   - estimate.customer_email
 *
 * Returns the hosted_invoice_url + records stripe_invoice_id and
 * status='invoiced' on the estimate.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  const [{ data: est }, { data: profile }] = await Promise.all([
    supabaseAdmin.from("retail_estimates").select("*").eq("id", id).eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("company_profiles")
      .select("stripe_connect_account_id, stripe_connect_status, company_name")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!est) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  if (!est.customer_email) {
    return NextResponse.json({ error: "Customer email required to invoice" }, { status: 400 });
  }

  const connectId = profile?.stripe_connect_account_id as string | null | undefined;
  if (!connectId) {
    return NextResponse.json(
      {
        error: "Stripe not connected. Visit /dashboard/settings → Payments to connect your Stripe account.",
        needs_stripe_onboarding: true,
      },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const stripeAccount = { stripeAccount: connectId };

  try {
    // Step 1 — find or create the customer on the contractor's Connect account
    const list = await stripe.customers.list({ email: est.customer_email as string, limit: 1 }, stripeAccount);
    let customerId: string;
    if (list.data.length > 0) {
      customerId = list.data[0].id;
    } else {
      const c = await stripe.customers.create(
        {
          email: est.customer_email as string,
          name: (est.customer_name as string) || undefined,
          address: est.customer_address
            ? { line1: est.customer_address as string }
            : undefined,
          metadata: { dumbroof_estimate_id: id },
        },
        stripeAccount,
      );
      customerId = c.id;
    }

    // Step 2 — total in cents
    const cents = Math.round(Number(est.total_amount) * 100);
    if (cents <= 0) return NextResponse.json({ error: "Estimate total must be > 0" }, { status: 400 });

    const meta = (est.template_snapshot as { _meta?: { manufacturer?: string; product_line?: string } } | null)?._meta;
    const productLabel = meta ? `${meta.manufacturer} ${meta.product_line}` : "Roof installation";

    // Step 3 — create invoice (auto_advance: false so we attach items first, then finalize)
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        collection_method: "send_invoice",
        days_until_due: 14,
        auto_advance: false,
        description: `${productLabel} — ${est.customer_address || "Roof installation"}`,
        metadata: {
          dumbroof_estimate_id: id,
          dumbroof_user_id: userId,
        },
      },
      stripeAccount,
    );

    // Step 4 — invoice item (one line for the all-in total — matches how
    // the customer-facing estimate displays the bundle)
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: invoice.id,
        amount: cents,
        currency: "usd",
        description: `${productLabel} — complete system, all-inclusive (per estimate)`,
      },
      stripeAccount,
    );

    // Step 5 — finalize + send
    if (!invoice.id) {
      return NextResponse.json({ error: "Stripe did not return an invoice ID" }, { status: 502 });
    }
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {}, stripeAccount);
    if (finalized.id) {
      await stripe.invoices.sendInvoice(finalized.id, {}, stripeAccount);
    }

    // Step 6 — record on the estimate
    await supabaseAdmin
      .from("retail_estimates")
      .update({
        stripe_invoice_id: finalized.id,
        stripe_invoice_url: finalized.hosted_invoice_url,
        stripe_invoice_status: finalized.status,
        status: "invoiced",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json({
      ok: true,
      invoice_id: finalized.id,
      hosted_invoice_url: finalized.hosted_invoice_url,
      stripe_invoice_status: finalized.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-invoice] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

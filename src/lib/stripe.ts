import Stripe from "stripe";

// Use function getter to avoid module-level init (E082 pattern)
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      httpClient: Stripe.createNodeHttpClient(),
      maxNetworkRetries: 3,
      timeout: 30000,
    });
  }
  return _stripe;
}

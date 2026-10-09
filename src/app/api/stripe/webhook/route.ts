import type Stripe from 'stripe';
import { handleStripeEvent, stripe, stripeEnabled } from '@/lib/stripe';

// Stripe calls this when a payment, invoice or subscription changes. It is the source of truth for what
// was paid: customers don't always return to the site after paying, and renewals happen with nobody there.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeEnabled() || !secret) return new Response('Stripe webhook is not configured', { status: 503 });

  // Signature verification needs the exact bytes Stripe sent, so read the raw body — never parsed JSON.
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get('stripe-signature') ?? '', secret);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  await handleStripeEvent(event); // a thrown error returns 500, and Stripe retries
  return Response.json({ received: true });
}

// Forwards Stripe webhook events to the local dev server:  pnpm stripe:listen
// Prints a signing secret (whsec_…) on start — put it in .env.local as STRIPE_WEBHOOK_SECRET.
import { spawn } from 'node:child_process';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY in .env.local first.');
  process.exit(1);
}
// The events src/lib/stripe.ts handles. Subscribe the production webhook endpoint to the same list.
const EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];
const target = `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3210').replace(/\/$/, '')}/api/stripe/webhook`;
const child = spawn('stripe', ['listen', '--events', EVENTS.join(','), '--forward-to', target, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, STRIPE_API_KEY: key } });
child.on('exit', (code) => process.exit(code ?? 0));

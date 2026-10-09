// Creates the membership Products and Prices in Stripe and reports what card payments still need.
//   pnpm stripe:setup
import { client } from '../src/lib/db';
import { stripe, stripeLive, syncCatalog, taxStatus, webhookReady } from '../src/lib/stripe';

async function main() {
  const account = await stripe().accounts.retrieveCurrent();
  console.log(`Stripe account: ${account.settings?.dashboard?.display_name ?? account.id} (${stripeLive() ? 'LIVE' : 'test mode'})`);
  for (const row of await syncCatalog()) console.log(`  ${row.planId} / ${row.size}: ${row.price}`);
  const tax = await taxStatus();
  console.log(`Webhook secret: ${webhookReady() ? 'set' : 'MISSING — set STRIPE_WEBHOOK_SECRET'}`);
  console.log(
    tax.collecting
      ? `Sales tax: collecting (${tax.registrations} registration(s))`
      : tax.requested
        ? `Sales tax: switched on but NOT collecting (tax settings ${tax.settingsActive ? 'active' : 'pending — no head office address'}, ${tax.registrations} registration(s))`
        : 'Sales tax: off (STRIPE_AUTOMATIC_TAX is not on)',
  );
  client.close();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

import type { Metadata } from 'next';
import { desc, eq, inArray } from 'drizzle-orm';
import { ChargeAdmin } from '@/components/app/ChargeAdmin';
import { PageHead } from '@/components/app/PageHead';
import { requireAdmin } from '@/lib/auth';
import { stripeEnabled, stripeLive, taxStatus, webhookReady } from '@/lib/stripe';
import { syncAllMemberships } from '@/lib/billing';
import { usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { charges, users } from '@/lib/db/schema';
import { nowLocal } from '@/lib/time';

export const metadata: Metadata = { title: 'Payments' };

export default async function AdminPaymentsPage() {
  await requireAdmin();
  await syncAllMemberships();
  const rows = (
    await db
      .select({ c: charges, customerName: users.name })
      .from(charges)
      .innerJoin(users, eq(users.id, charges.userId))
      .where(inArray(charges.status, ['due', 'paid']))
      .orderBy(desc(charges.createdAt))
  ).map((r) => ({ ...r.c, customerName: r.customerName }));

  const due = rows.filter((c) => c.status === 'due');
  const paid = rows.filter((c) => c.status === 'paid').sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  const month = nowLocal().date.slice(0, 7);
  const thisMonth = paid.filter((c) => c.paidAt && nowLocal(new Date(c.paidAt)).date.startsWith(month));
  const refunds = paid.filter((c) => c.kind === 'duplicate');
  // Money collected, including any sales tax; a duplicate is on its way back to the client, so it doesn't count.
  const sum = (list: typeof rows) => list.filter((c) => c.kind !== 'duplicate').reduce((t, c) => t + c.amountCents + (c.status === 'paid' ? c.taxCents : 0), 0);
  const tax = stripeEnabled() ? await taxStatus().catch(() => null) : null;

  return (
    <>
      <PageHead index="PAYMENTS" title="Money in, money owed" />
      <div className="stats">
        <div className="stat">
          <span className="rly-label">Outstanding</span>
          <span className="stat__value">{usd(sum(due))}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Collected this month</span>
          <span className="stat__value">{usd(sum(thisMonth))}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Collected all time</span>
          <span className="stat__value">{usd(sum(paid))}</span>
        </div>
      </div>

      {refunds.length > 0 && (
        <p className="testmode" style={{ marginBottom: 28 }}>
          {refunds.length === 1 ? 'A card payment' : `${refunds.length} card payments`} came in for {refunds.length === 1 ? 'a charge' : 'charges'} that had already been settled another way.
          Refund {refunds.length === 1 ? 'it' : 'them'} in the Stripe dashboard — look for “Duplicate card payment” below.
        </p>
      )}

      <div className="stack g-8">
        <section>
          <div className="card-title">
            <h2 className="h3">Outstanding</h2>
          </div>
          <ChargeAdmin cards={stripeEnabled()} rows={due} who empty="Nobody owes anything right now." />
        </section>
        <section>
          <div className="card-title">
            <h2 className="h3">Recently paid</h2>
          </div>
          <ChargeAdmin cards={stripeEnabled()} rows={paid.slice(0, 50)} who empty="Payments you record will show up here." />
        </section>
      </div>
      <section className="rly-card rly-card--striped stack g-4" style={{ marginTop: 32, paddingTop: 32 }}>
        <h2 className="h3">Card payments</h2>
        {stripeEnabled() ? (
          <div className="facts">
            <div className="fact">
              <span className="rly-label">Stripe</span>
              <span>{stripeLive() ? 'Connected · live' : 'Connected · test mode, no real money moves'}</span>
            </div>
            <div className="fact">
              <span className="rly-label">Webhook</span>
              <span>{webhookReady() ? 'Signing secret set' : 'Not set up — card payments and autopay renewals won’t be recorded until it is'}</span>
            </div>
            <div className="fact">
              <span className="rly-label">Sales tax</span>
              <span>
                {tax?.collecting
                  ? `Collecting in ${tax.registrations} registered ${tax.registrations === 1 ? 'location' : 'locations'}`
                  : tax?.requested
                    ? 'Switched on, but Stripe has no head office address or tax registration yet — nothing is being collected'
                    : 'Not collected'}
              </span>
            </div>
          </div>
        ) : (
          <p className="small muted">Stripe isn’t connected. Add STRIPE_SECRET_KEY to let clients pay by card and put memberships on autopay.</p>
        )}
        <p className="note" style={{ maxWidth: '70ch' }}>
          Zelle, Apple Pay and cash are recorded by hand: mark the charge paid when the money arrives.{' '}
          {stripeEnabled()
            ? 'Card payments record themselves. Clients can pay from their account, or use Create card pay link on a charge and text them the link.'
            : 'You can also paste any invoice link on a charge and the client gets a Pay button in their account.'}
        </p>
      </section>
    </>
  );
}

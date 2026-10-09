import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { payByCard } from '@/app/actions/pay';
import { PageHead } from '@/components/app/PageHead';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { ChargeBadge } from '@/components/ui/badges';
import { requireUser } from '@/lib/auth';
import { loadMemberships } from '@/lib/billing';
import { BUSINESS, methodLabel, usd } from '@/lib/catalog';
import { charges } from '@/lib/db/schema';
import { listCharges } from '@/lib/queries';
import { applySession, stripeEnabled, type SessionOutcome } from '@/lib/stripe';
import { fmtStamp } from '@/lib/time';

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const user = await requireUser('/account/payments');
  const { paid: sessionId } = await searchParams;
  // Back from Stripe Checkout. The webhook is what records the payment; applying it here too (it is safe
  // to do twice) means the customer sees it without waiting. Only their own session is accepted. Then on
  // to a clean address, so refreshing the page doesn't replay the session.
  if (sessionId?.startsWith('cs_')) {
    let result: SessionOutcome = 'none';
    if (stripeEnabled() && user.stripeCustomerId) result = await applySession(sessionId, user.stripeCustomerId).catch(() => 'none' as const);
    redirect(`/account/payments${result === 'paid' || result === 'processing' ? `?paid=${result}` : ''}`);
  }
  const outcome = sessionId === 'paid' || sessionId === 'processing' ? sessionId : 'none';
  const cards = stripeEnabled();
  await loadMemberships(user.id); // brings membership billing up to date
  const all = (await listCharges(eq(charges.userId, user.id))).filter((c) => c.status !== 'void');
  const due = all.filter((c) => c.status === 'due');
  const paid = all.filter((c) => c.status === 'paid').sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
  const total = due.reduce((t, c) => t + c.amountCents, 0);

  return (
    <>
      <PageHead index="PAYMENTS" title="Payments" />
      {outcome === 'paid' && (
        <p className="rly-toast rly-toast--success" role="status" style={{ maxWidth: 'none', marginBottom: 28, boxShadow: 'inset 3px 0 0 #3FBF77' }}>
          <span>
            <span className="rly-toast__title">Payment received.</span> Thanks — it’s in your history below.
          </span>
        </p>
      )}
      {outcome === 'processing' && (
        <p className="testmode" role="status" style={{ marginBottom: 28 }}>
          Your payment is processing. It’ll show as paid here as soon as your bank confirms it.
        </p>
      )}
      <div className="detail-grid">
        <div className="stack g-8">
          <section>
            <div className="card-title">
              <h2 className="h3">Due now</h2>
              <span className="rly-data" style={{ fontSize: 20 }}>
                {usd(total)}
              </span>
            </div>
            <div className="list">
              {due.length === 0 && <p className="list__empty">Nothing owed. You’re all settled.</p>}
              {due.map((c) => (
                <div key={c.id} className="list__item">
                  <div className="list__main">
                    <span className="list__title">{c.description}</span>
                    <span className="list__sub">Billed {fmtStamp(c.createdAt)}</span>
                  </div>
                  <div className="list__end" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <span className="rly-data strong">{usd(c.amountCents)}</span>
                    {c.payLink ? (
                      <a href={c.payLink} target="_blank" rel="noreferrer" className="rly-btn rly-btn--primary rly-btn--sm">
                        Pay by card
                      </a>
                    ) : cards ? (
                      <ActionForm action={payByCard}>
                        <input type="hidden" name="chargeId" value={c.id} />
                        <Submit className="rly-btn rly-btn--primary rly-btn--sm" pending="Opening…">
                          Pay by card
                        </Submit>
                      </ActionForm>
                    ) : (
                      <ChargeBadge status="due" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="card-title">
              <h2 className="h3">History</h2>
            </div>
            {paid.length === 0 ? (
              <div className="list">
                <p className="list__empty">Payments you’ve made will show up here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="rly-table">
                  <thead>
                    <tr>
                      <th>Paid</th>
                      <th>For</th>
                      <th>Method</th>
                      <th className="right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paid.map((c) => (
                      <tr key={c.id}>
                        <td className="num">{fmtStamp(c.paidAt)}</td>
                        <td>{c.kind === 'duplicate' ? `${c.description} — we’ll refund this` : c.description}</td>
                        <td>{methodLabel(c.method)}</td>
                        <td className="num right">{usd(c.amountCents + c.taxCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="rly-card rly-card--striped stack g-5" style={{ paddingTop: 32 }}>
          <h2 className="h3">How to pay</h2>
          <div className="steps">
            <div className="step">
              <span className="rly-index">01</span>
              <div className="step__body">
                <span className="step__title">Zelle or Apple Pay</span>
                <span className="step__text">Send it to the crew when the job’s done. They’ll mark it paid here.</span>
              </div>
            </div>
            <div className="step">
              <span className="rly-index">02</span>
              <div className="step__body">
                <span className="step__title">Card</span>
                <span className="step__text">
                  {cards
                    ? 'Tap Pay by card next to a charge. Checkout is handled by Stripe and takes cards and Apple Pay.'
                    : 'When a charge has a card link, a Pay by card button appears next to it.'}
                </span>
              </div>
            </div>
          </div>
          <p className="small muted">
            You pay after service; larger jobs may need a deposit. Questions about a charge? Call{' '}
            <a href={BUSINESS.phoneHref} className="link rly-data">
              {BUSINESS.phone}
            </a>
            .
          </p>
        </div>
      </div>
    </>
  );
}

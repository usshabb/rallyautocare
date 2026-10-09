import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { cancelMyMembership } from '@/app/actions/account';
import { saveClient, startMembershipNow } from '@/app/actions/admin';
import { BookingList } from '@/components/app/BookingList';
import { ChargeAdmin } from '@/components/app/ChargeAdmin';
import { PageHead } from '@/components/app/PageHead';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { MembershipBadge } from '@/components/ui/badges';
import { ConfirmAction } from '@/components/ui/Dialog';
import { requireAdmin } from '@/lib/auth';
import { stripeEnabled } from '@/lib/stripe';
import { loadMemberships } from '@/lib/billing';
import { findPlan, sizeLabel, usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { bookings, charges, users } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { listBookings, listCharges, listVehicles } from '@/lib/queries';
import { fmtDatePlain, fmtStamp } from '@/lib/time';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [client] = await db.select().from(users).where(eq(users.id, id));
  if (!client) notFound();

  const plans = await loadMemberships(client.id);
  const [vehicles, jobs, money] = await Promise.all([
    listVehicles(client.id),
    listBookings(eq(bookings.userId, client.id), 'desc'),
    listCharges(eq(charges.userId, client.id)),
  ]);
  const open = money.filter((c) => c.status !== 'void');
  const due = open.filter((c) => c.status === 'due').reduce((t, c) => t + c.amountCents, 0);
  const paid = open.filter((c) => c.status === 'paid' && c.kind !== 'duplicate').reduce((t, c) => t + c.amountCents, 0);

  return (
    <>
      <PageHead index="CLIENT" title={client.name || 'No name yet'}>
        <a href={`tel:${client.phone}`} className="rly-btn rly-btn--secondary rly-btn--sm rly-data">
          {formatPhone(client.phone)}
        </a>
        <Link href={`/admin/bookings/new?client=${client.id}`} className="rly-btn rly-btn--primary rly-btn--sm">
          Book for this client
        </Link>
      </PageHead>

      <div className="stats">
        <div className="stat">
          <span className="rly-label">Owes</span>
          <span className="stat__value">{usd(due)}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Paid to date</span>
          <span className="stat__value">{usd(paid)}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Jobs done</span>
          <span className="stat__value">{jobs.filter((b) => b.status === 'completed').length}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Client since</span>
          <span className="stat__value" style={{ fontSize: 20 }}>
            {fmtStamp(client.createdAt)}
          </span>
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack g-8">
          <section>
            <div className="card-title">
              <h2 className="h3">Memberships</h2>
            </div>
            <div className="list">
              {plans.length === 0 && <p className="list__empty">Not a member.</p>}
              {plans.map((m) => (
                <div key={m.id} className="list__item" style={{ flexWrap: 'wrap' }}>
                  <div className="list__main">
                    <span className="list__title">
                      {findPlan(m.planId)?.name} · {usd(m.priceCents)}/mo
                    </span>
                    <span className="list__sub">
                      {vehicles.find((v) => v.id === m.vehicleId)?.label ?? 'Vehicle'} · {m.startedOn ? `since ${fmtDatePlain(m.startedOn)}` : 'not started'}
                    </span>
                  </div>
                  <MembershipBadge status={m.status} />
                  {m.status !== 'cancelled' && (
                    <div className="wrap-row" style={{ flexBasis: '100%' }}>
                      {m.status === 'pending' && (
                        <ActionForm action={startMembershipNow}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <Submit className="rly-btn rly-btn--secondary rly-btn--sm">Start now, skip initial detail</Submit>
                        </ActionForm>
                      )}
                      <ConfirmAction
                        action={cancelMyMembership}
                        fields={{ membershipId: m.id }}
                        label="Cancel membership"
                        className="rly-btn rly-btn--sm btn-danger"
                        title="Cancel this membership?"
                        text="Future billing stops and upcoming visits are cancelled. Charges already issued stay on the account."
                        confirmLabel="Cancel membership"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="card-title">
              <h2 className="h3">Bookings</h2>
            </div>
            <BookingList rows={jobs} admin empty="No bookings yet." />
          </section>

          <section>
            <div className="card-title">
              <h2 className="h3">Charges &amp; payments</h2>
            </div>
            <ChargeAdmin cards={stripeEnabled()} rows={open} empty="Nothing billed yet." />
          </section>
        </div>

        <div className="stack g-6">
          <ActionForm action={saveClient} className="rly-card stack g-4" saved="Saved.">
            <input type="hidden" name="userId" value={client.id} />
            <h2 className="h3">Details</h2>
            <label className="rly-field">
              <span className="rly-field__label">Name</span>
              <input className="rly-input" name="name" defaultValue={client.name} />
            </label>
            <label className="rly-field">
              <span className="rly-field__label">Email</span>
              <input className="rly-input" name="email" type="email" defaultValue={client.email} />
            </label>
            <label className="rly-field">
              <span className="rly-field__label">Usual address</span>
              <input className="rly-input" name="address" defaultValue={client.address} />
            </label>
            <label className="rly-field">
              <span className="rly-field__label">Crew notes · only you see these</span>
              <textarea className="rly-input" name="adminNotes" defaultValue={client.adminNotes} placeholder="Preferences, gate codes, anything worth remembering…" />
            </label>
            <div>
              <Submit className="rly-btn rly-btn--dark rly-btn--sm" pending="Saving…">
                Save
              </Submit>
            </div>
          </ActionForm>

          <div className="rly-card stack g-4">
            <h2 className="h3">Vehicles</h2>
            <div className="facts">
              {vehicles.length === 0 && <span className="small muted">None saved.</span>}
              {vehicles.map((v) => (
                <div key={v.id} className="fact">
                  <span style={{ textAlign: 'left', font: '500 15px/1.35 var(--font-body)' }}>{v.label}</span>
                  <span className="muted">{sizeLabel(v.size)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { completeJob, noShow, requestCharge, saveJobNotes } from '@/app/actions/admin';
import { cancel } from '@/app/actions/booking';
import { ChargeAdmin } from '@/components/app/ChargeAdmin';
import { PageHead } from '@/components/app/PageHead';
import { RescheduleCard } from '@/components/booking/RescheduleCard';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { PayBadge, StatusBadge } from '@/components/ui/badges';
import { ConfirmAction } from '@/components/ui/Dialog';
import { requireAdmin } from '@/lib/auth';
import { stripeEnabled } from '@/lib/stripe';
import { findAddon, priceVisit, sizeLabel, usd } from '@/lib/catalog';
import { formatPhone } from '@/lib/phone';
import { getBooking } from '@/lib/queries';
import { fmtDateLong, fmtRange, fmtStamp, today } from '@/lib/time';

export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const b = await getBooking(id);
  if (!b) notFound();
  const price = priceVisit({ kind: b.kind, serviceId: b.serviceId, size: b.size, addonIds: b.addons });
  const happened = b.date <= today();

  return (
    <>
      <PageHead index={`BOOKING ${b.code}`} title={b.serviceName}>
        <StatusBadge status={b.status} />
        <PayBadge pay={b.pay} status={b.status} />
      </PageHead>

      <div className="detail-grid">
        <div className="stack g-6">
          <div className="rly-card rly-card--striped" style={{ paddingTop: 32 }}>
            <div className="facts">
              <div className="fact">
                <span className="rly-label">Client</span>
                <span>
                  <Link href={`/admin/clients/${b.userId}`} className="link">
                    {b.customerName || 'No name yet'}
                  </Link>
                  <br />
                  <a href={`tel:${b.customerPhone}`} className="rly-data">
                    {formatPhone(b.customerPhone)}
                  </a>
                </span>
              </div>
              <div className="fact">
                <span className="rly-label">When</span>
                <span className="rly-data">
                  <Link href={`/admin?date=${b.date}`} className="link">
                    {fmtDateLong(b.date)}
                  </Link>
                  <br />
                  {fmtRange(b.startMin, b.durationMin)}
                </span>
              </div>
              <div className="fact">
                <span className="rly-label">Where</span>
                <a href={`https://maps.apple.com/?q=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer" className="link">
                  {b.address}
                </a>
              </div>
              <div className="fact">
                <span className="rly-label">Vehicle</span>
                <span>
                  {b.vehicleLabel} · {sizeLabel(b.size)}
                </span>
              </div>
              {b.addons.length > 0 && (
                <div className="fact">
                  <span className="rly-label">Add-ons</span>
                  <span>{b.addons.map((a) => findAddon(a)?.name).filter(Boolean).join(', ')}</span>
                </div>
              )}
              {b.notes && (
                <div className="fact">
                  <span className="rly-label">Client notes</span>
                  <span>{b.notes}</span>
                </div>
              )}
              <div className="fact">
                <span className="rly-label">Booked</span>
                <span>
                  {fmtStamp(b.createdAt)} · by {b.createdBy === 'admin' ? 'the crew' : 'the client'}
                </span>
              </div>
            </div>
          </div>

          {b.status === 'confirmed' && (
            <div className="rly-card stack g-5">
              <h2 className="h3">Close out this job</h2>
              {happened ? (
                <ActionForm action={completeJob} className="inline-form">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <label className="rly-field" style={{ maxWidth: 200 }}>
                    <span className="rly-field__label">Final price</span>
                    <input className="rly-input rly-data" name="final" defaultValue={(b.estimateCents / 100).toFixed(2)} inputMode="decimal" />
                  </label>
                  <Submit className="rly-btn rly-btn--primary" pending="Saving…">
                    Mark complete
                  </Submit>
                </ActionForm>
              ) : (
                <p className="small muted">You can mark this complete on the day of the job.</p>
              )}
              <p className="note">
                Completing bills the client for the final price, less any deposit already requested.
                {b.kind === 'initial' ? ' It also starts their membership and its first month.' : ''}
              </p>
              <div className="wrap-row" style={{ paddingTop: 16, borderTop: '1px solid var(--border-2)' }}>
                <RescheduleCard bookingId={b.id} kind={b.kind} serviceId={b.serviceId} admin />
                {happened && (
                  <ActionForm action={noShow}>
                    <input type="hidden" name="bookingId" value={b.id} />
                    <Submit className="rly-btn rly-btn--secondary rly-btn--sm">No-show</Submit>
                  </ActionForm>
                )}
                <ConfirmAction
                  action={cancel}
                  fields={{ bookingId: b.id }}
                  label="Cancel booking"
                  className="rly-btn rly-btn--sm btn-danger"
                  title="Cancel this booking?"
                  text={`${b.serviceName} for ${b.customerName || formatPhone(b.customerPhone)} on ${fmtDateLong(b.date)}. Any unpaid deposit is voided. The client is not notified automatically.`}
                  confirmLabel="Cancel booking"
                />
              </div>
            </div>
          )}

          <div>
            <div className="card-title">
              <h2 className="h3">Charges</h2>
            </div>
            <ChargeAdmin cards={stripeEnabled()} rows={b.charges} empty={b.status === 'confirmed' ? 'Nothing billed yet. Clients pay after service.' : 'No charges on this booking.'} />
            {b.status !== 'cancelled' && (
              <ActionForm action={requestCharge} className="inline-form" reset>
                <input type="hidden" name="bookingId" value={b.id} />
                <span className="rly-select-wrap" style={{ marginTop: 16, minWidth: 180 }}>
                  <select className="rly-select rly-select--sm" name="kind" defaultValue={b.status === 'confirmed' ? 'deposit' : 'service'} aria-label="Charge type">
                    <option value="deposit">Deposit</option>
                    <option value="service">Additional charge</option>
                  </select>
                </span>
                <input className="rly-input rly-input--sm rly-data" style={{ maxWidth: 120 }} name="amount" placeholder="0.00" inputMode="decimal" aria-label="Amount" />
                <Submit className="rly-btn rly-btn--secondary rly-btn--sm">Add charge</Submit>
              </ActionForm>
            )}
          </div>
        </div>

        <div className="stack g-6">
          <div className="rly-card">
            <div className="card-title">
              <h2 className="h3">{b.finalCents !== null ? 'Final' : 'Estimate'}</h2>
            </div>
            <div className="stack g-3">
              {price?.lines.map((l, i) => (
                <div className="kv" key={l.k}>
                  <span>{l.k}</span>
                  <span className="rly-data">
                    {i > 0 && l.cents > 0 ? '+' : ''}
                    {usd(l.cents)}
                  </span>
                </div>
              ))}
              <div className="total" style={{ paddingTop: 14, marginTop: 4 }}>
                <div className="total__sum" style={{ marginTop: 0 }}>
                  <span className="rly-label">{b.finalCents !== null ? 'Final price' : 'Estimate'}</span>
                  <span className="rly-data total__amount" style={{ fontSize: 28 }}>
                    {usd(b.finalCents ?? b.estimateCents)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <ActionForm action={saveJobNotes} className="rly-card stack g-3" saved="Saved.">
            <input type="hidden" name="bookingId" value={b.id} />
            <label className="rly-field">
              <span className="rly-field__label">Crew notes · only you see these</span>
              <textarea className="rly-input" name="adminNotes" defaultValue={b.adminNotes} placeholder="Gate code, condition on arrival, upsell ideas…" />
            </label>
            <div>
              <Submit className="rly-btn rly-btn--secondary rly-btn--sm">Save notes</Submit>
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}

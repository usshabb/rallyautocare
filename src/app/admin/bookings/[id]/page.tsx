import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { completeJob, locateJob, noShow, requestCharge, saveJobNotes, sendEta } from '@/app/actions/admin';
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
import { bookings } from '@/lib/db/schema';
import { driveMinutes, pointOf } from '@/lib/geo';
import { listMessages, smsConnected } from '@/lib/notify';
import { getBooking, listBookings } from '@/lib/queries';
import { fmtDateLong, fmtRange, fmtStamp, fmtStampTime, fmtTime, today } from '@/lib/time';

const KIND_LABEL = { confirmation: 'Confirmation', reminder: 'Reminder', eta: 'On the way', rescheduled: 'New time', cancelled: 'Cancelled' } as const;
const STATUS_LABEL = { pending: 'Sending', sent: 'Sent', logged: 'Not delivered — no SMS provider yet', failed: 'Failed' } as const;

export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const b = await getBooking(id);
  if (!b) notFound();
  const price = priceVisit({ kind: b.kind, serviceId: b.serviceId, size: b.size, addonIds: b.addons });
  const happened = b.date <= today();
  const isToday = b.date === today();
  const [texts, sameDay] = await Promise.all([listMessages([b.id]), isToday ? listBookings(and(eq(bookings.date, b.date), eq(bookings.status, 'confirmed'))) : Promise.resolve([])]);
  // Once this job is done, the next one today is where the van goes: offer its client an ETA.
  const next = b.status === 'completed' ? sameDay.filter((x) => x.startMin > b.startMin).sort((x, y) => x.startMin - y.startMin)[0] : undefined;
  const here = pointOf(b);
  const nextDrive = next && here && pointOf(next) ? driveMinutes(here, pointOf(next)!) : 15;
  const etaSaved = smsConnected() ? 'ETA sent.' : 'ETA recorded below, but not delivered: no SMS provider is connected yet.';

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
                <span>
                  <a href={`https://maps.apple.com/?q=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer" className="link">
                    {b.address}
                  </a>
                  <br />
                  {here ? (
                    <Link href={`/admin/routes?date=${b.date}`} className="small link">
                      {b.area || 'On the map'} · see the day’s route
                    </Link>
                  ) : (
                    <ActionForm action={locateJob} className="inline-form">
                      <input type="hidden" name="bookingId" value={b.id} />
                      <span className="small" style={{ color: 'var(--warning)' }}>
                        Not on the map, so it isn’t in route planning.
                      </span>
                      <Submit className="link small" pending="Looking…">
                        Find again
                      </Submit>
                    </ActionForm>
                  )}
                </span>
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

          {next && (
            <div className="rly-card rly-card--striped stack g-4" style={{ paddingTop: 32 }}>
              <h2 className="h3">Next stop: {next.customerName || formatPhone(next.customerPhone)}</h2>
              <p className="small muted">
                {fmtTime(next.startMin)} · {next.serviceName} · {next.address}
              </p>
              <ActionForm action={sendEta} className="inline-form" saved={etaSaved}>
                <input type="hidden" name="bookingId" value={next.id} />
                <label className="rly-field" style={{ maxWidth: 140 }}>
                  <span className="rly-field__label">Minutes away</span>
                  <input className="rly-input rly-data" name="minutes" defaultValue={nextDrive} inputMode="numeric" />
                </label>
                <Submit className="rly-btn rly-btn--primary" pending="Sending…">
                  Text them we’re on the way
                </Submit>
              </ActionForm>
              <p className="note">The minutes start at the estimated drive from this job. The text asks them to have the car open and cleared out.</p>
            </div>
          )}

          {b.status === 'confirmed' && isToday && (
            <div className="rly-card stack g-4">
              <h2 className="h3">On the way?</h2>
              <ActionForm action={sendEta} className="inline-form" saved={etaSaved}>
                <input type="hidden" name="bookingId" value={b.id} />
                <label className="rly-field" style={{ maxWidth: 140 }}>
                  <span className="rly-field__label">Minutes away</span>
                  <input className="rly-input rly-data" name="minutes" defaultValue={15} inputMode="numeric" />
                </label>
                <Submit className="rly-btn rly-btn--secondary" pending="Sending…">
                  Text ETA
                </Submit>
              </ActionForm>
            </div>
          )}

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
                  text={`${b.serviceName} for ${b.customerName || formatPhone(b.customerPhone)} on ${fmtDateLong(b.date)}. Any unpaid deposit is voided. The client gets a text that it's cancelled.`}
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

          <div className="rly-card stack g-3">
            <div className="card-title" style={{ marginBottom: 0 }}>
              <h2 className="h3">Texts to the client</h2>
            </div>
            {texts.length === 0 ? (
              <p className="small muted">None yet.</p>
            ) : (
              texts.map((m) => (
                <details key={m.id} className="small">
                  <summary style={{ cursor: 'pointer' }}>
                    <span className="strong">{KIND_LABEL[m.kind]}</span> · {fmtStampTime(m.createdAt)} ·{' '}
                    <span style={{ color: m.status === 'sent' ? 'var(--success)' : m.status === 'failed' ? 'var(--danger)' : 'var(--fg-2)' }}>
                      {STATUS_LABEL[m.status]}
                      {m.error ? `: ${m.error}` : ''}
                    </span>
                  </summary>
                  <p className="note" style={{ marginTop: 6 }}>
                    {m.body}
                  </p>
                </details>
              ))
            )}
            {!smsConnected() && <p className="note">Texts are recorded here but not delivered until an SMS provider is connected.</p>}
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

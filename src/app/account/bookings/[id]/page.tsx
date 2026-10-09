import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancel } from '@/app/actions/booking';
import { PageHead } from '@/components/app/PageHead';
import { RescheduleCard } from '@/components/booking/RescheduleCard';
import { ChargeBadge, PayBadge, StatusBadge } from '@/components/ui/badges';
import { ConfirmAction } from '@/components/ui/Dialog';
import { requireUser } from '@/lib/auth';
import { SCHEDULE } from '@/lib/availability';
import { canSelfServe } from '@/lib/bookings';
import { BUSINESS, findAddon, priceVisit, sizeLabel, usd } from '@/lib/catalog';
import { getBooking } from '@/lib/queries';
import { fmtDateLong, fmtRange } from '@/lib/time';

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/bookings/${id}`);
  const b = await getBooking(id);
  if (!b || b.userId !== user.id) notFound();

  const price = priceVisit({ kind: b.kind, serviceId: b.serviceId, size: b.size, addonIds: b.addons });
  const editable = canSelfServe(b);

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
                <span className="rly-label">When</span>
                <span className="rly-data">
                  {fmtDateLong(b.date)}
                  <br />
                  {fmtRange(b.startMin, b.durationMin)}
                </span>
              </div>
              <div className="fact">
                <span className="rly-label">Where</span>
                <span>{b.address}</span>
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
                  <span className="rly-label">Notes</span>
                  <span>{b.notes}</span>
                </div>
              )}
            </div>
          </div>

          {b.status === 'confirmed' && (
            <div className="rly-card">
              <div className="card-title">
                <h2 className="h3">Change this booking</h2>
              </div>
              {editable ? (
                <div className="wrap-row">
                  <RescheduleCard bookingId={b.id} kind={b.kind} serviceId={b.serviceId} />
                  <ConfirmAction
                    action={cancel}
                    fields={{ bookingId: b.id }}
                    label="Cancel booking"
                    className="rly-btn rly-btn--sm btn-danger"
                    title="Cancel this booking?"
                    text={`${b.serviceName} on ${fmtDateLong(b.date)}. Your time will be released for someone else.`}
                    confirmLabel="Cancel booking"
                  />
                  <a href={`/api/bookings/${b.id}/ics`} className="rly-btn rly-btn--ghost rly-btn--sm">
                    Add to calendar
                  </a>
                </div>
              ) : (
                <p className="small muted">
                  It’s within {SCHEDULE.cancelCutoffHours} hours of your arrival time, so changes need a call:{' '}
                  <a href={BUSINESS.phoneHref} className="link rly-data">
                    {BUSINESS.phone}
                  </a>
                  .
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rly-card">
          <div className="card-title">
            <h2 className="h3">{b.finalCents !== null ? 'Total' : 'Estimate'}</h2>
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
                <span className="rly-label">{b.finalCents !== null ? 'Final price' : b.kind === 'initial' ? 'Starting from' : 'Estimated total'}</span>
                <span className="rly-data total__amount" style={{ fontSize: 28 }}>
                  {usd(b.finalCents ?? b.estimateCents)}
                </span>
              </div>
              {b.finalCents === null && <span className="note">Pay after service. If the vehicle needs more than the package covers, we confirm the price with you before we start.</span>}
            </div>
            {b.charges.map((c) => (
              <div className="kv" key={c.id} style={{ alignItems: 'center' }}>
                <span>{c.description}</span>
                <span className="wrap-row" style={{ gap: 8 }}>
                  <span className="rly-data">{usd(c.amountCents)}</span>
                  <ChargeBadge status={c.status} />
                </span>
              </div>
            ))}
            {b.pay.state === 'due' && (
              <Link href="/account/payments" className="rly-btn rly-btn--dark rly-btn--sm" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                How to pay
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

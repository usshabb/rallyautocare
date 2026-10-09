import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, gte } from 'drizzle-orm';
import { cancelMyMembership, switchPlan } from '@/app/actions/account';
import { manageCard, startAutopay, turnOffAutopay } from '@/app/actions/pay';
import { BookingList } from '@/components/app/BookingList';
import { PageHead } from '@/components/app/PageHead';
import { VisitScheduler } from '@/components/booking/VisitScheduler';
import { MembershipCards } from '@/components/site/sections';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { MembershipBadge } from '@/components/ui/badges';
import { ConfirmAction } from '@/components/ui/Dialog';
import { requireUser } from '@/lib/auth';
import { loadMemberships, visitsInPeriod } from '@/lib/billing';
import { PLANS, findPlan, planMonthly, sizeLabel, usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { bookings } from '@/lib/db/schema';
import { listBookings, listVehicles } from '@/lib/queries';
import { applySession, stripeEnabled } from '@/lib/stripe';
import { addDays, fmtDatePlain, today } from '@/lib/time';

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ autopay?: string }> }) {
  const user = await requireUser('/account/membership');
  const { autopay: sessionId } = await searchParams;
  const cardPay = stripeEnabled();
  // Back from Stripe after putting a card on file. The webhook links it too; doing it here shows it at
  // once. Then on to a clean address, so refreshing the page doesn't replay the session.
  if (sessionId?.startsWith('cs_')) {
    const linked = cardPay && !!user.stripeCustomerId && (await applySession(sessionId, user.stripeCustomerId).catch(() => 'none')) === 'autopay';
    redirect(`/account/membership${linked ? '?autopay=on' : ''}`);
  }
  const autopayOn = sessionId === 'on';
  const all = await loadMemberships(user.id);
  const live = all.filter((m) => m.status !== 'cancelled');
  const ended = all.filter((m) => m.status === 'cancelled');
  const vehicles = await listVehicles(user.id);
  const now = today();

  const cards = await Promise.all(
    live.map(async (m) => ({
      m,
      plan: findPlan(m.planId),
      vehicle: vehicles.find((v) => v.id === m.vehicleId)?.label ?? 'Vehicle',
      usage: await visitsInPeriod(db, m, now),
      upcoming: await listBookings(and(eq(bookings.membershipId, m.id), eq(bookings.status, 'confirmed'), gte(bookings.date, now))),
    })),
  );

  return (
    <>
      <PageHead index="MEMBERSHIP" title={live.length ? 'Your membership' : 'Stay clean on a schedule'} />
      {autopayOn && (
        <p className="rly-toast rly-toast--success" role="status" style={{ maxWidth: 'none', marginBottom: 28, boxShadow: 'inset 3px 0 0 #3FBF77' }}>
          <span>
            <span className="rly-toast__title">Autopay is on.</span> Your card is on file and will be charged each month.
          </span>
        </p>
      )}

      {live.length === 0 && (
        <div className="stack g-6">
          <p className="lede">One or two details a month, booked around your schedule, for less than paying visit by visit. No contract — cancel anytime.</p>
          <MembershipCards />
        </div>
      )}

      <div className="stack g-8">
        {cards.map(({ m, plan, vehicle, usage, upcoming }) => {
          const other = PLANS.find((p) => p.id !== m.planId)!;
          const hasInitial = upcoming.some((b) => b.kind === 'initial');
          const left = usage ? Math.max(0, usage.allowed - usage.used) : 0;
          return (
            <section key={m.id} className="detail-grid">
              <div className="stack g-6">
                <div className="rly-card rly-card--striped stack g-5" style={{ paddingTop: 32 }}>
                  <div className="between" style={{ alignItems: 'flex-start' }}>
                    <div className="stack g-2">
                      <h2 className="rly-pkg__name">{plan?.name}</h2>
                      <span className="small muted">
                        {vehicle} · {sizeLabel(m.size)}
                      </span>
                    </div>
                    <MembershipBadge status={m.status} />
                  </div>
                  <div className="rly-pkg__price">
                    <span className="rly-pkg__amount">{usd(m.priceCents)}</span>
                    <span className="rly-pkg__per">/mo</span>
                  </div>
                  {m.status === 'pending' ? (
                    <p className="small muted">
                      {hasInitial
                        ? 'Your membership starts once your initial detail is done. Monthly billing begins that day.'
                        : 'Your membership starts with an initial detail. Pick a time for it below.'}
                    </p>
                  ) : (
                    usage && (
                      <div className="facts">
                        <div className="fact">
                          <span className="rly-label">This month</span>
                          <span className="rly-data">
                            {fmtDatePlain(usage.period.start)} – {fmtDatePlain(addDays(usage.period.end, -1))}
                          </span>
                        </div>
                        <div className="fact">
                          <span className="rly-label">Visits</span>
                          <span className="rly-data">
                            {usage.used} of {usage.allowed} booked
                          </span>
                        </div>
                        <div className="fact">
                          <span className="rly-label">Member since</span>
                          <span className="rly-data">{m.startedOn ? fmtDatePlain(m.startedOn) : '—'}</span>
                        </div>
                      </div>
                    )
                  )}
                  {m.status === 'pending' && !hasInitial && (
                    <VisitScheduler membershipId={m.id} planId={m.planId} pending address={user.address} label="Schedule initial detail" />
                  )}
                  {m.status === 'active' && (
                    <VisitScheduler
                      membershipId={m.id}
                      planId={m.planId}
                      pending={false}
                      address={user.address}
                      label={left > 0 ? `Schedule a visit · ${left} left this month` : 'Schedule next month’s visit'}
                    />
                  )}
                </div>

                <div>
                  <div className="card-title">
                    <h3 className="h3">Upcoming visits</h3>
                  </div>
                  <BookingList rows={upcoming} empty="No visits scheduled yet." />
                </div>
              </div>

              <div className="rly-card stack g-5">
                <h3 className="h3">Manage plan</h3>
                {cardPay && m.status === 'active' && (
                  <div className="stack g-3" style={{ paddingBottom: 20, borderBottom: '1px solid var(--border-2)' }}>
                    <div className="between" style={{ alignItems: 'center' }}>
                      <span className="rly-label">Autopay</span>
                      <span className={'rly-badge ' + (m.stripeSubscriptionId ? 'rly-badge--success' : 'rly-badge--neutral')}>{m.stripeSubscriptionId ? 'On' : 'Off'}</span>
                    </div>
                    {m.stripeSubscriptionId ? (
                      <>
                        <span className="small muted">
                          Your card is charged {usd(m.priceCents)} each month{m.autopayFrom ? `, starting ${fmtDatePlain(m.autopayFrom)}` : ''}. Months before that are billed on your
                          Payments page.
                        </span>
                        <div className="wrap-row">
                          <ActionForm action={manageCard}>
                            <Submit className="rly-btn rly-btn--secondary rly-btn--sm" pending="Opening…">
                              Update card
                            </Submit>
                          </ActionForm>
                          <ConfirmAction
                            action={turnOffAutopay}
                            fields={{ membershipId: m.id }}
                            label="Turn off autopay"
                            className="rly-btn rly-btn--ghost rly-btn--sm"
                            title="Turn off autopay?"
                            text="Your membership continues. Each month will show on your Payments page for you to pay by Zelle, Apple Pay or card."
                            confirmLabel="Turn off autopay"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="small muted">
                          Put a card on file and we’ll charge {usd(m.priceCents)} each month{usage ? `, starting ${fmtDatePlain(usage.period.end)}` : ''}. Nothing is charged today — this
                          month is on your Payments page.
                        </span>
                        <ActionForm action={startAutopay}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <Submit className="rly-btn rly-btn--dark rly-btn--sm" pending="Opening…">
                            Turn on autopay
                          </Submit>
                        </ActionForm>
                      </>
                    )}
                  </div>
                )}
                <div className="stack g-3">
                  <span className="small muted">
                    Switch to <strong className="strong">{other.name}</strong> — {other.visits} {other.visits === 1 ? 'visit' : 'visits'} a month for {usd(planMonthly(other.id, m.size))}/mo. The new
                    price starts with your next billing month.
                  </span>
                  <ActionForm action={switchPlan}>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="planId" value={other.id} />
                    <Submit className="rly-btn rly-btn--secondary rly-btn--sm" pending="Switching…">
                      Switch to {other.name}
                    </Submit>
                  </ActionForm>
                </div>
                <div className="stack g-3" style={{ paddingTop: 20, borderTop: '1px solid var(--border-2)' }}>
                  <span className="small muted">No contract. Cancelling stops future billing and clears any upcoming visits.</span>
                  <div>
                    <ConfirmAction
                      action={cancelMyMembership}
                      fields={{ membershipId: m.id }}
                      label="Cancel membership"
                      className="rly-btn rly-btn--sm btn-danger"
                      title="Cancel your membership?"
                      text={`${plan?.name} for ${vehicle}. Future billing stops and upcoming visits are cancelled. Anything already billed stays on your account.`}
                      confirmLabel="Cancel membership"
                    />
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        {live.length > 0 && (
          <p className="small muted">
            Have another vehicle? <Link href="/book?mode=member&service=plus" className="link">Add a membership for it</Link> — it’s one vehicle per membership.
          </p>
        )}

        {ended.length > 0 && (
          <section>
            <div className="card-title">
              <h3 className="h3">Past memberships</h3>
            </div>
            <div className="list">
              {ended.map((m) => (
                <div key={m.id} className="list__item">
                  <div className="list__main">
                    <span className="list__title">{findPlan(m.planId)?.name}</span>
                    <span className="list__sub">{m.startedOn ? `Started ${fmtDatePlain(m.startedOn)}` : 'Never started'}</span>
                  </div>
                  <MembershipBadge status={m.status} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

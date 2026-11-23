import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { applyRoute, locateJob, moveJob, sendEta } from '@/app/actions/admin';
import { PageHead } from '@/components/app/PageHead';
import { RouteMap, type MapLine, type MapStop } from '@/components/app/RouteMap';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { requireAdmin } from '@/lib/auth';
import { BASE } from '@/lib/geo';
import { smsConnected } from '@/lib/notify';
import { formatPhone } from '@/lib/phone';
import { mapsRouteUrl, MAX_SHIFT_MIN, planDays, suggestMoves, type Leg } from '@/lib/routes';
import { addDays, dayNum, dowLabel, fmtDate, fmtDateLong, fmtRange, fmtTime, isDate, nowLocal, weekStart } from '@/lib/time';

export const metadata: Metadata = { title: 'Routes' };

// One colour per weekday, so the week map shows at a glance which jobs share a day.
const DAY_COLORS = ['#D21F26', '#2F5BC9', '#1E7F4A', '#A86E06', '#7A3FB0', '#0E7C86', '#5E5E64'];

const legText = (l: Leg | null) => (l ? `~${l.minutes} min · ${l.miles.toFixed(1)} mi` : 'drive unknown — address not on the map');
const who = (b: { customerName: string; customerPhone: string }) => b.customerName || formatPhone(b.customerPhone);

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const now = nowLocal();
  const date = isDate(q.date) ? q.date : now.date;
  const monday = weekStart(date);
  const [{ plans }, suggestions] = await Promise.all([planDays(monday, addDays(monday, 6)), suggestMoves()]);
  const plan = plans.find((p) => p.date === date)!;
  const dayColor = (d: string) => DAY_COLORS[plans.findIndex((p) => p.date === d)] ?? DAY_COLORS[6];
  const isToday = date === now.date;
  const texted = smsConnected();

  // Selected day: numbered in route order. The rest of the week: the weekday's initial, in its colour.
  const stops: MapStop[] = [];
  const lines: MapLine[] = [];
  for (const p of plans) {
    const located = p.stops.filter((s) => s.point);
    if (p.date === date) {
      p.stops.forEach((s, i) => s.point && stops.push({ ...s.point, tag: String(i + 1), color: dayColor(p.date), label: `${i + 1}. ${fmtTime(s.startMin)} · ${who(s)} · ${s.address}` }));
      if (located.length) lines.push({ color: dayColor(p.date), points: [BASE, ...located.map((s) => s.point!), BASE] });
    } else {
      located.forEach((s) => stops.push({ ...s.point!, tag: dowLabel(p.date).slice(0, 2), color: dayColor(p.date), label: `${fmtDate(p.date)} ${fmtTime(s.startMin)} · ${who(s)} · ${s.area ?? s.address}` }));
    }
  }

  return (
    <>
      <PageHead index="ROUTES" title={fmtDateLong(date)}>
        {date !== now.date && (
          <Link href="/admin/routes" className="rly-btn rly-btn--secondary rly-btn--sm">
            Today
          </Link>
        )}
      </PageHead>

      <div className="between" style={{ marginBottom: 12 }}>
        <Link href={`/admin/routes?date=${addDays(monday, -7)}`} className="rly-iconbtn rly-iconbtn--outline" aria-label="Previous week">
          <ChevronLeft />
        </Link>
        <span className="rly-label muted">Week of {fmtDate(monday)}</span>
        <Link href={`/admin/routes?date=${addDays(monday, 7)}`} className="rly-iconbtn rly-iconbtn--outline" aria-label="Next week">
          <ChevronRight />
        </Link>
      </div>
      <div className="week-days">
        {plans.map((p) => (
          <Link
            key={p.date}
            href={`/admin/routes?date=${p.date}`}
            className={'week-day' + (p.date === date ? ' week-day--on' : '')}
            style={{ '--day-color': p.stops.length ? dayColor(p.date) : undefined } as React.CSSProperties}
            aria-current={p.date === date ? 'date' : undefined}
          >
            <span className="week-day__head">
              <span className="rly-label" style={p.date === now.date ? { color: 'var(--accent)' } : undefined}>
                {dowLabel(p.date)} {dayNum(p.date)}
              </span>
              <span className="rly-data tiny muted">{p.stops.length ? `${p.stops.length} job${p.stops.length === 1 ? '' : 's'}` : ''}</span>
            </span>
            {p.areas.map((a) => (
              <span key={a.area} className="week-day__area">
                {a.area}
                {a.n > 1 ? ` ×${a.n}` : ''}
              </span>
            ))}
            {p.stops.length > 0 && <span className="week-day__drive">~{p.driveMinutes} min drive</span>}
          </Link>
        ))}
      </div>

      <div className="detail-grid" style={{ marginTop: 24 }}>
        <div className="stack g-5">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h2 className="h3">Route</h2>
            {plan.stops.length > 0 && (
              <a href={mapsRouteUrl(plan.stops.map((s) => s.address))} target="_blank" rel="noreferrer" className="rly-btn rly-btn--primary rly-btn--sm">
                Open in Google Maps
              </a>
            )}
          </div>
          {plan.stops.length === 0 ? (
            <p className="small muted">Nothing booked this day.</p>
          ) : (
            <div className="rly-card" style={{ paddingTop: 8, paddingBottom: 8 }}>
              <div className="route">
                <div className="route__stop" style={{ borderTop: 0 }}>
                  <span className="route__num" style={{ background: 'var(--bg-inverse)' }}>
                    B
                  </span>
                  <span className="small strong">Start · {BASE.address}</span>
                </div>
                {plan.stops.map((s, i) => (
                  <div key={s.id}>
                    <div className={'route__leg' + (s.tight ? ' route__leg--tight' : '')}>
                      {legText(s.legIn)}
                      {s.tight && s.gapMin !== null ? ` · only ${s.gapMin} min between jobs` : ''}
                    </div>
                    <div className="route__stop">
                      <span className="route__num" style={{ background: s.status === 'completed' ? 'var(--fg-3)' : dayColor(date) }}>
                        {i + 1}
                      </span>
                      <span className="stack" style={{ gap: 4, minWidth: 0 }}>
                        <span className="rly-data small">{fmtRange(s.startMin, s.durationMin)}</span>
                        <Link href={`/admin/bookings/${s.id}`} className="link strong">
                          {who(s)} · {s.serviceName}
                        </Link>
                        <span className="small muted">
                          {s.address}
                          {s.area ? ` · ${s.area}` : ''}
                        </span>
                        {!s.point && (
                          <ActionForm action={locateJob} className="inline-form">
                            <input type="hidden" name="bookingId" value={s.id} />
                            <span className="small" style={{ color: 'var(--warning)' }}>
                              Not on the map.
                            </span>
                            <Submit className="link small" pending="Looking…">
                              Find again
                            </Submit>
                          </ActionForm>
                        )}
                      </span>
                      <span className="route__actions">
                        {s.status === 'completed' ? (
                          <span className="rly-badge rly-badge--success">Done</span>
                        ) : (
                          isToday && (
                            <ActionForm action={sendEta} className="eta-form" saved={texted ? 'ETA sent.' : 'ETA recorded on the booking, not delivered (no SMS provider yet).'}>
                              <input type="hidden" name="bookingId" value={s.id} />
                              <input className="rly-input rly-input--sm rly-data" name="minutes" defaultValue={s.legIn?.minutes ?? 15} inputMode="numeric" aria-label="Minutes away" />
                              <span className="small muted">min</span>
                              <Submit className="rly-btn rly-btn--secondary rly-btn--sm" pending="Sending…">
                                Text ETA
                              </Submit>
                            </ActionForm>
                          )
                        )}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="route__leg">{legText(plan.legOut)} back to base</div>
              </div>
            </div>
          )}
          {plan.stops.length > 0 && (
            <p className="note">
              About {plan.driveMinutes} min and {plan.driveMiles.toFixed(0)} mi of driving
              {plan.unlocated ? `, not counting ${plan.unlocated} job${plan.unlocated === 1 ? '' : 's'} we couldn't place on the map` : ''}. Drive times are estimates from distance, not live traffic.
              {isToday ? ' “Text ETA” texts the client how far out you are; the minutes start at the drive from the previous stop.' : ''}
              {!texted ? ' No SMS provider is connected yet, so texts are recorded on the booking but not delivered.' : ''}
            </p>
          )}

          {plan.proposal && (
            <ActionForm action={applyRoute} className="rly-card rly-card--striped stack g-4" saved={texted ? 'Done. Clients with a new time are being texted.' : 'Done.'}>
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="moves" value={JSON.stringify(plan.proposal.moves)} />
              <h3 className="h3">Shorter order: saves about {plan.proposal.savedMinutes} min of driving</h3>
              <div className="stack g-2">
                {[...plan.proposal.moves]
                  .sort((a, b) => a.to - b.to)
                  .map((m, i) => {
                    const s = plan.stops.find((x) => x.id === m.id)!;
                    return (
                      <div key={m.id} className="kv">
                        <span>
                          {i + 1}. {who(s)} · {s.area ?? s.address}
                        </span>
                        <span className="rly-data">{m.to === m.from ? fmtTime(m.to) : `${fmtTime(m.from)} → ${fmtTime(m.to)}`}</span>
                      </div>
                    );
                  })}
              </div>
              <p className="note">
                From ~{plan.proposal.currentMinutes} to ~{plan.proposal.newMinutes} min of driving. Applying moves these arrival times (no one by more than {MAX_SHIFT_MIN / 60} hours) and
                texts each client whose time changes. Check with them first if a big move might not work.
              </p>
              <div>
                <Submit className="rly-btn rly-btn--primary rly-btn--sm" pending="Applying…">
                  Apply new order
                </Submit>
              </div>
            </ActionForm>
          )}
        </div>

        <div className="stack g-5">
          <RouteMap stops={stops} lines={lines} base={BASE} />
          <p className="note">
            Numbers: this day in driving order. Two letters: other jobs this week, coloured by day. B: base ({BASE.address}).
          </p>
        </div>
      </div>

      <section style={{ marginTop: 40 }}>
        <div className="card-title">
          <h2 className="h3">Group jobs by area · next two weeks</h2>
        </div>
        {suggestions.length === 0 ? (
          <p className="small muted">Nothing to regroup: every job is either near others on its day, or there's no better day with the crew nearby and a time free.</p>
        ) : (
          <div className="rly-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {suggestions.map((s) => (
              <ActionForm key={s.job.id} action={moveJob} className="suggest" saved={texted ? 'Moved. The client is being texted the new time.' : 'Moved. The text is recorded on the booking, not delivered (no SMS provider yet).'}>
                <input type="hidden" name="bookingId" value={s.job.id} />
                <input type="hidden" name="date" value={s.toDate} />
                <input type="hidden" name="startMin" value={s.toStart} />
                <span className="stack" style={{ gap: 4 }}>
                  <span className="strong">
                    <Link href={`/admin/bookings/${s.job.id}`} className="link">
                      {who(s.job)}
                    </Link>{' '}
                    · {s.job.serviceName} · {s.job.area ?? s.job.address}
                  </span>
                  <span className="rly-data small">
                    {fmtDate(s.job.date)} {fmtTime(s.job.startMin)} → {fmtDate(s.toDate)} {fmtTime(s.toStart)}
                  </span>
                  <span className="small muted">
                    {s.nearMiles.toFixed(1)} mi from {who(s.near)}’s {fmtTime(s.near.startMin)} job that day. Saves about {s.savedMinutes} min of driving.
                  </span>
                </span>
                <Submit className="rly-btn rly-btn--secondary rly-btn--sm" pending="Moving…">
                  Move &amp; text client
                </Submit>
              </ActionForm>
            ))}
          </div>
        )}
        <p className="note" style={{ marginTop: 12, maxWidth: '72ch' }}>
          Jobs far from everything else on their day, with a day nearby that has the crew close by and an arrival time open. Check with the client first: moving the booking texts them
          the new time.
        </p>
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import { asc, gte } from 'drizzle-orm';
import { blockTime, unblockTime } from '@/app/actions/admin';
import { PageHead } from '@/components/app/PageHead';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { requireAdmin } from '@/lib/auth';
import { SCHEDULE } from '@/lib/availability';
import { db } from '@/lib/db';
import { blocks } from '@/lib/db/schema';
import { fmtDateLong, fmtTime, isDate, today } from '@/lib/time';

export const metadata: Metadata = { title: 'Availability' };

const TIMES = Array.from({ length: 27 }, (_, i) => 8 * 60 + i * 30); // 8:00 AM – 9:00 PM

export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const now = today();
  const upcoming = await db.select().from(blocks).where(gte(blocks.date, now)).orderBy(asc(blocks.date), asc(blocks.startMin));

  return (
    <>
      <PageHead index="AVAILABILITY" title="When clients can book" />
      <div className="detail-grid">
        <div className="stack g-8">
          <ActionForm action={blockTime} className="panel panel--tight" reset>
            <h2 className="h3">Block time off</h2>
            <p className="note" style={{ marginTop: -12 }}>
              Blocked time disappears from the booking calendar. Jobs already booked in that window stay put — move or cancel those yourself.
            </p>
            <div className="form-grid">
              <label className="rly-field">
                <span className="rly-field__label">Day</span>
                <input className="rly-input" type="date" name="date" min={now} defaultValue={isDate(q.date) && q.date >= now ? q.date : now} required />
              </label>
              <label className="rly-field">
                <span className="rly-field__label">Reason · optional</span>
                <input className="rly-input" name="reason" placeholder="Day off, fleet job, weather…" />
              </label>
            </div>
            <label className="rly-check">
              <input type="checkbox" name="allDay" defaultChecked />
              <span className="rly-check__box" />
              Whole day
            </label>
            <div className="form-grid">
              <label className="rly-field">
                <span className="rly-field__label">From · if not the whole day</span>
                <span className="rly-select-wrap">
                  <select className="rly-select" name="start" defaultValue={SCHEDULE.openMin}>
                    {TIMES.map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="rly-field">
                <span className="rly-field__label">Until</span>
                <span className="rly-select-wrap">
                  <select className="rly-select" name="end" defaultValue={SCHEDULE.openMin + 180}>
                    {TIMES.map((t) => (
                      <option key={t} value={t}>
                        {fmtTime(t)}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            </div>
            <div>
              <Submit className="rly-btn rly-btn--dark" pending="Blocking…">
                Block this time
              </Submit>
            </div>
          </ActionForm>

          <section>
            <div className="card-title">
              <h2 className="h3">Blocked time</h2>
            </div>
            <div className="list">
              {upcoming.length === 0 && <p className="list__empty">Nothing blocked. Clients can book any open time.</p>}
              {upcoming.map((b) => (
                <div key={b.id} className="list__item">
                  <div className="list__main">
                    <span className="list__title">{fmtDateLong(b.date)}</span>
                    <span className="list__sub">
                      {b.startMin === 0 && b.endMin === 1440 ? 'Whole day' : `${fmtTime(b.startMin)} – ${fmtTime(b.endMin)}`}
                      {b.reason ? ` · ${b.reason}` : ''}
                    </span>
                  </div>
                  <ActionForm action={unblockTime}>
                    <input type="hidden" name="blockId" value={b.id} />
                    <Submit className="rly-btn rly-btn--ghost rly-btn--sm">Unblock</Submit>
                  </ActionForm>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="rly-card rly-card--striped stack g-5" style={{ paddingTop: 32 }}>
          <h2 className="h3">Booking rules</h2>
          <div className="facts">
            <div className="fact">
              <span className="rly-label">Hours</span>
              <span className="rly-data">
                {fmtTime(SCHEDULE.openMin)} – {fmtTime(SCHEDULE.closeMin)}
              </span>
            </div>
            <div className="fact">
              <span className="rly-label">Arrival times</span>
              <span className="rly-data">{SCHEDULE.slotStarts.map(fmtTime).join(', ')}</span>
            </div>
            <div className="fact">
              <span className="rly-label">Between jobs</span>
              <span className="rly-data">{SCHEDULE.bufferMin} min</span>
            </div>
            <div className="fact">
              <span className="rly-label">Books ahead</span>
              <span className="rly-data">{SCHEDULE.horizonDays} days</span>
            </div>
            <div className="fact">
              <span className="rly-label">Same-day notice</span>
              <span className="rly-data">{SCHEDULE.leadMin / 60} hours</span>
            </div>
            <div className="fact">
              <span className="rly-label">Online changes until</span>
              <span className="rly-data">{SCHEDULE.cancelCutoffHours} hours before</span>
            </div>
          </div>
          <p className="note">
            A time only shows as open if the whole job fits: its length, plus the gap between jobs, with nothing overlapping and done by closing. These rules live in
            src/lib/availability.ts.
          </p>
        </div>
      </div>
    </>
  );
}

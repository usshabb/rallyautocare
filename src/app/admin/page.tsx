import Link from 'next/link';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BookingList } from '@/components/app/BookingList';
import { PageHead } from '@/components/app/PageHead';
import { requireAdmin } from '@/lib/auth';
import { syncAllMemberships } from '@/lib/billing';
import { usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { blocks, bookings, charges, leads, memberships } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { listBookings } from '@/lib/queries';
import { addDays, dayNum, dowLabel, fmtDateLong, fmtRange, fmtTime, isDate, nowLocal, weekStart } from '@/lib/time';

const HOUR_PX = 64;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const now = nowLocal();
  const date = isDate(q.date) ? q.date : now.date;
  const monday = weekStart(date);
  const sunday = addDays(monday, 6);
  await syncAllMemberships();

  const [week, off, [owed], [members], [newLeads]] = await Promise.all([
    listBookings(and(gte(bookings.date, monday), lte(bookings.date, sunday))),
    db.select().from(blocks).where(eq(blocks.date, date)),
    db.select({ total: sql<number>`coalesce(sum(${charges.amountCents}), 0)` }).from(charges).where(eq(charges.status, 'due')),
    db.select({ n: sql<number>`count(*)` }).from(memberships).where(eq(memberships.status, 'active')),
    db.select({ n: sql<number>`count(*)` }).from(leads).where(eq(leads.status, 'new')),
  ]);

  const live = week.filter((b) => b.status === 'confirmed' || b.status === 'completed');
  const day = week.filter((b) => b.date === date);
  const dayLive = day.filter((b) => b.status === 'confirmed' || b.status === 'completed');
  const todayJobs = live.filter((b) => b.date === now.date).length;

  // Fit the timeline to the working day, stretching if something sits outside 9AM–9PM.
  const starts = [...dayLive.map((b) => b.startMin), ...off.map((b) => Math.max(b.startMin, 8 * 60))];
  const ends = [...dayLive.map((b) => b.startMin + b.durationMin), ...off.map((b) => Math.min(b.endMin, 21 * 60))];
  const firstHour = Math.min(9, ...starts.map((m) => Math.floor(m / 60)));
  const lastHour = Math.max(21, ...ends.map((m) => Math.ceil(m / 60)));
  const top = (min: number) => ((min - firstHour * 60) / 60) * HOUR_PX;

  return (
    <>
      <PageHead index="SCHEDULE" title={fmtDateLong(date)}>
        {date !== now.date && (
          <Link href="/admin" className="rly-btn rly-btn--secondary rly-btn--sm">
            Today
          </Link>
        )}
      </PageHead>

      <div className="stats">
        <div className="stat">
          <span className="rly-label">Jobs today</span>
          <span className="stat__value">{todayJobs}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Jobs this week</span>
          <span className="stat__value">{live.length}</span>
        </div>
        <Link href="/admin/payments" className="stat">
          <span className="rly-label">Outstanding</span>
          <span className="stat__value">{usd(Number(owed?.total ?? 0))}</span>
        </Link>
        <Link href="/admin/memberships" className="stat">
          <span className="rly-label">Active members</span>
          <span className="stat__value">{Number(members?.n ?? 0)}</span>
        </Link>
        <Link href="/admin/leads" className="stat">
          <span className="rly-label">New leads</span>
          <span className="stat__value">{Number(newLeads?.n ?? 0)}</span>
        </Link>
      </div>

      <div className="weekbar">
        <Link href={`/admin?date=${addDays(monday, -7)}`} className="rly-iconbtn rly-iconbtn--outline" aria-label="Previous week">
          <ChevronLeft />
        </Link>
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(monday, i);
          const count = live.filter((b) => b.date === d).length;
          return (
            <Link
              key={d}
              href={`/admin?date=${d}`}
              className={'rly-date' + (d === date ? ' rly-date--selected' : '') + (d === now.date ? ' rly-date--today' : '')}
              aria-current={d === date ? 'date' : undefined}
            >
              <span className="rly-date__dow">{dowLabel(d)}</span>
              <span className="rly-date__num">{dayNum(d)}</span>
              <span className="rly-date__count">{count ? `${count} job${count === 1 ? '' : 's'}` : ''}</span>
            </Link>
          );
        })}
        <Link href={`/admin?date=${addDays(monday, 7)}`} className="rly-iconbtn rly-iconbtn--outline" aria-label="Next week">
          <ChevronRight />
        </Link>
      </div>

      <div className="detail-grid">
        <div className="timeline">
          <div className="timeline__grid" style={{ height: (lastHour - firstHour) * HOUR_PX }}>
            {Array.from({ length: lastHour - firstHour }, (_, i) => (
              <div key={i} className="timeline__hour">
                <span>{fmtTime((firstHour + i) * 60).replace(':00', '')}</span>
              </div>
            ))}
            {off.map((b) => {
              const s = Math.max(b.startMin, firstHour * 60);
              const e = Math.min(b.endMin, lastHour * 60);
              return (
                <div key={b.id} className="timeline__block" style={{ top: top(s), height: top(e) - top(s) }}>
                  Blocked{b.reason ? ` · ${b.reason}` : ''}
                </div>
              );
            })}
            {dayLive.map((b) => (
              <Link
                key={b.id}
                href={`/admin/bookings/${b.id}`}
                className={'timeline__job' + (b.status === 'completed' ? ' timeline__job--done' : '')}
                style={{ top: top(b.startMin), height: (b.durationMin / 60) * HOUR_PX - 2 }}
              >
                <span className="timeline__job-time">{fmtRange(b.startMin, b.durationMin)}</span>
                <span className="timeline__job-title">
                  {b.customerName || formatPhone(b.customerPhone)} · {b.serviceName}
                </span>
                <span className="timeline__job-sub">
                  {b.vehicleLabel} · {b.address}
                </span>
              </Link>
            ))}
            {date === now.date && now.minutes >= firstHour * 60 && now.minutes <= lastHour * 60 && <div className="timeline__now" style={{ top: top(now.minutes) }} />}
          </div>
        </div>

        <div className="stack g-4">
          <div className="card-title" style={{ marginBottom: 0 }}>
            <h2 className="h3">Jobs</h2>
            <Link href={`/admin/availability?date=${date}`} className="link small">
              Block time
            </Link>
          </div>
          <BookingList rows={day} admin empty="Nothing booked this day." />
        </div>
      </div>
    </>
  );
}

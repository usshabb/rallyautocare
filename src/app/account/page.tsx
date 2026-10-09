import Link from 'next/link';
import { and, eq, gte } from 'drizzle-orm';
import { BookingList } from '@/components/app/BookingList';
import { PageHead } from '@/components/app/PageHead';
import { requireUser } from '@/lib/auth';
import { loadMemberships } from '@/lib/billing';
import { findPlan, usd } from '@/lib/catalog';
import { bookings } from '@/lib/db/schema';
import { balanceDue, listBookings } from '@/lib/queries';
import { fmtDate, fmtTime, today } from '@/lib/time';

export default async function AccountPage() {
  const user = await requireUser();
  const [upcoming, plans] = await Promise.all([
    listBookings(and(eq(bookings.userId, user.id), eq(bookings.status, 'confirmed'), gte(bookings.date, today()))),
    loadMemberships(user.id),
  ]);
  const due = await balanceDue(user.id); // after loadMemberships, which may add this month's charge
  const live = plans.filter((m) => m.status !== 'cancelled');
  const next = upcoming[0];

  return (
    <>
      <PageHead index="ACCOUNT" title={user.name ? `Hi, ${user.name.split(' ')[0]}` : 'Your account'}>
        <Link href="/book" className="rly-btn rly-btn--primary">
          Book a detail
        </Link>
      </PageHead>

      <div className="stats">
        <div className="stat">
          <span className="rly-label">Next visit</span>
          <span className="stat__value">{next ? fmtDate(next.date) : '—'}</span>
          <span className="note">{next ? `${fmtTime(next.startMin)} · ${next.serviceName}` : 'Nothing booked yet'}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Balance due</span>
          <span className="stat__value">{usd(due)}</span>
          <span className="note">{due > 0 ? <Link href="/account/payments" className="link">See what’s owed</Link> : 'You’re all settled'}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Membership</span>
          <span className="stat__value" style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 22, letterSpacing: 0 }}>
            {live.length ? (findPlan(live[0].planId)?.name ?? 'Member') : 'None'}
          </span>
          <span className="note">
            <Link href={live.length ? '/account/membership' : '/book?mode=member&service=plus'} className="link">
              {live.length ? (live[0].status === 'pending' ? 'Starts after your initial detail' : 'Manage your plan') : 'Save with a monthly plan'}
            </Link>
          </span>
        </div>
      </div>

      {(!user.name || !user.email) && (
        <p className="testmode" style={{ marginBottom: 28 }}>
          Your account is missing {!user.name && !user.email ? 'a name and email' : !user.name ? 'a name' : 'an email'}.{' '}
          <Link href="/account/profile" className="link">
            Finish your profile
          </Link>
        </p>
      )}

      <div className="card-title">
        <h2 className="h3">Coming up</h2>
        <Link href="/account/bookings" className="link small">
          All bookings
        </Link>
      </div>
      <BookingList rows={upcoming.slice(0, 4)} empty="No upcoming visits. Book a detail and it’ll show up here." />
    </>
  );
}

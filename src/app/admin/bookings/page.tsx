import type { Metadata } from 'next';
import Link from 'next/link';
import { BookingList } from '@/components/app/BookingList';
import { PageHead } from '@/components/app/PageHead';
import { requireAdmin } from '@/lib/auth';
import { listBookings } from '@/lib/queries';
import { today } from '@/lib/time';

export const metadata: Metadata = { title: 'Bookings' };

const VIEWS = [
  ['upcoming', 'Upcoming'],
  ['open', 'To close out'],
  ['past', 'Past'],
] as const;

export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireAdmin();
  const { view = 'upcoming' } = await searchParams;
  const all = await listBookings(undefined, 'asc', 2000);
  const now = today();
  const upcoming = all.filter((b) => b.status === 'confirmed' && b.date >= now);
  // Jobs whose day has passed but were never marked complete, no-show or cancelled.
  const open = all.filter((b) => b.status === 'confirmed' && b.date < now);
  const past = all.filter((b) => b.status !== 'confirmed').reverse();
  const rows = view === 'open' ? open : view === 'past' ? past : upcoming;
  const counts: Record<string, number> = { upcoming: upcoming.length, open: open.length, past: past.length };

  return (
    <>
      <PageHead index="BOOKINGS" title="All bookings">
        <Link href="/admin/bookings/new" className="rly-btn rly-btn--primary">
          New booking
        </Link>
      </PageHead>
      <div className="rly-tabs" style={{ marginBottom: 20 }}>
        {VIEWS.map(([id, label]) => (
          <Link key={id} href={`/admin/bookings?view=${id}`} className={'rly-tab' + (view === id || (id === 'upcoming' && !['open', 'past'].includes(view)) ? ' rly-tab--active' : '')}>
            {label} · {counts[id]}
          </Link>
        ))}
      </div>
      <BookingList
        rows={rows}
        admin
        empty={view === 'open' ? 'Nothing waiting. Every past job has been closed out.' : view === 'past' ? 'No past bookings yet.' : 'No upcoming bookings.'}
      />
    </>
  );
}

import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { BookingList } from '@/components/app/BookingList';
import { PageHead } from '@/components/app/PageHead';
import { requireUser } from '@/lib/auth';
import { bookings } from '@/lib/db/schema';
import { listBookings } from '@/lib/queries';
import { today } from '@/lib/time';

export default async function BookingsPage() {
  const user = await requireUser('/account/bookings');
  const all = await listBookings(eq(bookings.userId, user.id));
  const now = today();
  const upcoming = all.filter((b) => b.status === 'confirmed' && b.date >= now);
  const past = all.filter((b) => !upcoming.includes(b)).reverse();

  return (
    <>
      <PageHead index="BOOKINGS" title="Your bookings">
        <Link href="/book" className="rly-btn rly-btn--primary">
          Book a detail
        </Link>
      </PageHead>
      <div className="stack g-8">
        <section>
          <div className="card-title">
            <h2 className="h3">Upcoming</h2>
          </div>
          <BookingList rows={upcoming} empty="No upcoming visits." />
        </section>
        <section>
          <div className="card-title">
            <h2 className="h3">Past</h2>
          </div>
          <BookingList rows={past} empty="Your completed and cancelled visits will show up here." />
        </section>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { PageHead } from '@/components/app/PageHead';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { panelCustomer } from '@/lib/panel';

export const metadata: Metadata = { title: 'New booking' };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireAdmin();
  const { client } = await searchParams;
  const [existing] = client ? await db.select().from(users).where(eq(users.id, client)) : [];
  const customer = await panelCustomer(existing ?? null);

  return (
    <>
      <PageHead index="NEW BOOKING" title={customer ? `Book for ${customer.name || customer.phone}` : 'Book for a client'} />
      <p className="note" style={{ marginTop: -12, marginBottom: 24, maxWidth: '70ch' }}>
        For calls, texts and Instagram messages. You can place a job on any open half hour, including outside the times clients can pick. Overlaps are still blocked.
      </p>
      <BookingPanel key={existing?.id ?? 'new'} customer={customer} admin />
    </>
  );
}

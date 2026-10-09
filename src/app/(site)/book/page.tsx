import type { Metadata } from 'next';
import { BookingPanel, type Mode } from '@/components/booking/BookingPanel';
import { SectionHead } from '@/components/site/sections';
import { bypassCode, currentUser } from '@/lib/auth';
import { findDetail, findPlan } from '@/lib/catalog';
import { panelCustomer } from '@/lib/panel';

export const metadata: Metadata = { title: 'Book', description: 'Book a mobile detail or start a membership. Pick an open arrival time — pay after service.' };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ mode?: string; service?: string }> }) {
  const q = await searchParams;
  const mode: Mode = q.mode === 'member' ? 'member' : 'detail';
  const known = mode === 'member' ? findPlan(q.service ?? '') : findDetail(q.service ?? '');
  const customer = await panelCustomer(await currentUser());

  return (
    <section id="book" className="wrap section" style={{ paddingTop: 56 }}>
      <SectionHead index="BOOK" title="Book your time" aside="Pick a package, a day and an open arrival time. Nothing is charged now — you pay after the service." />
      <BookingPanel customer={customer} testCode={bypassCode()} initial={{ mode, serviceId: known?.id ?? (mode === 'member' ? 'plus' : 'full') }} />
    </section>
  );
}

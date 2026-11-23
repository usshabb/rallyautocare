import type { Metadata } from 'next';
import { BookingPanel, type Mode } from '@/components/booking/BookingPanel';
import { PathChooser } from '@/components/booking/PathChooser';
import { SectionHead } from '@/components/site/sections';
import { currentUser, visibleTestCode } from '@/lib/auth';
import { findDetail, findPlan } from '@/lib/catalog';
import { panelCustomer } from '@/lib/panel';

export const metadata: Metadata = { title: 'Book', description: 'Book a mobile detail or start a membership. Pick an open arrival time — pay after service.' };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ mode?: string; service?: string }> }) {
  const q = await searchParams;
  // No path picked yet: ask the one question first, membership or one-time.
  if (q.mode !== 'member' && q.mode !== 'detail') {
    return (
      <section className="wrap section" style={{ paddingTop: 56 }}>
        <SectionHead index="BOOK" title="How do you want to book?" aside="Members get a detail every month at a better price. Or book a single visit. Nothing is charged now — you pay after the service." />
        <div style={{ maxWidth: 760 }}>
          <PathChooser />
        </div>
      </section>
    );
  }
  const mode: Mode = q.mode;
  const known = mode === 'member' ? findPlan(q.service ?? '') : findDetail(q.service ?? '');
  const customer = await panelCustomer(await currentUser());

  return (
    <section id="book" className="wrap section" style={{ paddingTop: 56 }}>
      <SectionHead index="BOOK" title="Book your time" aside="Pick a package, a day and an open arrival time. Nothing is charged now — you pay after the service." />
      <BookingPanel customer={customer} testCode={visibleTestCode()} initial={{ mode, serviceId: known?.id ?? (mode === 'member' ? 'plus' : 'full') }} />
    </section>
  );
}

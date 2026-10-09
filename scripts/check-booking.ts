// Checks the rule the business cares about most: one crew, so no two jobs may overlap.
// Runs against a throwaway database:  pnpm check
import { rmSync } from 'node:fs';

process.env.DATABASE_URL = 'file:./data/check.db';
rmSync('./data/check.db', { force: true });

async function main() {
  const { migrate } = await import('drizzle-orm/libsql/migrator');
  const { db, client } = await import('../src/lib/db');
  const { users } = await import('../src/lib/db/schema');
  const { bookDetail, joinMembership, bookMembershipVisit, completeBooking, cancelBooking } = await import('../src/lib/bookings');
  const { getAvailability } = await import('../src/lib/availability');
  const { loadMemberships, nearestPeriodStart } = await import('../src/lib/billing');
  const { charges, memberships } = await import('../src/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { listCharges } = await import('../src/lib/queries');
  const { addDays, today } = await import('../src/lib/time');
  await migrate(db, { migrationsFolder: './drizzle' });

  let failed = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!pass) failed++;
  };
  const rejects = async (fn: () => Promise<unknown>) => fn().then(() => '', (e: Error) => e.message);

  const [a, b] = await db.insert(users).values([{ id: 'a', phone: '+17035550101', name: 'A' }, { id: 'b', phone: '+17035550102', name: 'B' }]).returning();
  const day = addDays(today(), 5);
  const req = (userId: string, startMin: number, date = day) => ({
    userId, date, startMin, addonIds: [], address: '1 Test St, Ashburn VA', createdBy: 'customer' as const,
    vehicle: { label: `Car of ${userId}`, size: 'car' as const },
  });
  const states = async (service: 'essential' | 'full' | 'premium', date = day) => {
    const { DETAILS } = await import('../src/lib/catalog');
    const days = await getAvailability(DETAILS.find((d) => d.id === service)!.minutes, { from: date, days: 1 });
    return Object.fromEntries(days[0].slots.map((s) => [s.start, s.state]));
  };

  // A 4.5h Premium job at 10:00 ends 2:30; with the 30 min gap the next free arrival is 4:00.
  const premium = await bookDetail({ ...req(a.id, 600), serviceId: 'premium' });
  const after = await states('essential');
  check('10:00 Premium blocks 10:00, 11:30, 1:00 and 2:30', [600, 690, 780, 870].every((s) => after[s] === 'taken'), JSON.stringify(after));
  check('4:00 and 5:30 stay open for a 2h job', after[960] === 'open' && after[1050] === 'open');
  check('a 3h job cannot start at 5:30 (would run past 8 PM)', (await states('full'))[1050] === 'late');

  // The server refuses an overlapping booking even if the browser asks for it.
  check('server rejects an overlapping 11:30 booking', /taken/.test(await rejects(() => bookDetail({ ...req(b.id, 690), serviceId: 'essential' }))));
  check('server rejects a time off the arrival grid', /not available/.test(await rejects(() => bookDetail({ ...req(b.id, 615), serviceId: 'essential' }))));

  // Two people confirming the same free slot at the same moment: exactly one gets it.
  const race = await Promise.allSettled([
    bookDetail({ ...req(a.id, 960), serviceId: 'essential' }),
    bookDetail({ ...req(b.id, 960), serviceId: 'essential' }),
  ]);
  const lost = race.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  check('simultaneous bookings for one slot: exactly one wins', race.filter((r) => r.status === 'fulfilled').length === 1, race.map((r) => r.status).join(', '));
  check('the one who loses is told the time was taken', /taken/.test(lost?.reason?.message ?? ''), lost?.reason?.message);

  // Cancelling frees the time again.
  await cancelBooking(premium.id, { userId: a.id, admin: false });
  check('cancelling frees the slot', (await states('essential'))[600] === 'open');

  // Membership: pending until the initial detail is completed, then billed monthly with a visit allowance.
  const now = today();
  const initial = await joinMembership({ ...req(b.id, 600, now), planId: 'maint', createdBy: 'admin' });
  let [m] = await loadMemberships(b.id);
  check('new membership waits on the initial detail', m.status === 'pending' && initial.kind === 'initial');
  check('same vehicle cannot join twice', /already on a membership/.test(await rejects(() => joinMembership({ ...req(b.id, 870, addDays(now, 3)), planId: 'plus' }))));
  await completeBooking(initial.id, 175_00);
  [m] = await loadMemberships(b.id);
  const money = await listCharges();
  check('completing the initial detail activates the membership', m.status === 'active' && m.startedOn === now);
  check('initial detail is billed', money.some((c) => c.bookingId === initial.id && c.amountCents === 175_00 && c.status === 'due'));
  check('first month is billed once', money.filter((c) => c.membershipId === m.id && c.kind === 'membership').length === 1);
  const visit = { membershipId: m.id, userId: b.id, addonIds: ['trim'], address: '1 Test St, Ashburn VA', createdBy: 'customer' as const };
  const v1 = await bookMembershipVisit({ ...visit, date: addDays(now, 7), startMin: 600 });
  check('included visit costs only its add-ons', v1.kind === 'visit' && v1.estimateCents === 10_00, String(v1.estimateCents));
  check('plan allowance is enforced (1 visit / month)', /month is full/.test(await rejects(() => bookMembershipVisit({ ...visit, date: addDays(now, 9), startMin: 600 }))));

  // Autopay: Stripe renews a Jan 31 starter on the 28th. Those months must land on the app's own periods,
  // so nothing is billed a second time once autopay is switched off and the app takes billing back.
  check('Stripe renewal on Mar 28 is filed under the Mar 31 period', nearestPeriodStart('2026-01-31', '2026-03-28') === '2026-03-31');
  check('a renewal that lands a day early (clock change) keeps its period', nearestPeriodStart('2026-10-08', '2026-11-07') === '2026-11-08');
  check('a renewal on the exact day is unchanged', nearestPeriodStart('2026-01-31', '2026-02-28') === '2026-02-28');
  await db.update(memberships).set({ startedOn: '2026-01-31', stripeSubscriptionId: 'sub_test', autopayFrom: '2026-02-28' }).where(eq(memberships.id, m.id));
  await db.delete(charges).where(eq(charges.membershipId, m.id));
  for (const stripeDate of ['2026-02-28', '2026-03-28', '2026-04-28']) {
    await db.insert(charges).values({ id: `paid-${stripeDate}`, userId: b.id, membershipId: m.id, kind: 'membership', description: 'paid by autopay', amountCents: 120_00, status: 'paid', method: 'stripe', periodStart: nearestPeriodStart('2026-01-31', stripeDate) });
  }
  await db.update(memberships).set({ stripeSubscriptionId: null, autopayFrom: null }).where(eq(memberships.id, m.id)); // autopay turned off
  await loadMemberships(b.id);
  const months = await db.select().from(charges).where(eq(charges.membershipId, m.id));
  const spring = months.filter((c) => c.periodStart! >= '2026-02-01' && c.periodStart! < '2026-05-01');
  check('months paid by autopay are not billed again after autopay ends', spring.length === 3 && spring.every((c) => c.status === 'paid'), spring.map((c) => `${c.periodStart}:${c.status}`).join(' '));
  check('the month before autopay began is still owed', months.some((c) => c.periodStart === '2026-01-31' && c.status === 'due'));

  client.close();
  rmSync('./data/check.db', { force: true });
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

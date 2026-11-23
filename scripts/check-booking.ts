// Checks the rules the business cares about most — above all: one crew, so no two jobs may overlap.
//
// Runs against real Postgres (the database in DATABASE_DIRECT_URL / DATABASE_URL) because the overlap
// rule depends on how Postgres handles simultaneous writes. It works in its own throwaway schema,
// `rally_check`, which it creates and drops; the real tables in `public` are never touched.
//
//   pnpm check
import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

const SCHEMA = 'rally_check';
const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (see .env.example) to run the checks.');
  process.exit(1);
}
// Point the app's own database client at the throwaway schema, with several connections so that
// "two people at once" really is two connections racing.
process.env.DATABASE_URL = url;
process.env.DATABASE_SCHEMA = SCHEMA;
process.env.DATABASE_POOL = '6';

async function main() {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url!);
  const admin = postgres(url!, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => undefined, connection: { search_path: SCHEMA } });
  await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
  await admin.unsafe(`create schema ${SCHEMA}`);
  // The same migrations the real database gets, with their foreign keys pointed at this schema.
  for (const file of readdirSync('./drizzle').filter((f) => f.endsWith('.sql')).sort()) {
    const text = readFileSync(`./drizzle/${file}`, 'utf8').replaceAll('"public".', `"${SCHEMA}".`);
    for (const statement of text.split('--> statement-breakpoint')) if (statement.trim()) await admin.unsafe(statement);
  }

  const { db, client, isConflict } = await import('../src/lib/db');
  let failed = 0;
  try {
    const { users, bookings, charges, memberships } = await import('../src/lib/db/schema');
    const { bookDetail, joinMembership, bookMembershipVisit, completeBooking, cancelBooking, rescheduleBooking } = await import('../src/lib/bookings');
    const { getAvailability } = await import('../src/lib/availability');
    const { loadMemberships, nearestPeriodStart } = await import('../src/lib/billing');
    const { listCharges } = await import('../src/lib/queries');
    const { DETAILS } = await import('../src/lib/catalog');
    const { addDays, today } = await import('../src/lib/time');
    const { eq } = await import('drizzle-orm');

    const check = (name: string, pass: boolean, detail = '') => {
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
      if (!pass) failed++;
    };
    const rejects = async (fn: () => Promise<unknown>) => fn().then(() => '', (e: Error) => e.message);
    const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'booked' : (r.reason as Error).message);

    const [a, b] = await db.insert(users).values([{ id: 'a', phone: '+17035550101', name: 'A' }, { id: 'b', phone: '+17035550102', name: 'B' }]).returning();
    const day = addDays(today(), 5);
    const req = (userId: string, startMin: number, date = day) => ({
      userId, date, startMin, addonIds: [], address: '1 Test St, Ashburn VA', createdBy: 'customer' as const,
      vehicle: { label: `Car of ${userId}`, size: 'car' as const },
    });
    const states = async (service: 'essential' | 'full' | 'premium', date = day) => {
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
    const same = await Promise.allSettled([
      bookDetail({ ...req(a.id, 960), serviceId: 'essential' }),
      bookDetail({ ...req(b.id, 960), serviceId: 'essential' }),
    ]);
    check('same slot, same moment: exactly one wins', same.filter((r) => r.status === 'fulfilled').length === 1, same.map(outcome).join(' / '));
    check('the one who loses is told the time was taken', same.some((r) => r.status === 'rejected' && /taken/.test((r.reason as Error).message)));

    // The harder race: different start times that overlap. Each request alone looks fine, so only
    // making bookings take turns (the schedule lock) stops both from going through.
    const day2 = addDays(day, 1);
    const overlap = await Promise.allSettled([
      bookDetail({ ...req(a.id, 600, day2), serviceId: 'premium' }), // 10:00 – 2:30
      bookDetail({ ...req(b.id, 690, day2), serviceId: 'essential' }), // 11:30 – 1:30
      bookDetail({ ...req(a.id, 780, day2), serviceId: 'essential' }), // 1:00 – 3:00
    ]);
    check('overlapping jobs at different times, same moment: exactly one wins', overlap.filter((r) => r.status === 'fulfilled').length === 1, overlap.map(outcome).join(' / '));

    // And if application code ever got it wrong, the database refuses the overlap on its own.
    const [live] = await db.select().from(bookings).where(eq(bookings.date, day2));
    const raw = await db.insert(bookings).values({ ...live, id: 'raw', code: 'RAC-RAW', startMin: live.startMin + 30 }).then(() => null, (e) => e);
    check('the database itself refuses two overlapping jobs', isConflict(raw));

    // Moving and cancelling.
    const moved = await rejects(() => rescheduleBooking(live.id, day, 600, { userId: live.userId, admin: true }));
    check('a booking cannot be moved onto another job', /taken/.test(moved), moved);
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
    check('completing the initial detail activates the membership', m.status === 'active' && m.startedOn === now, `${m.status} ${m.startedOn}`);
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

    // ── Grouping jobs by area ──────────────────────────────────────────────────────────────────
    // Coordinates are set directly, so nothing here calls the geocoder.
    const { planDays, proposeOrder, suggestMoves, MAX_SHIFT_MIN } = await import('../src/lib/routes');
    const { applyDayOrder } = await import('../src/lib/bookings');
    const { notifyBooking, sendDueReminders, messageBody } = await import('../src/lib/notify');
    const { getBooking } = await import('../src/lib/queries');
    const { messages } = await import('../src/lib/db/schema');
    const at = (lat: number, lng: number, area: string) => ({ lat, lng, area });
    const LEESBURG = at(39.1142, -77.565, 'Leesburg');
    const LEESBURG_2 = at(39.105, -77.555, 'Leesburg'); // under a mile away
    const LEESBURG_3 = at(39.12, -77.575, 'Leesburg');
    const ASHBURN = at(39.0381, -77.475, 'Ashburn');
    const ARLINGTON = at(38.8816, -77.091, 'Arlington');
    const located = (userId: string, date: string, startMin: number, place: ReturnType<typeof at>) => bookDetail({ ...req(userId, startMin, date), place, serviceId: 'essential', createdBy: 'admin' });

    // Customers are steered toward days the crew is already nearby.
    const d8 = addDays(today(), 8);
    await located(a.id, d8, 600, LEESBURG);
    const near = (await getAvailability(120, { from: d8, days: 1, point: LEESBURG_2 }))[0];
    const far = (await getAvailability(120, { from: d8, days: 1, point: ARLINGTON }))[0];
    check('a day with a job a mile away is marked nearby', near.nearby === true);
    check('the same day is not "nearby" for an address 30 miles off', !far.nearby && !far.slots.some((x) => x.best));
    check('the marked time is the first open one after the nearby job', near.slots.find((x) => x.best)?.start === 780, JSON.stringify(near.slots.filter((x) => x.best)));
    const adminNear = (await getAvailability(180, { from: d8, days: 1, point: LEESBURG_2, admin: true }))[0];
    check('a "best" time is never one that runs past closing, even for the crew', adminNear.slots.filter((x) => x.best).every((x) => x.start + 180 <= 20 * 60), JSON.stringify(adminNear.slots.filter((x) => x.best).map((x) => x.label)));
    check('nearby is only a hint: the other open times stay open', near.slots.filter((x) => x.state === 'open').length === far.slots.filter((x) => x.state === 'open').length);

    // A day driven out of order gets a shorter one, on the times clients already picked.
    const shuffled = proposeOrder([
      { id: 'L', startMin: 600, durationMin: 120, point: LEESBURG },
      { id: 'A', startMin: 780, durationMin: 120, point: ASHBURN },
      { id: 'L2', startMin: 960, durationMin: 120, point: LEESBURG_2 },
    ]);
    const order = shuffled ? [...shuffled.moves].sort((x, y) => x.to - y.to).map((m) => m.id).join(',') : '';
    check('Leesburg → Ashburn → Leesburg is reordered to keep the Leesburg jobs together', !!shuffled && /L,L2|L2,L/.test(order), `${order} saves ${shuffled?.savedMinutes} min`);
    check('the new order reuses the existing arrival times', !!shuffled && shuffled.moves.every((m) => [600, 780, 960].includes(m.to)));
    check(`no one moves more than ${MAX_SHIFT_MIN / 60} hours`, !!shuffled && shuffled.moves.every((m) => Math.abs(m.to - m.from) <= MAX_SHIFT_MIN));
    check('a day already in a sensible order is left alone', proposeOrder([
      { id: 'L', startMin: 600, durationMin: 120, point: LEESBURG },
      { id: 'L2', startMin: 780, durationMin: 120, point: LEESBURG_2 },
      { id: 'A', startMin: 960, durationMin: 120, point: ASHBURN },
    ]) === null);

    // …and applying it moves the bookings for real, through the same overlap rules.
    const d9 = addDays(today(), 9);
    const [j1, j2, j3] = [await located(a.id, d9, 600, LEESBURG), await located(b.id, d9, 780, ASHBURN), await located(a.id, d9, 960, LEESBURG_2)];
    const planned = (await planDays(d9, d9)).plans[0];
    check('the route page proposes the shorter order', !!planned.proposal && planned.proposal.savedMinutes >= 10, String(planned.proposal?.savedMinutes));
    const changed = planned.proposal ? await applyDayOrder(d9, planned.proposal.moves) : [];
    const afterApply = (await planDays(d9, d9)).plans[0];
    check('applying it moves the jobs and nothing overlaps', changed.length >= 2 && afterApply.stops.every((x, i, all) => !all[i + 1] || x.startMin + x.durationMin + 30 <= all[i + 1].startMin), afterApply.stops.map((x) => `${x.area}@${x.startMin}`).join(' '));
    check('the moved day drives less', afterApply.driveMinutes < planned.driveMinutes, `${planned.driveMinutes} → ${afterApply.driveMinutes}`);
    check('a proposal from before a change is refused', /changed/.test(await rejects(() => applyDayOrder(d9, planned.proposal!.moves))));
    void j1; void j2; void j3;

    // An outlying job is suggested for a day the crew is already near it.
    const d10 = addDays(today(), 10);
    const lonely = await located(b.id, d10, 600, LEESBURG_3); // alone on its day
    const ideas = await suggestMoves();
    // Either it moves next to a Leesburg job, or a lone Leesburg job moves next to it — one of the two.
    const idea = ideas.find((x) => x.job.id === lonely.id || x.near.id === lonely.id);
    check('a job alone on its day is grouped with a nearby job on another day', !!idea && idea.nearMiles <= 5 && idea.savedMinutes >= 15, idea ? `${idea.job.code} → ${idea.toDate} ${idea.toStart}, saves ${idea.savedMinutes}` : 'none');
    check('two lone jobs near each other get one suggestion, not a swap', !ideas.some((x) => ideas.some((y) => y.job.id === x.near.id && x.job.id === y.near.id)));
    check('jobs already grouped with a neighbour are left where they are', !ideas.some((x) => x.job.area === 'Leesburg' && x.job.date === d9));

    // Texts: the evening-before reminder goes out once per date and time, and again after a move.
    const d11 = addDays(today(), 11);
    const r = await located(a.id, d11, 600, ASHBURN);
    await db.update(bookings).set({ createdAt: Date.now() - 3 * 86_400_000 }).where(eq(bookings.id, r.id));
    const evening = { date: addDays(d11, -1), minutes: 16 * 60 };
    const first = await sendDueReminders(evening);
    const again = await sendDueReminders(evening);
    await rescheduleBooking(r.id, d11, 870, { userId: a.id, admin: true });
    const remindedAgain = await sendDueReminders(evening);
    const sentTo = await db.select().from(messages).where(eq(messages.bookingId, r.id));
    check('the reminder goes out once', first === 1 && again === 0, `${first}, then ${again}`);
    check('a rescheduled booking is reminded again for its new time', remindedAgain === 1 && sentTo.filter((m) => m.kind === 'reminder').length === 2);
    check('no reminder before 3 PM the day before', (await sendDueReminders({ date: addDays(d11, -1), minutes: 11 * 60 })) === 0);
    const late = await located(b.id, d11, 1050, ASHBURN); // 5:30 PM, so "today" catch-up applies in the morning
    await db.update(bookings).set({ createdAt: Date.now() - 3 * 86_400_000 }).where(eq(bookings.id, late.id));
    check('no texts late at night, whatever triggers the run', (await sendDueReminders({ date: addDays(d11, -1), minutes: 22 * 60 })) === 0);
    check('no texts early in the morning either', (await sendDueReminders({ date: d11, minutes: 7 * 60 })) === 0);
    check('a missed evening is caught up the next morning', (await sendDueReminders({ date: d11, minutes: 10 * 60 })) === 1);
    check('without an SMS provider texts are recorded, not sent', sentTo.every((m) => m.status === 'logged'));
    const row = (await getBooking(r.id))!;
    check('the reminder carries the prep checklist', /car seats/.test(messageBody('reminder', row)) && /trash/.test(messageBody('confirmation', row)));
    const eta = await notifyBooking(r.id, 'eta', { etaMin: 18 });
    check('an ETA text says how far out the crew is', !!eta && /about 18 min/.test(eta.body));
  } finally {
    await client.end({ timeout: 5 });
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

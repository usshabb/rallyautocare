import { and, gte, inArray, lte, ne } from 'drizzle-orm';
import { db, type Db, type Tx } from './db';
import { blocks, bookings } from './db/schema';
import { BASE, driveMinutes, miles, NEARBY_MILES, type Point } from './geo';
import { addDays, dayNum, dowLabel, fmtTime, nowLocal } from './time';

// One mobile crew, so no two jobs may overlap — not just start at the same time.
export const SCHEDULE = {
  openMin: 10 * 60, // 10:00 AM
  closeMin: 20 * 60, // 8:00 PM — jobs must finish by then
  slotStarts: [600, 690, 780, 870, 960, 1050], // arrival times customers can pick
  bufferMin: 30, // pack-up and drive time kept clear between jobs
  horizonDays: 14, // how far ahead customers can book
  leadMin: 120, // earliest same-day booking, from now
  cancelCutoffHours: 24, // customers can change or cancel online until this long before
};

// Admins can place a job on any half hour, including outside the customer arrival times.
const ADMIN_STARTS = Array.from({ length: (21 * 60 - 8 * 60) / 30 }, (_, i) => 8 * 60 + i * 30);

type Conn = Db | Tx;
type Busy = { start: number; end: number; job: boolean; point?: Point | null };

export type SlotState = 'open' | 'taken' | 'past' | 'late';
/** `best`: the open time on a nearby day that adds the least driving. */
export type Slot = { start: number; label: string; state: SlotState; best?: boolean };
/** `nearby`: the crew already has a job close to the customer's address that day. */
export type Day = { date: string; dow: string; num: number; open: number; nearby?: boolean; slots: Slot[] };

/** Everything already on the calendar between two dates, grouped by date. */
async function loadBusy(conn: Conn, from: string, to: string, excludeBookingId?: string): Promise<Map<string, Busy[]>> {
  const [jobs, off] = await Promise.all([
    conn
      .select({ id: bookings.id, date: bookings.date, start: bookings.startMin, minutes: bookings.durationMin, lat: bookings.lat, lng: bookings.lng })
      .from(bookings)
      .where(
        and(
          gte(bookings.date, from),
          lte(bookings.date, to),
          inArray(bookings.status, ['confirmed', 'completed']),
          excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
        ),
      ),
    conn.select().from(blocks).where(and(gte(blocks.date, from), lte(blocks.date, to))),
  ]);
  const map = new Map<string, Busy[]>();
  const add = (date: string, b: Busy) => map.set(date, [...(map.get(date) ?? []), b]);
  for (const j of jobs) add(j.date, { start: j.start, end: j.start + j.minutes, job: true, point: j.lat !== null && j.lng !== null ? { lat: j.lat, lng: j.lng } : null });
  for (const b of off) add(b.date, { start: b.startMin, end: b.endMin, job: false });
  return map;
}

/** A job overlaps another job if they come within the travel buffer of each other; blocked time needs no buffer. */
function collides(start: number, minutes: number, busy: Busy[]): boolean {
  const end = start + minutes;
  return busy.some((b) => {
    const pad = b.job ? SCHEDULE.bufferMin : 0;
    return start < b.end + pad && b.start < end + pad;
  });
}

function slotState(date: string, start: number, minutes: number, busy: Busy[], admin: boolean): SlotState {
  const now = nowLocal();
  if (date < now.date) return 'past';
  if (!admin) {
    if (date === now.date && start < now.minutes + SCHEDULE.leadMin) return 'past';
    if (start + minutes > SCHEDULE.closeMin) return 'late';
  }
  return collides(start, minutes, busy) ? 'taken' : 'open';
}

/**
 * Marks a day as nearby when the crew already has a job within NEARBY_MILES of the customer, and on
 * that day the open time that adds the least driving (the van comes from the job before and goes on
 * to the job after, or the base when there is none). Ranking only — nothing here makes a time unbookable.
 */
function markNearby(slots: Slot[], minutes: number, busy: Busy[], point: Point): boolean {
  const jobs = busy.filter((b): b is Busy & { point: Point } => b.job && !!b.point);
  if (!jobs.some((b) => miles(point, b.point) <= NEARBY_MILES)) return false;
  let best: Slot | null = null;
  let bestCost = Infinity;
  for (const s of slots) {
    // Admins may book outside hours, but the app only ever recommends a time inside them.
    if (s.state !== 'open' || s.start < SCHEDULE.openMin || s.start + minutes > SCHEDULE.closeMin) continue;
    const before = jobs.filter((b) => b.end <= s.start).sort((a, b) => b.end - a.end)[0]?.point ?? BASE;
    const after = jobs.filter((b) => b.start >= s.start + minutes).sort((a, b) => a.start - b.start)[0]?.point ?? BASE;
    const cost = driveMinutes(before, point) + driveMinutes(point, after) - driveMinutes(before, after);
    if (cost < bestCost) [best, bestCost] = [s, cost];
  }
  if (best) best.best = true;
  return true;
}

/**
 * Days and arrival times for a job of the given length. `admin` lifts the hours and lead-time rules, never the overlap rule.
 * With `point` (where the customer is), days the crew is already nearby are marked, so customers can help keep jobs grouped.
 */
export async function getAvailability(
  minutes: number,
  opts: { from?: string; days?: number; excludeBookingId?: string; admin?: boolean; point?: Point | null } = {},
): Promise<Day[]> {
  const admin = !!opts.admin;
  const from = opts.from ?? nowLocal().date;
  const count = opts.days ?? SCHEDULE.horizonDays;
  const to = addDays(from, count - 1);
  const busy = await loadBusy(db, from, to, opts.excludeBookingId);
  const starts = admin ? ADMIN_STARTS : SCHEDULE.slotStarts;
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    const dayBusy = busy.get(date) ?? [];
    const slots: Slot[] = starts.map((start) => ({ start, label: fmtTime(start), state: slotState(date, start, minutes, dayBusy, admin) }));
    const open = slots.filter((s) => s.state === 'open').length;
    const nearby = !!opts.point && open > 0 && markNearby(slots, minutes, dayBusy, opts.point);
    return { date, dow: dowLabel(date), num: dayNum(date), open, ...(nearby ? { nearby } : {}), slots };
  });
}

/**
 * Why a slot can't be booked, or null if it can. Call inside the same write transaction that inserts the
 * booking so two people confirming at once can't both get the time.
 */
export async function slotProblem(
  conn: Conn,
  input: { date: string; start: number; minutes: number; excludeBookingId?: string; admin?: boolean },
): Promise<string | null> {
  const { date, start, minutes, admin = false } = input;
  const starts = admin ? ADMIN_STARTS : SCHEDULE.slotStarts;
  if (!starts.includes(start)) return 'That arrival time is not available.';
  if (!admin && date > addDays(nowLocal().date, SCHEDULE.horizonDays - 1)) return 'That day is too far out to book yet.';
  const busy = (await loadBusy(conn, date, date, input.excludeBookingId)).get(date) ?? [];
  const state = slotState(date, start, minutes, busy, admin);
  if (state === 'open') return null;
  if (state === 'taken') return 'That time was just taken. Pick another one.';
  if (state === 'late') return 'That time is too late in the day for this service.';
  return 'That time has already passed.';
}

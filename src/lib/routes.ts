import { and, gte, inArray, lte } from 'drizzle-orm';
import { db } from './db';
import { blocks, bookings } from './db/schema';
import { getAvailability, SCHEDULE } from './availability';
import { BASE, driveMinutes, miles, NEARBY_MILES, pointOf, roadMiles, type Point } from './geo';
import { listBookings, type BookingRow } from './queries';
import { addDays, hoursUntil, today } from './time';

// Grouping jobs by area so the van spends its day detailing, not driving.
//
// With one crew the big saving is *which day* a job lands on: three Leesburg jobs on one day instead
// of three trips out. So customers are steered toward days the crew is already nearby (availability.ts),
// and the admin gets two proposals here — a shorter order for a day, and outlying jobs that would sit
// better on another day. Both only ever change a booking when the admin applies them.

export type Leg = { minutes: number; miles: number };

const leg = (a: Point | null, b: Point | null): Leg | null => (a && b ? { minutes: driveMinutes(a, b), miles: roadMiles(a, b) } : null);

/** Driving for a day in the order given: base → each job → base. Legs touching an unlocated job are null. */
export function legsFor(points: (Point | null)[], base: Point = BASE): (Leg | null)[] {
  const path = [base, ...points, base];
  return path.slice(1).map((p, i) => leg(path[i], p));
}

/** Total estimated drive for a day in the given order. */
export function driveTotal(points: Point[], base: Point = BASE): number {
  return legsFor(points, base).reduce((t, l) => t + (l?.minutes ?? 0), 0);
}

/** Extra driving to fit a stop at `p` between two others (either may be the base). */
export const detour = (p: Point, prev: Point, next: Point) => driveMinutes(prev, p) + driveMinutes(p, next) - driveMinutes(prev, next);

function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  const c = new Array(n).fill(0);
  yield [...a];
  for (let i = 0; i < n; ) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0;
      [a[i], a[j]] = [a[j], a[i]];
      yield [...a];
      c[i]++;
      i = 0;
    } else c[i++] = 0;
  }
}

export type RouteJob = { id: string; startMin: number; durationMin: number; point: Point };
export type Move = { id: string; from: number; to: number };
export type Proposal = { moves: Move[]; currentMinutes: number; newMinutes: number; savedMinutes: number };

/** Admin arrival grid: any half hour from 8:00 AM. */
const STEP = 30;
const FIRST_START = 8 * 60;
const LAST_START = 20 * 60 + 30;
/** No client's arrival time moves by more than this. Customer arrival times sit about 3 hours apart, so swapping two neighbours is a 3-hour move. */
export const MAX_SHIFT_MIN = 180;
/** Time to pack up before driving off, on top of the drive itself. */
const PACK_MIN = 10;
/** Don't bother anyone for less than this. */
const MIN_SAVING = 10;

/** Room needed between two jobs: the drive plus pack-up, never less than the usual gap. */
const gapNeeded = (a: RouteJob, b: RouteJob) => Math.max(SCHEDULE.bufferMin, PACK_MIN + driveMinutes(a.point, b.point));

/**
 * Gives the jobs, in their new order, the day's existing arrival times — the times clients already
 * picked from — if every job still fits before the next and clear of blocked time.
 */
function sameTimes(order: RouteJob[], times: number[], off: { start: number; end: number }[]): Move[] | null {
  const moves: Move[] = [];
  for (let i = 0; i < order.length; i++) {
    const job = order[i];
    const s = times[i];
    const next = order[i + 1];
    if (s + job.durationMin > SCHEDULE.closeMin || Math.abs(s - job.startMin) > MAX_SHIFT_MIN) return null;
    if (off.some((b) => s < b.end && b.start < s + job.durationMin)) return null;
    if (next && times[i + 1] < s + job.durationMin + gapNeeded(job, next)) return null;
    moves.push({ id: job.id, from: job.startMin, to: s });
  }
  return moves;
}

/**
 * Lays jobs out in the given order from the day's first start, each as early as it can go: after the
 * previous job, the drive between them and pack-up (never less than the usual gap), and clear of
 * blocked time. Null if that would run past closing or move anyone too far.
 */
function timeline(order: RouteJob[], off: { start: number; end: number }[], dayStart: number): Move[] | null {
  const moves: Move[] = [];
  let earliest = dayStart;
  for (let i = 0; i < order.length; i++) {
    const job = order[i];
    let s = Math.ceil(Math.max(earliest, FIRST_START) / STEP) * STEP;
    for (let guard = 0; guard < 50; guard++) {
      const hit = off.find((b) => s < b.end && b.start < s + job.durationMin);
      if (!hit) break;
      s = Math.ceil(hit.end / STEP) * STEP;
    }
    if (s > LAST_START || s + job.durationMin > SCHEDULE.closeMin || Math.abs(s - job.startMin) > MAX_SHIFT_MIN) return null;
    moves.push({ id: job.id, from: job.startMin, to: s });
    const next = order[i + 1];
    if (next) earliest = s + job.durationMin + gapNeeded(job, next);
  }
  return moves;
}

/**
 * A shorter order for one day's jobs, with new arrival times, or null if the current order is already
 * about as short as it gets. Every job must be on the map. Tries every order (a day holds a handful of
 * jobs), shortest drive first, and takes the first that fits the day — on the day's existing arrival
 * times where the job lengths allow, otherwise packed from the first one.
 */
export function proposeOrder(jobs: RouteJob[], off: { start: number; end: number }[] = [], base: Point = BASE): Proposal | null {
  if (jobs.length < 3 || jobs.length > 8) return null; // with two jobs, either order drives the same loop
  const current = [...jobs].sort((a, b) => a.startMin - b.startMin);
  const currentMinutes = driveTotal(current.map((j) => j.point), base);
  const ranked = [...permutations(current.length)]
    .map((p) => ({ p, minutes: driveTotal(p.map((i) => current[i].point), base) }))
    .filter((o) => o.minutes <= currentMinutes - MIN_SAVING)
    .sort((a, b) => a.minutes - b.minutes);
  const times = current.map((j) => j.startMin);
  for (const o of ranked) {
    const order = o.p.map((i) => current[i]);
    const moves = sameTimes(order, times, off) ?? timeline(order, off, current[0].startMin);
    if (moves) return { moves, currentMinutes, newMinutes: o.minutes, savedMinutes: currentMinutes - o.minutes };
  }
  return null;
}

export type Stop = BookingRow & { point: Point | null; legIn: Leg | null; gapMin: number | null; tight: boolean };

export type DayPlan = {
  date: string;
  stops: Stop[];
  legOut: Leg | null;
  driveMinutes: number;
  driveMiles: number;
  unlocated: number;
  areas: { area: string; n: number }[];
  proposal: Proposal | null;
};

/** Areas a set of jobs fall in, busiest first. */
export function areasOf(rows: Pick<BookingRow, 'area'>[]): { area: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.area || 'Not on map', (counts.get(r.area || 'Not on map') ?? 0) + 1);
  return [...counts].map(([area, n]) => ({ area, n })).sort((a, b) => b.n - a.n || a.area.localeCompare(b.area));
}

/** One day's jobs in time order with the drive between them, plus a shorter order if there is one. */
export function planDay(date: string, rows: BookingRow[], off: { start: number; end: number }[]): DayPlan {
  const live = rows.filter((b) => b.date === date && (b.status === 'confirmed' || b.status === 'completed')).sort((a, b) => a.startMin - b.startMin);
  const points = live.map(pointOf);
  const legs = legsFor(points);
  const stops = live.map((b, i): Stop => {
    const prev = live[i - 1];
    const gapMin = prev ? b.startMin - (prev.startMin + prev.durationMin) : null;
    const legIn = legs[i];
    // Back-to-back jobs further apart than the gap between them: flag it so the crew can call ahead.
    const tight = !!prev && gapMin !== null && !!legIn && legIn.minutes + PACK_MIN > gapMin;
    return { ...b, point: points[i], legIn, gapMin, tight };
  });
  const known = legs.filter((l): l is Leg => !!l);

  // Only reorder days that haven't started: today's clients are already expecting us.
  const movable = live.filter((b) => b.status === 'confirmed');
  const allOnMap = movable.every((b) => pointOf(b));
  const proposal =
    date > today() && movable.length === live.length && allOnMap
      ? proposeOrder(movable.map((b) => ({ id: b.id, startMin: b.startMin, durationMin: b.durationMin, point: pointOf(b)! })), off)
      : null;

  return {
    date,
    stops,
    legOut: live.length ? legs[legs.length - 1] : null,
    driveMinutes: known.reduce((t, l) => t + l.minutes, 0),
    driveMiles: known.reduce((t, l) => t + l.miles, 0),
    unlocated: points.filter((p) => !p).length,
    areas: areasOf(live),
    proposal,
  };
}

/** Each day of a range planned, from one read of the calendar. */
export async function planDays(from: string, to: string): Promise<{ plans: DayPlan[]; rows: BookingRow[] }> {
  const [rows, off] = await Promise.all([
    listBookings(and(gte(bookings.date, from), lte(bookings.date, to))),
    db.select().from(blocks).where(and(gte(blocks.date, from), lte(blocks.date, to))),
  ]);
  const plans: DayPlan[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    plans.push(planDay(d, rows, off.filter((b) => b.date === d).map((b) => ({ start: b.startMin, end: b.endMin }))));
  }
  return { plans, rows };
}

export type Suggestion = {
  job: BookingRow;
  toDate: string;
  toStart: number;
  /** The closest job already on that day. */
  near: BookingRow;
  nearMiles: number;
  savedMinutes: number;
};

/** Minimum saving before suggesting that a client be moved to another day. */
const MIN_MOVE_SAVING = 15;

/** The jobs either side of a time on a day, as points (the base when there is none). */
function neighbours(day: BookingRow[], start: number, minutes: number): { prev: Point; next: Point } {
  let prev: Point = BASE;
  let next: Point = BASE;
  let prevEnd = -1;
  let nextStart = Infinity;
  for (const b of day) {
    const p = pointOf(b);
    if (!p) continue;
    if (b.startMin + b.durationMin <= start && b.startMin + b.durationMin > prevEnd) [prev, prevEnd] = [p, b.startMin + b.durationMin];
    if (b.startMin >= start + minutes && b.startMin < nextStart) [next, nextStart] = [p, b.startMin];
  }
  return { prev, next };
}

/**
 * Outlying jobs that would sit better on another day: a job far from everything else on its day,
 * when another day in the next two weeks has the crew working near it and an arrival time free.
 * Only jobs still more than the self-serve cutoff away, and only customer arrival times, so the move
 * is an ordinary booking from the client's side.
 */
export async function suggestMoves(rows?: BookingRow[]): Promise<Suggestion[]> {
  const from = addDays(today(), 1);
  const to = addDays(today(), SCHEDULE.horizonDays - 1);
  const all = rows ?? (await listBookings(and(gte(bookings.date, from), lte(bookings.date, to), inArray(bookings.status, ['confirmed', 'completed']))));
  const live = all.filter((b) => b.date >= from && b.date <= to && (b.status === 'confirmed' || b.status === 'completed'));
  const byDay = new Map<string, BookingRow[]>();
  for (const b of live) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);

  const out: Suggestion[] = [];
  for (const job of live) {
    const p = pointOf(job);
    if (!p || job.status !== 'confirmed' || hoursUntil(job.date, job.startMin) < SCHEDULE.cancelCutoffHours) continue;
    const sameDay = (byDay.get(job.date) ?? []).filter((b) => b.id !== job.id);
    if (sameDay.some((b) => pointOf(b) && miles(p, pointOf(b)!) <= NEARBY_MILES)) continue; // already grouped

    // Days with someone nearby. Only worth an availability lookup if there are any.
    const candidates = [...byDay].filter(([d, day]) => d !== job.date && day.some((b) => pointOf(b) && miles(p, pointOf(b)!) <= NEARBY_MILES));
    if (!candidates.length) continue;

    const here = neighbours(sameDay, job.startMin, job.durationMin);
    const gain = detour(p, here.prev, here.next);
    const days = await getAvailability(job.durationMin, { from, days: SCHEDULE.horizonDays - 1, excludeBookingId: job.id });

    let best: Suggestion | null = null;
    for (const [d, day] of candidates) {
      const open = days.find((x) => x.date === d)?.slots.filter((s) => s.state === 'open') ?? [];
      for (const s of open) {
        if (hoursUntil(d, s.start) < SCHEDULE.cancelCutoffHours) continue;
        const there = neighbours(day, s.start, job.durationMin);
        const savedMinutes = gain - detour(p, there.prev, there.next);
        const near = day.filter((b) => pointOf(b)).sort((a, b) => miles(p, pointOf(a)!) - miles(p, pointOf(b)!))[0];
        const better =
          !best || savedMinutes > best.savedMinutes || (savedMinutes === best.savedMinutes && Math.abs(Date.parse(d) - Date.parse(job.date)) < Math.abs(Date.parse(best.toDate) - Date.parse(job.date)));
        if (better) best = { job, toDate: d, toStart: s.start, near, nearMiles: miles(p, pointOf(near)!), savedMinutes };
      }
    }
    if (best && best.savedMinutes >= MIN_MOVE_SAVING) out.push(best);
  }
  // Two lone jobs near each other suggest each other ("move A to B's day", "move B to A's day").
  // Moving one is enough, so keep the first of such a pair.
  const kept: Suggestion[] = [];
  for (const s of out.sort((a, b) => b.savedMinutes - a.savedMinutes || a.job.date.localeCompare(b.job.date))) {
    if (!kept.some((k) => k.job.id === s.near.id || k.near.id === s.job.id)) kept.push(s);
  }
  return kept.slice(0, 8);
}

/** A Google Maps link that drives the day in order, starting and ending at the base. */
export function mapsRouteUrl(addresses: string[]): string {
  const q = new URLSearchParams({ api: '1', origin: BASE.address, destination: BASE.address, travelmode: 'driving' });
  if (addresses.length) q.set('waypoints', addresses.slice(0, 9).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}

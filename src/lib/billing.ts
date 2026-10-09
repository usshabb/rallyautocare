import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { db, type Db, type Tx } from './db';
import { bookings, charges, memberships, type Membership } from './db/schema';
import { findPlan, planMonthly, type PaymentMethod } from './catalog';
import { DomainError } from './errors';
import { newId } from './ids';
import { addMonths, fmtDatePlain, today } from './time';

type Conn = Db | Tx;

/** The billing period a date falls in, counted in whole months from the day the membership started. */
export function periodFor(startedOn: string, date: string): { start: string; end: string } | null {
  if (date < startedOn) return null;
  let n = 0;
  while (n < 600 && addMonths(startedOn, n + 1) <= date) n++;
  return { start: addMonths(startedOn, n), end: addMonths(startedOn, n + 1) };
}

/**
 * The billing period that starts closest to a date. Stripe's renewal dates drift a little from the
 * app's: a member who started on Jan 31 has periods starting Feb 28, Mar 31, Apr 30, while Stripe —
 * anchored on Feb 28 — renews on the 28th every month. Recording each Stripe invoice against the
 * nearest period keeps one row per month, so a month paid by card is never billed again.
 */
export function nearestPeriodStart(startedOn: string, date: string): string {
  const period = periodFor(startedOn, date);
  if (!period) return startedOn;
  const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b));
  return gap(period.start, date) <= gap(period.end, date) ? period.start : period.end;
}

/**
 * Makes sure an active membership has a charge for every billing period up to today.
 * There is no scheduler yet, so this runs whenever a membership is read; the unique
 * (membership, period) index makes it safe to call as often as needed.
 */
export async function syncMembershipCharges(conn: Conn, m: Membership): Promise<void> {
  if (m.status !== 'active' || !m.startedOn) return;
  const plan = findPlan(m.planId);
  const now = today();
  const rows = [];
  for (let n = 0; n < 600; n++) {
    const start = addMonths(m.startedOn, n);
    if (start > now) break;
    // With autopay on, Stripe bills these periods and the webhook records them as they are paid.
    if (m.stripeSubscriptionId && m.autopayFrom && start >= m.autopayFrom) break;
    rows.push({
      id: newId(),
      userId: m.userId,
      membershipId: m.id,
      kind: 'membership' as const,
      description: `${plan?.name ?? 'Membership'} · month starting ${fmtDatePlain(start)}`,
      amountCents: m.priceCents,
      periodStart: start,
    });
  }
  if (rows.length) await conn.insert(charges).values(rows).onConflictDoNothing();
}

/** A user's memberships with billing brought up to date. */
export async function loadMemberships(userId: string): Promise<Membership[]> {
  const rows = await db.select().from(memberships).where(eq(memberships.userId, userId)).orderBy(memberships.createdAt);
  for (const m of rows) await syncMembershipCharges(db, m);
  return rows;
}

export async function syncAllMemberships(): Promise<void> {
  const rows = await db.select().from(memberships).where(eq(memberships.status, 'active'));
  for (const m of rows) await syncMembershipCharges(db, m);
}

/** Starts monthly billing. Called when the initial detail is completed, or by an admin who waives it. */
export async function activateMembership(conn: Conn, membershipId: string, startedOn = today()): Promise<void> {
  const [m] = await conn.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m || m.status !== 'pending') return;
  const start = startedOn > today() ? today() : startedOn;
  await conn.update(memberships).set({ status: 'active', startedOn: start }).where(eq(memberships.id, m.id));
  await syncMembershipCharges(conn, { ...m, status: 'active', startedOn: start });
}

/** No contract: cancelling stops future billing and clears upcoming visits. Charges already issued stay. */
export async function cancelMembership(membershipId: string, userId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!m || (userId && m.userId !== userId)) throw new DomainError('Membership not found.');
    if (m.status === 'cancelled') return;
    await syncMembershipCharges(tx, m); // bill any period that has already started
    const now = Date.now();
    await tx.update(memberships).set({ status: 'cancelled', cancelledAt: now }).where(eq(memberships.id, m.id));
    const upcoming = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.membershipId, m.id), eq(bookings.status, 'confirmed'), gte(bookings.date, today())));
    if (upcoming.length) {
      const ids = upcoming.map((b) => b.id);
      await tx.update(bookings).set({ status: 'cancelled', cancelledAt: now }).where(inArray(bookings.id, ids));
      await tx.update(charges).set({ status: 'void' }).where(and(inArray(charges.bookingId, ids), eq(charges.status, 'due')));
    }
  });
}

/** Switches plan. The new price applies from the next billing period. */
export async function changePlan(membershipId: string, planId: string, userId?: string): Promise<void> {
  if (!findPlan(planId)) throw new DomainError('Unknown plan.');
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!m || (userId && m.userId !== userId) || m.status === 'cancelled') throw new DomainError('Membership not found.');
  await syncMembershipCharges(db, m); // periods already started keep the old price
  await db.update(memberships).set({ planId, priceCents: planMonthly(planId, m.size) }).where(eq(memberships.id, m.id));
}

/** Included visits already used (booked or done) in the billing period containing `date`. */
export async function visitsInPeriod(conn: Conn, m: Membership, date: string, excludeBookingId?: string): Promise<{ used: number; allowed: number; period: { start: string; end: string } } | null> {
  if (!m.startedOn) return null;
  const period = periodFor(m.startedOn, date);
  if (!period) return null;
  const [row] = await conn
    .select({ n: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.membershipId, m.id),
        eq(bookings.kind, 'visit'),
        inArray(bookings.status, ['confirmed', 'completed', 'no_show']),
        gte(bookings.date, period.start),
        lt(bookings.date, period.end),
        excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
      ),
    );
  return { used: Number(row?.n ?? 0), allowed: findPlan(m.planId)?.visits ?? 0, period };
}

// ── Charges ────────────────────────────────────────────────────────────────

export async function addCharge(
  conn: Conn,
  input: { userId: string; bookingId?: string | null; kind: 'service' | 'deposit'; description: string; amountCents: number },
): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new DomainError('Enter an amount greater than $0.');
  await conn.insert(charges).values({ id: newId(), ...input, bookingId: input.bookingId ?? null });
}

export async function markChargePaid(chargeId: string, method: PaymentMethod): Promise<void> {
  await db.update(charges).set({ status: 'paid', method, paidAt: Date.now() }).where(and(eq(charges.id, chargeId), eq(charges.status, 'due')));
}

/** Undo for a payment recorded by mistake. */
export async function markChargeDue(chargeId: string): Promise<void> {
  await db.update(charges).set({ status: 'due', method: null, paidAt: null }).where(and(eq(charges.id, chargeId), eq(charges.status, 'paid')));
}

export async function voidCharge(chargeId: string): Promise<void> {
  await db.update(charges).set({ status: 'void' }).where(and(eq(charges.id, chargeId), eq(charges.status, 'due')));
}

export async function updateCharge(chargeId: string, patch: { amountCents?: number; payLink?: string }): Promise<void> {
  if (patch.amountCents !== undefined && (!Number.isInteger(patch.amountCents) || patch.amountCents <= 0)) {
    throw new DomainError('Enter an amount greater than $0.');
  }
  await db.update(charges).set(patch).where(and(eq(charges.id, chargeId), eq(charges.status, 'due')));
}

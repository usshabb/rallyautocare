import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, type Tx } from './db';
import { bookings, charges, memberships, vehicles, type Booking, type Vehicle } from './db/schema';
import { findAddon, findPlan, planMonthly, priceVisit, serviceInfo, type BookingKind, type Size } from './catalog';
import { SCHEDULE, slotProblem } from './availability';
import { activateMembership, visitsInPeriod } from './billing';
import { DomainError } from './errors';
import { bookingCode, newId } from './ids';
import { hoursUntil, isDate, today } from './time';

export type VehicleChoice = { vehicleId?: string; label?: string; size: Size };

export type BookingRequest = {
  userId: string;
  vehicle: VehicleChoice;
  addonIds: string[];
  date: string;
  startMin: number;
  address: string;
  notes?: string;
  createdBy: 'customer' | 'admin';
};

/** Uses a saved vehicle (which must belong to the user) or saves a new one. */
async function resolveVehicle(tx: Tx, userId: string, choice: VehicleChoice): Promise<Vehicle> {
  if (choice.vehicleId) {
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, choice.vehicleId), eq(vehicles.userId, userId)));
    if (!v) throw new DomainError('Vehicle not found.');
    return v;
  }
  const label = (choice.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (label.length < 2) throw new DomainError('Tell us the vehicle — year, make and model.');
  const [same] = await tx
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.userId, userId), eq(vehicles.size, choice.size), eq(vehicles.archived, false), sql`lower(${vehicles.label}) = ${label.toLowerCase()}`));
  if (same) return same;
  const [created] = await tx.insert(vehicles).values({ id: newId(), userId, label, size: choice.size }).returning();
  return created;
}

async function insertBooking(
  tx: Tx,
  input: { userId: string; vehicle: Vehicle; membershipId?: string; kind: BookingKind; serviceId: string } & Pick<BookingRequest, 'addonIds' | 'date' | 'startMin' | 'address' | 'notes' | 'createdBy'>,
): Promise<Booking> {
  const info = serviceInfo(input.kind, input.serviceId);
  const price = priceVisit({ kind: input.kind, serviceId: input.serviceId, size: input.vehicle.size, addonIds: input.addonIds });
  if (!info || !price) throw new DomainError('That service is not available.');
  if (!isDate(input.date)) throw new DomainError('Pick a day.');
  const address = input.address.trim().slice(0, 200);
  if (address.length < 5) throw new DomainError('Enter the address where we should meet you.');

  const problem = await slotProblem(tx, { date: input.date, start: input.startMin, minutes: info.minutes, admin: input.createdBy === 'admin' });
  if (problem) throw new DomainError(problem);

  let code = bookingCode();
  while ((await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.code, code))).length) code = bookingCode();

  const [row] = await tx
    .insert(bookings)
    .values({
      id: newId(),
      code,
      userId: input.userId,
      vehicleId: input.vehicle.id,
      membershipId: input.membershipId ?? null,
      kind: input.kind,
      serviceId: input.serviceId,
      size: input.vehicle.size,
      addons: input.addonIds.filter((id, i, all) => !!findAddon(id) && all.indexOf(id) === i),
      date: input.date,
      startMin: input.startMin,
      durationMin: info.minutes,
      address,
      notes: (input.notes ?? '').trim().slice(0, 500),
      estimateCents: price.total,
      createdBy: input.createdBy,
    })
    .returning();
  return row;
}

/** Books a one-time detail. */
export async function bookDetail(req: BookingRequest & { serviceId: string }): Promise<Booking> {
  return db.transaction(async (tx) => {
    const vehicle = await resolveVehicle(tx, req.userId, req.vehicle);
    return insertBooking(tx, { ...req, vehicle, kind: 'detail' });
  });
}

/** Starts a membership: one vehicle on one plan, pending until its initial detail is done. */
export async function joinMembership(req: BookingRequest & { planId: string }): Promise<Booking> {
  if (!findPlan(req.planId)) throw new DomainError('That plan is not available.');
  return db.transaction(async (tx) => {
    const vehicle = await resolveVehicle(tx, req.userId, req.vehicle);
    const [live] = await tx.select().from(memberships).where(and(eq(memberships.vehicleId, vehicle.id), ne(memberships.status, 'cancelled')));
    if (live) throw new DomainError('That vehicle is already on a membership. Manage it from your account.');
    const [m] = await tx
      .insert(memberships)
      .values({ id: newId(), userId: req.userId, vehicleId: vehicle.id, planId: req.planId, size: vehicle.size, priceCents: planMonthly(req.planId, vehicle.size) })
      .returning();
    return insertBooking(tx, { ...req, vehicle, membershipId: m.id, kind: 'initial', serviceId: req.planId });
  });
}

/** Schedules the next thing a membership needs: its initial detail while pending, otherwise an included visit. */
export async function bookMembershipVisit(req: Omit<BookingRequest, 'vehicle'> & { membershipId: string; admin?: boolean }): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, req.membershipId));
    if (!m || (!req.admin && m.userId !== req.userId) || m.status === 'cancelled') throw new DomainError('Membership not found.');
    const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, m.vehicleId));
    const base = { ...req, userId: m.userId, vehicle, membershipId: m.id, serviceId: m.planId };

    if (m.status === 'pending') {
      const [open] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.membershipId, m.id), eq(bookings.kind, 'initial'), eq(bookings.status, 'confirmed')));
      if (open) throw new DomainError('Your initial detail is already scheduled.');
      return insertBooking(tx, { ...base, kind: 'initial' });
    }

    const usage = await visitsInPeriod(tx, m, req.date);
    if (!usage) throw new DomainError('Pick a day after your membership started.');
    if (usage.used >= usage.allowed) {
      throw new DomainError(`Your plan includes ${usage.allowed} ${usage.allowed === 1 ? 'visit' : 'visits'} per month and that month is full. Pick a later day.`);
    }
    return insertBooking(tx, { ...base, kind: 'visit' });
  });
}

type Actor = { userId: string; admin: boolean };

async function loadOwned(tx: Tx, bookingId: string, actor: Actor): Promise<Booking> {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || (!actor.admin && b.userId !== actor.userId)) throw new DomainError('Booking not found.');
  return b;
}

/** Customers can change or cancel online until the cutoff; after that they need to call. */
export const canSelfServe = (b: Pick<Booking, 'status' | 'date' | 'startMin'>) =>
  b.status === 'confirmed' && hoursUntil(b.date, b.startMin) >= SCHEDULE.cancelCutoffHours;

export async function rescheduleBooking(bookingId: string, date: string, startMin: number, actor: Actor): Promise<Booking> {
  return db.transaction(async (tx) => {
    const b = await loadOwned(tx, bookingId, actor);
    if (b.status !== 'confirmed') throw new DomainError('Only upcoming bookings can be moved.');
    if (!actor.admin && !canSelfServe(b)) throw new DomainError(`It's within ${SCHEDULE.cancelCutoffHours} hours of your appointment — call us to make changes.`);
    if (!isDate(date)) throw new DomainError('Pick a day.');
    const problem = await slotProblem(tx, { date, start: startMin, minutes: b.durationMin, excludeBookingId: b.id, admin: actor.admin });
    if (problem) throw new DomainError(problem);
    if (b.kind === 'visit' && b.membershipId) {
      const [m] = await tx.select().from(memberships).where(eq(memberships.id, b.membershipId));
      const usage = m ? await visitsInPeriod(tx, m, date, b.id) : null;
      if (!usage || usage.used >= usage.allowed) throw new DomainError('That month already has all the visits your plan includes. Pick another day.');
    }
    const [row] = await tx.update(bookings).set({ date, startMin }).where(eq(bookings.id, b.id)).returning();
    return row;
  });
}

export async function cancelBooking(bookingId: string, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const b = await loadOwned(tx, bookingId, actor);
    if (b.status !== 'confirmed') return;
    if (!actor.admin && !canSelfServe(b)) throw new DomainError(`It's within ${SCHEDULE.cancelCutoffHours} hours of your appointment — call us to cancel.`);
    await tx.update(bookings).set({ status: 'cancelled', cancelledAt: Date.now() }).where(eq(bookings.id, b.id));
    await tx.update(charges).set({ status: 'void' }).where(and(eq(charges.bookingId, b.id), eq(charges.status, 'due')));
  });
}

export async function markNoShow(bookingId: string): Promise<void> {
  await db.update(bookings).set({ status: 'no_show' }).where(and(eq(bookings.id, bookingId), eq(bookings.status, 'confirmed')));
}

/**
 * Marks the job done at its final price and bills whatever isn't already covered by a deposit.
 * Completing a member's initial detail starts their membership.
 */
export async function completeBooking(bookingId: string, finalCents: number): Promise<void> {
  if (!Number.isInteger(finalCents) || finalCents < 0) throw new DomainError('Enter the final price.');
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!b) throw new DomainError('Booking not found.');
    if (b.status !== 'confirmed') throw new DomainError('This booking is already closed.');
    if (b.date > today()) throw new DomainError("This job hasn't happened yet.");
    await tx.update(bookings).set({ status: 'completed', finalCents }).where(eq(bookings.id, b.id));

    const billed = await tx
      .select({ amount: charges.amountCents })
      .from(charges)
      .where(and(eq(charges.bookingId, b.id), inArray(charges.status, ['due', 'paid'])));
    const remaining = finalCents - billed.reduce((t, c) => t + c.amount, 0);
    if (remaining > 0) {
      const info = serviceInfo(b.kind, b.serviceId);
      await tx.insert(charges).values({ id: newId(), userId: b.userId, bookingId: b.id, kind: 'service', description: `${info?.name ?? 'Detail'} · ${b.code}`, amountCents: remaining });
    }
    if (b.kind === 'initial' && b.membershipId) await activateMembership(tx, b.membershipId, b.date);
  });
}

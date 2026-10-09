import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { bookings, charges, memberships, users, vehicles, type Booking, type Charge, type Membership, type Vehicle } from './db/schema';
import { serviceInfo } from './catalog';

export type BookingRow = Booking & {
  serviceName: string;
  customerName: string;
  customerPhone: string;
  vehicleLabel: string;
  charges: Charge[];
  pay: PayState;
};

export type PayState = { state: 'none' | 'due' | 'paid'; dueCents: number; paidCents: number };

/** Rolls a booking's (or any set of) charges up into what is owed and what has been received. */
export function payState(list: Charge[]): PayState {
  const dueCents = list.filter((c) => c.status === 'due').reduce((t, c) => t + c.amountCents, 0);
  const paidCents = list.filter((c) => c.status === 'paid').reduce((t, c) => t + c.amountCents, 0);
  return { state: dueCents > 0 ? 'due' : paidCents > 0 ? 'paid' : 'none', dueCents, paidCents };
}

/** Bookings joined with their customer, vehicle and charges. */
export async function listBookings(where?: SQL, order: 'asc' | 'desc' = 'asc', limit = 500): Promise<BookingRow[]> {
  const dir = order === 'asc' ? asc : desc;
  const rows = await db
    .select({ b: bookings, customerName: users.name, customerPhone: users.phone, vehicleLabel: vehicles.label })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.userId))
    .innerJoin(vehicles, eq(vehicles.id, bookings.vehicleId))
    .where(where)
    .orderBy(dir(bookings.date), dir(bookings.startMin))
    .limit(limit);
  if (!rows.length) return [];
  const all = await db.select().from(charges).where(inArray(charges.bookingId, rows.map((r) => r.b.id)));
  return rows.map((r) => {
    const own = all.filter((c) => c.bookingId === r.b.id && c.status !== 'void');
    return {
      ...r.b,
      serviceName: serviceInfo(r.b.kind, r.b.serviceId)?.name ?? 'Detail',
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      vehicleLabel: r.vehicleLabel,
      charges: own,
      pay: payState(own),
    };
  });
}

export async function getBooking(id: string): Promise<BookingRow | null> {
  return (await listBookings(eq(bookings.id, id)))[0] ?? null;
}

export async function listVehicles(userId: string): Promise<Vehicle[]> {
  return db.select().from(vehicles).where(and(eq(vehicles.userId, userId), eq(vehicles.archived, false))).orderBy(asc(vehicles.createdAt));
}

export async function listCharges(where?: SQL): Promise<Charge[]> {
  return db.select().from(charges).where(where).orderBy(desc(charges.createdAt));
}

/** Total currently owed by a customer. */
export async function balanceDue(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${charges.amountCents}), 0)` })
    .from(charges)
    .where(and(eq(charges.userId, userId), eq(charges.status, 'due')));
  return Number(row?.total ?? 0);
}

export type MembershipRow = Membership & { vehicleLabel: string; customerName: string; customerPhone: string };

export async function listMemberships(where?: SQL): Promise<MembershipRow[]> {
  const rows = await db
    .select({ m: memberships, vehicleLabel: vehicles.label, customerName: users.name, customerPhone: users.phone })
    .from(memberships)
    .innerJoin(vehicles, eq(vehicles.id, memberships.vehicleId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(desc(memberships.createdAt));
  return rows.map((r) => ({ ...r.m, vehicleLabel: r.vehicleLabel, customerName: r.customerName, customerPhone: r.customerPhone }));
}

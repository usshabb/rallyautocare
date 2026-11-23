'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { currentUser, findOrCreateUser, startSession, verifyOtp } from '@/lib/auth';
import { bookDetail, bookMembershipVisit, cancelBooking, joinMembership, rescheduleBooking } from '@/lib/bookings';
import { db } from '@/lib/db';
import { bookings, users, type Booking } from '@/lib/db/schema';
import { DomainError } from '@/lib/errors';
import { geocode } from '@/lib/geo';
import { notifyBooking } from '@/lib/notify';
import { isEmail, normalizePhone } from '@/lib/phone';
import { run, type ActionState } from './result';

const slot = { date: z.string(), startMin: z.number().int() };

const bookingInput = z.object({
  mode: z.enum(['detail', 'member']),
  serviceId: z.string(),
  size: z.enum(['car', 'suv']),
  addonIds: z.array(z.string()).max(10),
  ...slot,
  address: z.string().max(200),
  notes: z.string().max(500).optional(),
  vehicleId: z.string().optional(),
  vehicleLabel: z.string().max(80).optional(),
  // Signed-out customers verify their number as part of confirming.
  name: z.string().max(80).optional(),
  email: z.string().max(120).optional(),
  phone: z.string().optional(),
  code: z.string().optional(),
  // Admins booking on a client's behalf. They may not have the client's email yet.
  forCustomer: z.object({ phone: z.string(), name: z.string().max(80), email: z.string().max(120).optional() }).optional(),
});

export type BookingResult =
  | { ok: true; id: string; code: string; date: string; startMin: number }
  | { ok: false; error: string };

const done = (b: Booking): BookingResult => ({ ok: true, id: b.id, code: b.code, date: b.date, startMin: b.startMin });

export async function submitBooking(raw: z.input<typeof bookingInput>): Promise<BookingResult> {
  const parsed = bookingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Something in the form is missing. Check it and try again.' };
  const input = parsed.data;

  try {
    let user = await currentUser();
    let customerId: string;
    let createdBy: 'customer' | 'admin' = 'customer';

    if (input.forCustomer) {
      if (!user?.isAdmin) return { ok: false, error: 'Not allowed.' };
      const phone = normalizePhone(input.forCustomer.phone);
      if (!phone) return { ok: false, error: "Enter the client's 10-digit mobile number." };
      const clientEmail = (input.forCustomer.email ?? '').trim();
      if (clientEmail && !isEmail(clientEmail)) return { ok: false, error: "That email address looks off." };
      customerId = (await findOrCreateUser(phone, input.forCustomer.name.trim(), clientEmail)).id;
      createdBy = 'admin';
    } else {
      if (!user) {
        const phone = normalizePhone(input.phone ?? '');
        if (!phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
        const email = (input.email ?? '').trim();
        if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
        if (!(await verifyOtp(phone, input.code ?? ''))) return { ok: false, error: "That code didn't match. Check it and try again." };
        const created = await findOrCreateUser(phone, (input.name ?? '').trim(), email);
        await startSession(created.id);
        user = { ...created, isAdmin: false };
      }
      customerId = user.id;
    }

    const request = {
      place: await geocode(input.address),
      userId: customerId,
      vehicle: { vehicleId: input.vehicleId, label: input.vehicleLabel, size: input.size },
      addonIds: input.addonIds,
      date: input.date,
      startMin: input.startMin,
      address: input.address,
      notes: input.notes,
      createdBy,
    };
    const booking = input.mode === 'member' ? await joinMembership({ ...request, planId: input.serviceId }) : await bookDetail({ ...request, serviceId: input.serviceId });

    // Remember the name and address so the next booking is quicker.
    const [customer] = await db.select().from(users).where(eq(users.id, customerId));
    const patch: { name?: string; address?: string } = {};
    if (!customer.name && input.name?.trim()) patch.name = input.name.trim();
    if (!customer.address) patch.address = booking.address;
    if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, customerId));

    after(() => notifyBooking(booking.id, 'confirmation'));
    revalidatePath('/', 'layout');
    return done(booking);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

const visitInput = z.object({
  membershipId: z.string(),
  ...slot,
  address: z.string().max(200),
  addonIds: z.array(z.string()).max(10),
  notes: z.string().max(500).optional(),
});

export async function scheduleVisit(raw: z.input<typeof visitInput>): Promise<BookingResult> {
  const user = await currentUser();
  const parsed = visitInput.safeParse(raw);
  if (!user || !parsed.success) return { ok: false, error: 'Something in the form is missing. Check it and try again.' };
  try {
    const place = await geocode(parsed.data.address);
    const booking = await bookMembershipVisit({ ...parsed.data, place, userId: user.id, admin: user.isAdmin, createdBy: user.isAdmin ? 'admin' : 'customer' });
    after(() => notifyBooking(booking.id, 'confirmation'));
    revalidatePath('/', 'layout');
    return done(booking);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function reschedule(raw: { bookingId: string; date: string; startMin: number }): Promise<BookingResult> {
  const user = await currentUser();
  const parsed = z.object({ bookingId: z.string(), ...slot }).safeParse(raw);
  if (!user || !parsed.success) return { ok: false, error: 'Pick a day and time.' };
  try {
    const [before] = await db.select({ date: bookings.date, startMin: bookings.startMin }).from(bookings).where(eq(bookings.id, parsed.data.bookingId));
    const b = await rescheduleBooking(parsed.data.bookingId, parsed.data.date, parsed.data.startMin, { userId: user.id, admin: user.isAdmin });
    if (before && (before.date !== b.date || before.startMin !== b.startMin)) after(() => notifyBooking(b.id, 'rescheduled'));
    revalidatePath('/', 'layout');
    return done(b);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function cancel(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in again to continue.' };
  const bookingId = String(form.get('bookingId'));
  const [before] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  const result = await run(() => cancelBooking(bookingId, { userId: user.id, admin: user.isAdmin }));
  if (result.ok && before?.status === 'confirmed') after(() => notifyBooking(bookingId, 'cancelled'));
  return result;
}

'use server';

import { eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth';
import { activateMembership, addCharge, markChargeDue, markChargePaid, updateCharge, voidCharge } from '@/lib/billing';
import { completeBooking, markNoShow } from '@/lib/bookings';
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/catalog';
import { db } from '@/lib/db';
import { blocks, bookings, charges, leads, users } from '@/lib/db/schema';
import { DomainError } from '@/lib/errors';
import { newId } from '@/lib/ids';
import { releaseCharge } from '@/lib/stripe';
import { isDate } from '@/lib/time';
import { cents, run, str, type ActionState } from './result';

/** Before a charge is settled by hand, voided or repriced, close any card link the client could still pay. */
async function release(chargeId: string): Promise<void> {
  const [charge] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (charge?.status === 'due') await releaseCharge(charge);
}

/** Every admin action goes through here so none can run without the admin check. */
async function asAdmin(fn: () => Promise<unknown>): Promise<ActionState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: 'Not allowed.' };
  return run(fn);
}

export async function completeJob(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => completeBooking(str(form, 'bookingId'), cents(str(form, 'final'))));
}

export async function noShow(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => markNoShow(str(form, 'bookingId')));
}

export async function saveJobNotes(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => db.update(bookings).set({ adminNotes: str(form, 'adminNotes').slice(0, 1000) }).where(eq(bookings.id, str(form, 'bookingId'))));
}

export async function requestCharge(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, str(form, 'bookingId')));
    if (!b) throw new DomainError('Booking not found.');
    const kind = str(form, 'kind') === 'deposit' ? 'deposit' : 'service';
    const description = str(form, 'description').slice(0, 120) || `${kind === 'deposit' ? 'Deposit' : 'Additional charge'} · ${b.code}`;
    await addCharge(db, { userId: b.userId, bookingId: b.id, kind, description, amountCents: cents(str(form, 'amount')) });
  });
}

export async function recordPayment(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    const method = str(form, 'method') as PaymentMethod;
    if (!PAYMENT_METHODS.some((m) => m.id === method)) throw new DomainError('Choose how it was paid.');
    await release(str(form, 'chargeId'));
    await markChargePaid(str(form, 'chargeId'), method);
  });
}

export async function undoPayment(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => markChargeDue(str(form, 'chargeId')));
}

export async function voidDue(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    await release(str(form, 'chargeId'));
    await voidCharge(str(form, 'chargeId'));
  });
}

export async function editCharge(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    const payLink = str(form, 'payLink').slice(0, 500);
    if (payLink && !/^https:\/\//i.test(payLink)) throw new DomainError('The payment link must start with https://');
    const [charge] = await db.select().from(charges).where(eq(charges.id, str(form, 'chargeId')));
    if (!charge) throw new DomainError('Charge not found.');
    const amountCents = cents(str(form, 'amount'));
    const amountChanged = charge.amountCents !== amountCents;
    const linkChanged = charge.payLink !== payLink;
    // A Stripe link is for a fixed amount, so changing the amount (or swapping the link) retires it.
    if (amountChanged || linkChanged) await release(charge.id);
    const retired = !!charge.stripeInvoiceId && amountChanged && !linkChanged;
    await updateCharge(charge.id, { payLink: retired ? '' : payLink, amountCents });
  });
}

export async function saveClient(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() =>
    db
      .update(users)
      .set({
        name: str(form, 'name').slice(0, 80),
        email: str(form, 'email').slice(0, 120),
        address: str(form, 'address').slice(0, 200),
        adminNotes: str(form, 'adminNotes').slice(0, 2000),
      })
      .where(eq(users.id, str(form, 'userId'))),
  );
}

export async function startMembershipNow(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => db.transaction((tx) => activateMembership(tx, str(form, 'membershipId'))));
}

export async function blockTime(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    const date = str(form, 'date');
    if (!isDate(date)) throw new DomainError('Pick a day to block.');
    const allDay = str(form, 'allDay') === 'on';
    const startMin = allDay ? 0 : Number(str(form, 'start'));
    const endMin = allDay ? 24 * 60 : Number(str(form, 'end'));
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || endMin <= startMin) throw new DomainError('The end time must be after the start time.');
    await db.insert(blocks).values({ id: newId(), date, startMin, endMin, reason: str(form, 'reason').slice(0, 120) });
  });
}

export async function unblockTime(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(() => db.delete(blocks).where(eq(blocks.id, str(form, 'blockId'))));
}

export async function setLeadStatus(_prev: ActionState, form: FormData): Promise<ActionState> {
  return asAdmin(async () => {
    const status = str(form, 'status');
    if (status !== 'new' && status !== 'contacted' && status !== 'closed') throw new DomainError('Unknown status.');
    await db.update(leads).set({ status }).where(eq(leads.id, str(form, 'leadId')));
  });
}

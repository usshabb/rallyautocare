'use server';

import { and, eq, ne } from 'drizzle-orm';
import { currentUser } from '@/lib/auth';
import { cancelMembership, changePlan } from '@/lib/billing';
import { db } from '@/lib/db';
import { memberships, users, vehicles } from '@/lib/db/schema';
import { DomainError } from '@/lib/errors';
import { newId } from '@/lib/ids';
import { isEmail } from '@/lib/phone';
import { stopAutopay, stripe, stripeEnabled, syncSubscriptionPlan } from '@/lib/stripe';
import { run, str, type ActionState } from './result';

const signedOut: ActionState = { error: 'Sign in again to continue.' };

export async function updateProfile(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return signedOut;
  return run(async () => {
    const name = str(form, 'name').slice(0, 80);
    const email = str(form, 'email').slice(0, 120);
    if (!name) throw new DomainError('Enter your name.');
    if (!isEmail(email)) throw new DomainError('Enter a valid email address.');
    await db.update(users).set({ name, email, address: str(form, 'address').slice(0, 200) }).where(eq(users.id, user.id));
    // Receipts and invoices go to the address Stripe has, so keep it in step.
    if (stripeEnabled() && user.stripeCustomerId) await stripe().customers.update(user.stripeCustomerId, { name, email }).catch(() => undefined);
  });
}

export async function addVehicle(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return signedOut;
  return run(async () => {
    const label = str(form, 'label').replace(/\s+/g, ' ').slice(0, 80);
    if (label.length < 2) throw new DomainError('Enter the year, make and model.');
    await db.insert(vehicles).values({ id: newId(), userId: user.id, label, size: str(form, 'size') === 'suv' ? 'suv' : 'car' });
  });
}

export async function removeVehicle(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return signedOut;
  return run(async () => {
    const id = str(form, 'vehicleId');
    const [live] = await db.select().from(memberships).where(and(eq(memberships.vehicleId, id), ne(memberships.status, 'cancelled')));
    if (live) throw new DomainError('This vehicle is on a membership. Cancel the membership first.');
    // Archived rather than deleted so past bookings still show what was serviced.
    await db.update(vehicles).set({ archived: true }).where(and(eq(vehicles.id, id), eq(vehicles.userId, user.id)));
  });
}

export async function cancelMyMembership(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return signedOut;
  return run(async () => {
    const id = str(form, 'membershipId');
    await cancelMembership(id, user.isAdmin ? undefined : user.id);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
    if (m) await stopAutopay(m); // stop Stripe billing the card for a membership that no longer exists
  });
}

export async function switchPlan(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return signedOut;
  return run(async () => {
    const id = str(form, 'membershipId');
    await changePlan(id, str(form, 'planId'), user.isAdmin ? undefined : user.id);
    const [m] = await db.select().from(memberships).where(eq(memberships.id, id));
    if (m) await syncSubscriptionPlan(m);
  });
}

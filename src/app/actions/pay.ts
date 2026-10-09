'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { charges, memberships, users } from '@/lib/db/schema';
import { appUrl } from '@/lib/env';
import { DomainError } from '@/lib/errors';
import { autopayCheckoutUrl, cardPortalUrl, chargeCheckoutUrl, createPayLink, stopAutopay } from '@/lib/stripe';
import { run, str, type ActionState } from './result';

/** The site's own address, for the page Stripe sends people back to. */
async function origin(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
}

/** Runs something that produces a Stripe URL and sends the browser there; problems come back as a message. */
async function go(make: () => Promise<string>): Promise<ActionState> {
  let url: string;
  try {
    url = await make();
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    if (err instanceof Stripe.errors.StripeError) {
      console.error('[stripe]', err.type, err.code, err.message);
      return { error: 'We couldn’t reach the card processor. Try again in a moment, or pay another way.' };
    }
    throw err;
  }
  redirect(url);
}

export async function payByCard(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in again to continue.' };
  return go(async () => {
    const [charge] = await db.select().from(charges).where(and(eq(charges.id, str(form, 'chargeId')), eq(charges.userId, user.id)));
    if (!charge) throw new DomainError('Charge not found.');
    return chargeCheckoutUrl(charge, user, await origin());
  });
}

async function ownMembership(form: FormData, userId: string, admin: boolean) {
  const [m] = await db.select().from(memberships).where(eq(memberships.id, str(form, 'membershipId')));
  if (!m || (!admin && m.userId !== userId)) throw new DomainError('Membership not found.');
  return m;
}

export async function startAutopay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in again to continue.' };
  return go(async () => autopayCheckoutUrl(await ownMembership(form, user.id, false), user, await origin()));
}

export async function manageCard(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in again to continue.' };
  return go(async () => cardPortalUrl(user, await origin()));
}

export async function turnOffAutopay(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Sign in again to continue.' };
  return run(async () => stopAutopay(await ownMembership(form, user.id, user.isAdmin)));
}

/** Admin: make a card pay link for a charge, to text to the client. */
export async function makeInvoiceLink(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user?.isAdmin) return { error: 'Not allowed.' };
  try {
    return await run(async () => {
      const [charge] = await db.select().from(charges).where(eq(charges.id, str(form, 'chargeId')));
      if (!charge) throw new DomainError('Charge not found.');
      const [client] = await db.select().from(users).where(eq(users.id, charge.userId));
      await createPayLink(charge, client);
    });
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError)) throw err;
    console.error('[stripe]', err.type, err.code, err.message);
    return { error: `Stripe couldn’t create the link: ${err.message}` };
  }
}

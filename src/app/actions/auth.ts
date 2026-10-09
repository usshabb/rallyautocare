'use server';

import { redirect } from 'next/navigation';
import { endSession, findOrCreateUser, isAdminPhone, requestOtp, startSession, verifyOtp } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { isEmail, normalizePhone } from '@/lib/phone';
import { stripe, stripeEnabled } from '@/lib/stripe';

export async function sendCode(rawPhone: string): Promise<{ ok: boolean; error?: string }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
  return requestOtp(phone);
}

export async function signIn(rawPhone: string, code: string, next?: string): Promise<{ ok: boolean; error?: string; redirectTo?: string; needsProfile?: { name: string; email: string } }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: 'Enter a valid 10-digit mobile number.' };
  if (!(await verifyOtp(phone, code))) return { ok: false, error: "That code didn't match. Check it and try again." };
  const user = await findOrCreateUser(phone);
  await startSession(user.id);
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const admin = isAdminPhone(phone);
  // A number we haven't seen before is a new account: it still needs a name and an email.
  // Whatever the account already has (say, a name the crew entered) is sent back so it isn't asked for twice.
  const needsProfile = !admin && (!user.name || !user.email) ? { name: user.name, email: user.email } : undefined;
  return { ok: true, redirectTo: safeNext ?? (admin ? '/admin' : '/account'), needsProfile };
}

/** Last step of creating an account: the name and email that go with the verified phone number. */
export async function finishSignup(name: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'Sign in again to continue.' };
  const cleanName = name.trim().slice(0, 80);
  const cleanEmail = email.trim().slice(0, 120);
  if (cleanName.length < 2) return { ok: false, error: 'Enter your name.' };
  if (!isEmail(cleanEmail)) return { ok: false, error: 'Enter a valid email address.' };
  await db.update(users).set({ name: cleanName, email: cleanEmail }).where(eq(users.id, user.id));
  // A client the crew billed before they had an account already exists in Stripe; give it the email too.
  if (stripeEnabled() && user.stripeCustomerId) await stripe().customers.update(user.stripeCustomerId, { name: cleanName, email: cleanEmail }).catch(() => undefined);
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect('/');
}

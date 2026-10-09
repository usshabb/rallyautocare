import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, lt } from 'drizzle-orm';
import { db } from './db';
import { otpCodes, sessions, users, type User } from './db/schema';
import { bypassCode } from './env';
import { newId, newToken, otpCode, sha256 } from './ids';
import { normalizePhone } from './phone';
import { sendSms } from './sms';

const COOKIE = 'rly_session';
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;
const OTP_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 20 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const adminPhones = () =>
  (process.env.ADMIN_PHONES ?? '571-420-1217')
    .split(',')
    .map((p) => normalizePhone(p))
    .filter((p): p is string => !!p);

export { bypassCode };

export const isAdminPhone = (phone: string) => adminPhones().includes(phone);

export type SessionUser = User & { isAdmin: boolean };

export async function requestOtp(phone: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  const [existing] = await db.select().from(otpCodes).where(eq(otpCodes.phone, phone));
  if (existing && now - existing.sentAt < OTP_RESEND_MS) return { ok: true }; // just sent one
  const code = otpCode();
  const row = { phone, codeHash: sha256(phone + code), expiresAt: now + OTP_MS, attempts: 0, sentAt: now };
  await db.insert(otpCodes).values(row).onConflictDoUpdate({ target: otpCodes.phone, set: row });
  await sendSms(phone, `${code} is your Rally Auto Care code.`);
  return { ok: true };
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return false;
  if (bypassCode() === clean) return true;
  const [row] = await db.select().from(otpCodes).where(eq(otpCodes.phone, phone));
  if (!row || row.expiresAt < Date.now() || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (row.codeHash !== sha256(phone + clean)) {
    await db.update(otpCodes).set({ attempts: row.attempts + 1 }).where(eq(otpCodes.phone, phone));
    return false;
  }
  await db.delete(otpCodes).where(eq(otpCodes.phone, phone));
  return true;
}

/** Finds the account for a verified phone number, or creates it. Blank name/email on an existing account are filled in. */
export async function findOrCreateUser(phone: string, name = '', email = ''): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.phone, phone));
  if (existing) {
    const patch: { name?: string; email?: string } = {};
    if (!existing.name && name) patch.name = name;
    if (!existing.email && email) patch.email = email;
    if (!Object.keys(patch).length) return existing;
    await db.update(users).set(patch).where(eq(users.id, existing.id));
    return { ...existing, ...patch };
  }
  const [created] = await db.insert(users).values({ id: newId(), phone, name, email }).returning();
  return created;
}

/** Sets the session cookie. Only callable from a Server Action or Route Handler. */
export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = Date.now() + SESSION_MS;
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

/** The signed-in user for this request, or null. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sha256(token)));
  if (!row || row.expiresAt < Date.now()) return null;
  return { ...row.user, isAdmin: isAdminPhone(row.user.phone) };
});

export async function requireUser(next = '/account'): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser('/admin');
  if (!user.isAdmin) redirect('/account');
  return user;
}

import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './db';
import { bookings, messages, type Message } from './db/schema';
import { BUSINESS, PREP_NOTE, PREP_STEPS } from './catalog';
import { appUrl } from './env';
import { newId } from './ids';
import { getBooking, type BookingRow } from './queries';
import { sendSms, smsConnected } from './sms';
import { addDays, fmtDate, fmtTime, nowLocal } from './time';

// Texts to clients about their bookings. Every one is recorded in `messages`, sent or not, so the crew
// can see what each client was told. A failed text never fails the booking it is about.

export type MessageKind = Message['kind'];

const prepLine = () => `Before we arrive: ${PREP_STEPS.map((s) => s.charAt(0).toLowerCase() + s.slice(1)).join('; ')}. ${PREP_NOTE}`;
const manage = (b: BookingRow) => (appUrl() ? ` Manage it: ${appUrl()}/account/bookings/${b.id}` : '');
const questions = `Questions? Call or text ${BUSINESS.phone}.`;

/** Rounds a minute-of-day to the nearest 5 minutes, for "arriving around 2:35 PM". */
const round5 = (m: number) => Math.round(m / 5) * 5;

export function messageBody(kind: MessageKind, b: BookingRow, extra: { etaMin?: number } = {}): string {
  const when = `${fmtDate(b.date)} at ${fmtTime(b.startMin)}`;
  switch (kind) {
    case 'confirmation':
      return `Rally Auto Care: you're booked for ${b.serviceName} on ${when}, at ${b.address}. ${prepLine()}${manage(b)}`;
    case 'reminder':
      return `Rally Auto Care reminder: ${b.serviceName} ${b.date === nowLocal().date ? 'today' : 'tomorrow'}, ${when}. ${prepLine()} ${questions}`;
    case 'eta': {
      const eta = Math.max(1, Math.round(extra.etaMin ?? 15));
      const arrive = fmtTime(round5(Math.min(nowLocal().minutes + eta, 24 * 60 - 5)));
      return `Rally Auto Care: we're on our way, about ${eta} min out (around ${arrive}). Please have the car unlocked or the keys ready, with personal items, car seats and seat covers out. ${questions}`;
    }
    case 'rescheduled':
      return `Rally Auto Care: your ${b.serviceName} is now on ${when}. ${questions}${manage(b)}`;
    case 'cancelled':
      return `Rally Auto Care: your ${b.serviceName} on ${when} is cancelled. ${appUrl() ? `Book again any time: ${appUrl()}/book. ` : ''}${questions}`;
  }
}

/**
 * Texts a client about a booking. With `dedupeKey`, the text goes out at most once for that key, even
 * if two runs race. Returns the recorded message, or null if it was a duplicate or the booking is gone.
 */
export async function notifyBooking(bookingId: string, kind: MessageKind, extra: { etaMin?: number; dedupeKey?: string } = {}): Promise<Message | null> {
  try {
    const b = await getBooking(bookingId);
    if (!b) return null;
    const body = messageBody(kind, b, extra);
    const [row] = await db
      .insert(messages)
      .values({ id: newId(), userId: b.userId, bookingId: b.id, kind, to: b.customerPhone, body, dedupeKey: extra.dedupeKey ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) return null; // already sent under this key
    const result = await sendSms(b.customerPhone, body);
    const [done] = await db
      .update(messages)
      .set({ status: result.status, error: result.error ?? '', providerId: result.providerId ?? null })
      .where(eq(messages.id, row.id))
      .returning();
    return done;
  } catch (err) {
    console.error(`[notify] ${kind} for booking ${bookingId} failed:`, err);
    return null;
  }
}

/** Reminders go out from this time the evening before. */
export const REMINDER_FROM_MIN = 15 * 60;
/** No reminder texts outside these hours, whatever triggers the run. */
const QUIET = { until: 9 * 60, from: 20 * 60 };

/**
 * Sends the evening-before reminder for tomorrow's jobs (from 3 PM), and catches up on any of today's
 * later jobs a missed run skipped. Nothing goes out before 9 AM or after 8 PM. Each booking gets one reminder per date and time, so a moved booking
 * is reminded again. Jobs booked in the last 12 hours are skipped: their confirmation just said it all.
 * Safe to call as often as you like.
 */
export async function sendDueReminders(now: { date: string; minutes: number } = nowLocal()): Promise<number> {
  if (now.minutes < QUIET.until || now.minutes >= QUIET.from) return 0;
  const tomorrow = addDays(now.date, 1);
  const rows = await db
    .select({ id: bookings.id, date: bookings.date, startMin: bookings.startMin, createdAt: bookings.createdAt })
    .from(bookings)
    .where(and(eq(bookings.status, 'confirmed'), gte(bookings.date, now.date), lte(bookings.date, tomorrow)));
  const due = rows.filter((b) => {
    if (Date.now() - b.createdAt < 12 * 3_600_000) return false;
    if (b.date === tomorrow) return now.minutes >= REMINDER_FROM_MIN;
    return b.startMin >= now.minutes + 60;
  });
  let sent = 0;
  for (const b of due) {
    const m = await notifyBooking(b.id, 'reminder', { dedupeKey: `reminder:${b.id}:${b.date}:${b.startMin}` });
    if (m) sent++;
  }
  return sent;
}

export async function listMessages(bookingIds: string[]): Promise<Message[]> {
  if (!bookingIds.length) return [];
  return db.select().from(messages).where(inArray(messages.bookingId, bookingIds)).orderBy(messages.createdAt);
}

export { smsConnected };

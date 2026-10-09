// All scheduling happens in the business's local time, regardless of where the server runs.
// Dates are 'YYYY-MM-DD' strings and times are minutes after midnight, both in America/New_York.

export const TZ = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Current local date and minutes-after-midnight at the business. */
export function nowLocal(at: Date = new Date()): { date: string; minutes: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const today = () => nowLocal().date;

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

const utc = (date: string) => new Date(date + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Adds calendar months, clamping to the last day of the month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, n: number): string {
  const [y, m, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return iso(first);
}

export const dayOfWeek = (date: string) => utc(date).getUTCDay();

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dowLabel = (date: string) => DOW[dayOfWeek(date)];
export const dayNum = (date: string) => Number(date.slice(8, 10));

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const longFmt = fmt({ weekday: 'long', month: 'short', day: 'numeric' });
const shortFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const monthFmt = fmt({ month: 'short', year: 'numeric' });
const plainFmt = fmt({ month: 'short', day: 'numeric', year: 'numeric' });

/** "Friday, Oct 9" */
export const fmtDateLong = (date: string) => longFmt.format(utc(date));
/** "Fri, Oct 9" */
export const fmtDate = (date: string) => shortFmt.format(utc(date));
/** "OCT 2026" */
export const fmtMonth = (date: string) => monthFmt.format(utc(date)).toUpperCase();
/** "Oct 9, 2026" */
export const fmtDatePlain = (date: string) => plainFmt.format(utc(date));

/** 630 → "10:30 AM" */
export function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const fmtRange = (start: number, minutes: number) => `${fmtTime(start)} – ${fmtTime(start + minutes)}`;

const stampFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
/** Formats a stored epoch-ms timestamp as a local calendar date. */
export const fmtStamp = (ms: number | null | undefined) => (ms ? stampFmt.format(new Date(ms)) : '—');

/** True when (date, minutes) is strictly before the current local time. */
export function isPast(date: string, minutes: number): boolean {
  const now = nowLocal();
  return date < now.date || (date === now.date && minutes <= now.minutes);
}

/** Whole hours from now until a local date + time. Negative when in the past. DST shifts are ignored (±1h). */
export function hoursUntil(date: string, minutes: number): number {
  const now = nowLocal();
  const days = Math.round((utc(date).getTime() - utc(now.date).getTime()) / 86_400_000);
  return (days * 1440 + minutes - now.minutes) / 60;
}

/** The instant (epoch ms) of a local date + time at the business — e.g. midnight Eastern, whatever the server's zone. */
export function localToEpoch(date: string, minutes = 0): number {
  const wall = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 0, minutes);
  // How far local wall-clock time is from UTC at a given instant.
  const offset = (at: number) => {
    const p = nowLocal(new Date(at));
    return Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), 0, p.minutes) - at;
  };
  const first = wall - offset(wall);
  return wall - offset(first); // second pass settles times next to a daylight-saving change
}

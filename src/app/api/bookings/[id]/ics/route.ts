import { currentUser } from '@/lib/auth';
import { BUSINESS } from '@/lib/catalog';
import { getBooking } from '@/lib/queries';
import { TZ } from '@/lib/time';

const stamp = (date: string, minutes: number) =>
  `${date.replace(/-/g, '')}T${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;
const esc = (s: string) => s.replace(/([\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');

/** Calendar file for a booking, in the business's time zone. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const b = user ? await getBooking(id) : null;
  if (!user || !b || (b.userId !== user.id && !user.isAdmin)) return new Response('Not found', { status: 404 });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rally Auto Care//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${b.id}@${BUSINESS.domain}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=${TZ}:${stamp(b.date, b.startMin)}`,
    `DTEND;TZID=${TZ}:${stamp(b.date, b.startMin + b.durationMin)}`,
    `SUMMARY:${esc(`Rally Auto Care — ${b.serviceName}`)}`,
    `LOCATION:${esc(b.address)}`,
    `DESCRIPTION:${esc(`Booking ${b.code}. ${b.vehicleLabel}. Questions? Call ${BUSINESS.phone}.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="rally-${b.code}.ics"` } });
}

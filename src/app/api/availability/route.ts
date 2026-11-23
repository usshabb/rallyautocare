import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getAvailability } from '@/lib/availability';
import { serviceInfo, type BookingKind } from '@/lib/catalog';
import { db } from '@/lib/db';
import { bookings } from '@/lib/db/schema';
import { geocode, pointOf, type Point } from '@/lib/geo';

// POST rather than GET so the customer's address travels in the body, not in URLs that land in logs.
export async function POST(req: NextRequest) {
  const q = (await req.json().catch(() => ({}))) as { kind?: string; service?: string; exclude?: string; admin?: boolean; address?: string };
  const info = serviceInfo((q.kind ?? 'detail') as BookingKind, q.service ?? '');
  if (!info) return Response.json({ error: 'Unknown service' }, { status: 400 });
  const user = q.admin || q.exclude ? await currentUser() : null;
  const admin = !!q.admin && !!user?.isAdmin;

  // Where the job will be: the address being typed, or — when moving a booking — the booking's own.
  let point: Point | null = null;
  // While the address is being typed, only Census is asked; OpenStreetMap is tried once there's a ZIP code.
  if (typeof q.address === 'string' && q.address.trim()) point = await geocode(q.address.slice(0, 200), { fallback: /\b\d{5}(-\d{4})?\s*$/.test(q.address) });
  else if (q.exclude && user) {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, q.exclude));
    if (b && (admin || user.isAdmin || b.userId === user.id)) point = pointOf(b);
  }

  const days = await getAvailability(info.minutes, { excludeBookingId: q.exclude || undefined, admin, days: admin ? 28 : undefined, point });
  return Response.json({ days, duration: info.duration, located: !!point }, { headers: { 'cache-control': 'no-store' } });
}

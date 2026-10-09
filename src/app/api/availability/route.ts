import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getAvailability } from '@/lib/availability';
import { serviceInfo, type BookingKind } from '@/lib/catalog';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const info = serviceInfo((q.get('kind') ?? 'detail') as BookingKind, q.get('service') ?? '');
  if (!info) return Response.json({ error: 'Unknown service' }, { status: 400 });
  const admin = q.get('admin') === '1' && !!(await currentUser())?.isAdmin;
  const days = await getAvailability(info.minutes, { excludeBookingId: q.get('exclude') ?? undefined, admin, days: admin ? 28 : undefined });
  return Response.json({ days, duration: info.duration }, { headers: { 'cache-control': 'no-store' } });
}

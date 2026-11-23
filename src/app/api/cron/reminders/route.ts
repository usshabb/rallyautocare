import type { NextRequest } from 'next/server';
import { sendDueReminders } from '@/lib/notify';

// Evening-before reminders. Vercel Cron calls this once a day (see vercel.json) with
// `Authorization: Bearer $CRON_SECRET`. Safe to call more often: each reminder goes out once.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  const sent = await sendDueReminders();
  return Response.json({ sent });
}

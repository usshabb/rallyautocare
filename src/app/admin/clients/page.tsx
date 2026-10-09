import type { Metadata } from 'next';
import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { PageHead } from '@/components/app/PageHead';
import { isAdminPhone, requireAdmin } from '@/lib/auth';
import { usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { bookings, charges, memberships, users, vehicles } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { fmtDate, today } from '@/lib/time';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const q = ((await searchParams).q ?? '').trim().toLowerCase();
  const [people, allBookings, allCharges, allPlans, allVehicles] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)),
    db.select({ userId: bookings.userId, date: bookings.date, status: bookings.status }).from(bookings),
    db.select({ userId: charges.userId, amount: charges.amountCents, status: charges.status }).from(charges),
    db.select({ userId: memberships.userId, status: memberships.status }).from(memberships),
    db.select({ userId: vehicles.userId, label: vehicles.label }).from(vehicles),
  ]);
  const now = today();
  const digits = q.replace(/\D/g, '');
  const total = people.filter((u) => !isAdminPhone(u.phone) || allVehicles.some((v) => v.userId === u.id)).length;

  const rows = people
    .map((u) => {
      const mine = allBookings.filter((b) => b.userId === u.id && b.status !== 'cancelled');
      return {
        ...u,
        jobs: mine.filter((b) => b.status === 'completed').length,
        next: mine.filter((b) => b.status === 'confirmed' && b.date >= now).map((b) => b.date).sort()[0],
        due: allCharges.filter((c) => c.userId === u.id && c.status === 'due').reduce((t, c) => t + c.amount, 0),
        member: allPlans.find((m) => m.userId === u.id && m.status !== 'cancelled')?.status,
        cars: allVehicles.filter((v) => v.userId === u.id).map((v) => v.label),
      };
    })
    // Crew accounts aren't clients unless they've actually booked something.
    .filter((u) => !isAdminPhone(u.phone) || u.cars.length > 0)
    .filter((u) => !q || u.name.toLowerCase().includes(q) || (digits.length >= 3 && u.phone.includes(digits)) || u.email.toLowerCase().includes(q) || u.cars.some((c) => c.toLowerCase().includes(q)));

  return (
    <>
      <PageHead index="CLIENTS" title={q ? `${rows.length} of ${total} clients` : `${total} ${total === 1 ? 'client' : 'clients'}`}>
        <form className="wrap-row" action="/admin/clients">
          <input className="rly-input rly-input--sm" style={{ width: 240 }} name="q" defaultValue={q} placeholder="Name, phone, email or vehicle" aria-label="Search clients" />
          <button className="rly-btn rly-btn--secondary rly-btn--sm">Search</button>
        </form>
      </PageHead>

      <div className="table-wrap">
        <table className="rly-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Vehicles</th>
              <th>Plan</th>
              <th className="right">Jobs done</th>
              <th>Next visit</th>
              <th className="right">Owes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {q ? 'No clients match that search.' : 'No clients yet. They appear here after their first booking.'}
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/admin/clients/${u.id}`} className="link strong">
                    {u.name || 'No name yet'}
                  </Link>
                </td>
                <td className="num">{formatPhone(u.phone)}</td>
                <td>{u.email || '—'}</td>
                <td>{u.cars.join(', ') || '—'}</td>
                <td>
                  {u.member === 'active' ? (
                    <span className="rly-badge rly-badge--success">Member</span>
                  ) : u.member === 'pending' ? (
                    <span className="rly-badge rly-badge--warning">Pending</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num right">{u.jobs}</td>
                <td className="num">{u.next ? fmtDate(u.next) : '—'}</td>
                <td className="num right">{u.due ? usd(u.due) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

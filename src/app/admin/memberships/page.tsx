import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { PageHead } from '@/components/app/PageHead';
import { MembershipBadge } from '@/components/ui/badges';
import { requireAdmin } from '@/lib/auth';
import { syncAllMemberships, visitsInPeriod } from '@/lib/billing';
import { findPlan, usd } from '@/lib/catalog';
import { db } from '@/lib/db';
import { charges } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { listMemberships } from '@/lib/queries';
import { fmtDatePlain, today } from '@/lib/time';

export const metadata: Metadata = { title: 'Memberships' };

export default async function MembershipsPage() {
  await requireAdmin();
  await syncAllMemberships();
  const all = await listMemberships();
  const due = await db.select().from(charges).where(eq(charges.status, 'due'));
  const now = today();
  const rows = await Promise.all(all.map(async (m) => ({ m, usage: m.status === 'active' ? await visitsInPeriod(db, m, now) : null })));
  const active = all.filter((m) => m.status === 'active');
  const mrr = active.reduce((t, m) => t + m.priceCents, 0);

  return (
    <>
      <PageHead index="MEMBERSHIPS" title="Members" />
      <div className="stats">
        <div className="stat">
          <span className="rly-label">Active</span>
          <span className="stat__value">{active.length}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Waiting on initial detail</span>
          <span className="stat__value">{all.filter((m) => m.status === 'pending').length}</span>
        </div>
        <div className="stat">
          <span className="rly-label">Monthly recurring</span>
          <span className="stat__value">{usd(mrr)}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="rly-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Vehicle</th>
              <th>Plan</th>
              <th className="right">Monthly</th>
              <th>Status</th>
              <th>Visits this month</th>
              <th className="right">Membership owed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No memberships yet.
                </td>
              </tr>
            )}
            {rows.map(({ m, usage }) => {
              const owed = due.filter((c) => c.membershipId === m.id && c.kind === 'membership').reduce((t, c) => t + c.amountCents, 0);
              return (
                <tr key={m.id}>
                  <td>
                    <Link href={`/admin/clients/${m.userId}`} className="link strong">
                      {m.customerName || formatPhone(m.customerPhone)}
                    </Link>
                  </td>
                  <td>{m.vehicleLabel}</td>
                  <td>{findPlan(m.planId)?.name}</td>
                  <td className="num right">{usd(m.priceCents)}</td>
                  <td>
                    <MembershipBadge status={m.status} />
                  </td>
                  <td className="num">{usage ? `${usage.used} of ${usage.allowed} · resets ${fmtDatePlain(usage.period.end)}` : '—'}</td>
                  <td className="num right">{owed ? usd(owed) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 12 }}>
        Open a client to start a pending membership early, cancel one, or record a payment.
      </p>
    </>
  );
}

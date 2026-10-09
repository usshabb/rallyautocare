import { usd } from '@/lib/catalog';
import type { Booking, Charge, Membership } from '@/lib/db/schema';
import type { PayState } from '@/lib/queries';

const BOOKING: Record<Booking['status'], [string, string]> = {
  confirmed: ['Confirmed', 'info'],
  completed: ['Completed', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  no_show: ['No-show', 'warning'],
};

export function StatusBadge({ status }: { status: Booking['status'] }) {
  const [label, tone] = BOOKING[status];
  return <span className={`rly-badge rly-badge--${tone}`}>{label}</span>;
}

/** What is owed on a booking. Before the job is done there is nothing to pay yet. */
export function PayBadge({ pay, status }: { pay: PayState; status: Booking['status'] }) {
  if (pay.state === 'due') return <span className="rly-badge rly-badge--warning">Due {usd(pay.dueCents)}</span>;
  if (pay.state === 'paid') return <span className="rly-badge rly-badge--success">Paid {usd(pay.paidCents)}</span>;
  if (status === 'confirmed') return <span className="rly-badge rly-badge--outline">Pay after service</span>;
  return null;
}

export function ChargeBadge({ status }: { status: Charge['status'] }) {
  if (status === 'paid') return <span className="rly-badge rly-badge--success">Paid</span>;
  if (status === 'void') return <span className="rly-badge rly-badge--neutral">Void</span>;
  return <span className="rly-badge rly-badge--warning">Due</span>;
}

export function MembershipBadge({ status }: { status: Membership['status'] }) {
  if (status === 'active') return <span className="rly-badge rly-badge--success">Active</span>;
  if (status === 'pending') return <span className="rly-badge rly-badge--warning">Starts after initial detail</span>;
  return <span className="rly-badge rly-badge--neutral">Cancelled</span>;
}

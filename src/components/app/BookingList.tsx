import Link from 'next/link';
import { sizeLabel } from '@/lib/catalog';
import { formatPhone } from '@/lib/phone';
import type { BookingRow } from '@/lib/queries';
import { fmtDate, fmtRange } from '@/lib/time';
import { PayBadge, StatusBadge } from '../ui/badges';

/** Rows of bookings. `admin` adds who the job is for and links into the admin area. */
export function BookingList({ rows, admin = false, empty }: { rows: BookingRow[]; admin?: boolean; empty: string }) {
  if (!rows.length) return <div className="list"><p className="list__empty">{empty}</p></div>;
  return (
    <div className="list">
      {rows.map((b) => (
        <Link key={b.id} href={`${admin ? '/admin' : '/account'}/bookings/${b.id}`} className="list__item">
          <div className="list__when">
            <b>{fmtDate(b.date)}</b>
            <span>{fmtRange(b.startMin, b.durationMin)}</span>
          </div>
          <div className="list__main">
            <span className="list__title">{admin ? `${b.customerName || formatPhone(b.customerPhone)} · ${b.serviceName}` : b.serviceName}</span>
            <span className="list__sub">
              {b.vehicleLabel} · {sizeLabel(b.size)} · {b.address}
            </span>
          </div>
          <div className="list__end">
            <StatusBadge status={b.status} />
            <PayBadge pay={b.pay} status={b.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}

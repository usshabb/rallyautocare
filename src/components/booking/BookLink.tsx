'use client';

import Link from 'next/link';
import type { Mode } from './BookingPanel';

/**
 * A "Book" / "Join" button. On a page that has the booking panel it preselects the package and
 * scrolls there; anywhere else it is a normal link to /book with the package in the URL.
 */
export function BookLink({ mode = 'detail', serviceId, className, children }: { mode?: Mode; serviceId?: string; className?: string; children: React.ReactNode }) {
  const href = serviceId ? `/book?mode=${mode}&service=${serviceId}` : '/book';
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        const panel = document.getElementById('book');
        if (!panel) return;
        e.preventDefault();
        if (serviceId) window.dispatchEvent(new CustomEvent('rally:pick', { detail: { mode, serviceId } }));
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      {children}
    </Link>
  );
}

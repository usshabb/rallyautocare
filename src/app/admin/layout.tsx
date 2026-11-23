import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut } from '@/app/actions/auth';
import { NavTabs } from '@/components/app/NavTabs';
import { Wordmark } from '@/components/Wordmark';
import { bypassCode, requireAdmin } from '@/lib/auth';

export const metadata: Metadata = { title: { default: 'Admin', template: '%s · Rally Admin' }, robots: { index: false } };

const TABS = [
  { href: '/admin', label: 'Schedule' },
  { href: '/admin/routes', label: 'Routes' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/clients', label: 'Clients' },
  { href: '/admin/memberships', label: 'Memberships' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/availability', label: 'Availability' },
  { href: '/admin/leads', label: 'Leads' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <header className="admin-bar">
        <div className="wrap admin-bar__in">
          <Wordmark href="/admin" />
          <span className="rly-label admin-bar__tag">Admin</span>
          <div className="admin-bar__right">
            <Link href="/" className="admin-bar__link admin-bar__link--wide">
              View site
            </Link>
            <form action={signOut}>
              <button type="submit" className="admin-bar__link admin-bar__link--wide">
                Sign out
              </button>
            </form>
            <Link href="/admin/bookings/new" className="rly-btn rly-btn--primary rly-btn--sm">
              New booking
            </Link>
          </div>
        </div>
      </header>
      <div className="subnav">
        <div className="wrap">
          <NavTabs items={TABS} label="Admin" />
        </div>
      </div>
      {bypassCode() && (
        <div className="testmode">
          <div className="wrap">Test sign-in is on: anyone can sign in as any phone number, including this admin account, with the test code. Turn it off (OTP_BYPASS_CODE=off) before taking real customers.</div>
        </div>
      )}
      <main className="app-main">
        <div className="wrap">{children}</div>
      </main>
    </>
  );
}

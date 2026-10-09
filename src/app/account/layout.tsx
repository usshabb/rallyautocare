import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NavTabs } from '@/components/app/NavTabs';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Your account', robots: { index: false } };

const TABS = [
  { href: '/account', label: 'Overview' },
  { href: '/account/bookings', label: 'Bookings' },
  { href: '/account/membership', label: 'Membership' },
  { href: '/account/payments', label: 'Payments' },
  { href: '/account/profile', label: 'Profile' },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // An account isn't finished until it has a name and an email.
  if (!user.isAdmin && (!user.name || !user.email)) redirect('/login?next=/account');
  return (
    <>
      <SiteHeader />
      <div className="subnav">
        <div className="wrap">
          <NavTabs items={TABS} label="Account" />
        </div>
      </div>
      <main className="app-main">
        <div className="wrap">{children}</div>
      </main>
      <SiteFooter flush />
    </>
  );
}

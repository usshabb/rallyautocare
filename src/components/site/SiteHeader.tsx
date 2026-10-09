import Link from 'next/link';
import { currentUser } from '@/lib/auth';
import { BUSINESS } from '@/lib/catalog';
import { BookLink } from '../booking/BookLink';
import { Wordmark } from '../Wordmark';
import { MobileMenu } from './MobileMenu';

const NAV = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/#memberships', label: 'Memberships' },
  { href: '/about', label: 'About' },
  { href: '/#business', label: 'Business' },
];

export async function SiteHeader() {
  const user = await currentUser();
  const account = user ? (user.isAdmin ? { href: '/admin', label: 'Admin' } : { href: '/account', label: 'Account' }) : { href: '/login', label: 'Sign in' };
  const menu = [...NAV, account, ...(user?.isAdmin ? [{ href: '/account', label: 'My account' }] : []), { href: BUSINESS.phoneHref, label: `Call ${BUSINESS.phone}` }];

  return (
    <header className="site-header">
      <div className="wrap site-header__in">
        <Wordmark />
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <a href={BUSINESS.phoneHref} className="rly-data site-header__phone">
          {BUSINESS.phone}
        </a>
        <div className="site-header__actions">
          <Link href={account.href} className="site-header__account">
            {account.label}
          </Link>
          <BookLink className="rly-btn rly-btn--primary rly-btn--sm">Book now</BookLink>
          <MobileMenu items={menu} signedIn={!!user} />
        </div>
      </div>
    </header>
  );
}

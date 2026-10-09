import Link from 'next/link';
import { BUSINESS } from '@/lib/catalog';
import { Wordmark } from '../Wordmark';

export function SiteFooter({ flush = false }: { flush?: boolean }) {
  return (
    <footer className={'site-footer' + (flush ? ' site-footer--flush' : '')}>
      <div className="wrap site-footer__grid">
        <Wordmark />
        <div className="site-footer__col">
          <span className="rly-label">Contact</span>
          <a href={BUSINESS.phoneHref} className="rly-data">
            {BUSINESS.phone}
          </a>
          <a href={BUSINESS.instagramHref} target="_blank" rel="noreferrer">
            {BUSINESS.instagram}
          </a>
          {BUSINESS.email && <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>}
        </div>
        <div className="site-footer__col">
          <span className="rly-label">Hours</span>
          <span className="rly-data">{BUSINESS.hours}</span>
          <span className="dim">Varies by day</span>
        </div>
        <div className="site-footer__col">
          <span className="rly-label">Service area</span>
          <span>{BUSINESS.area}</span>
          <span className="dim">Wider DMV on request</span>
        </div>
        <div className="site-footer__col">
          <span className="rly-label">Explore</span>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/quote">Business &amp; quotes</Link>
          <Link href="/account">Your account</Link>
        </div>
      </div>
      <div className="wrap site-footer__legal">
        <span>
          © {new Date().getFullYear()} {BUSINESS.legalName} · {BUSINESS.city}
        </span>
        <span>Pay after service · Zelle · Apple Pay · Card</span>
      </div>
    </footer>
  );
}

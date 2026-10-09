'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Underline tabs that follow the current route. The first item only matches its exact path. */
export function NavTabs({ items, label }: { items: { href: string; label: string }[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="rly-tabs" aria-label={label}>
      {items.map((item, i) => {
        const active = i === 0 ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={'rly-tab' + (active ? ' rly-tab--active' : '')} aria-current={active ? 'page' : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

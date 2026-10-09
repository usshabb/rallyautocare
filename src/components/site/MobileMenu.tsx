'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { signOut } from '@/app/actions/auth';

type Item = { href: string; label: string };

/** Hamburger + drop-down for phone widths. Rendered as two siblings so the panel can sit below the header row. */
export function MobileMenu({ items, signedIn }: { items: Item[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button type="button" className="rly-iconbtn menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <X /> : <Menu />}
      </button>
      {open && (
        <nav className="mobile-menu" style={{ position: 'absolute', top: '100%', left: 0, right: 0 }} aria-label="Menu">
          {items.map((i) => (
            <Link key={i.href} href={i.href} onClick={() => setOpen(false)}>
              {i.label}
            </Link>
          ))}
          {signedIn && (
            <form action={signOut}>
              <button type="submit" style={{ width: '100%' }}>
                Sign out
              </button>
            </form>
          )}
        </nav>
      )}
    </>
  );
}

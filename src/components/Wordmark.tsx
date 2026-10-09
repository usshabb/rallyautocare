import Link from 'next/link';

/** Type-set stand-in for the logo: pit stripe, RALLY, AUTO CARE. Swap for the real mark when it arrives. */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="wordmark" aria-label="Rally Auto Care — home">
      <span className="rly-stripe" />
      <span className="rly-display wordmark__name">Rally</span>
      <span className="rly-label wordmark__sub">Auto Care</span>
    </Link>
  );
}

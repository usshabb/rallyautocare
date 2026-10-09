import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

export default function NotFound() {
  return (
    <main className="band" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
      <div className="wrap page-hero">
        <Wordmark />
        <span className="rly-index" style={{ marginTop: 24 }}>
          404
        </span>
        <h1 className="rly-display page-hero__title">Wrong turn.</h1>
        <p className="hero__lede">That page isn’t here. Head back and pick up where you left off.</p>
        <div className="wrap-row">
          <Link href="/" className="rly-btn rly-btn--primary rly-btn--lg">
            Back to home
          </Link>
          <Link href="/book" className="rly-btn rly-btn--secondary rly-btn--on-dark rly-btn--lg">
            Book a detail
          </Link>
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import { QuoteForm } from '@/components/site/QuoteForm';
import { BUSINESS } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Business & quotes',
  description: 'On-site detailing for body shops, dealerships, rental fleets and apartment buildings, plus quotes for paint correction, ceramic coating, PPF and tint.',
};

export default function QuotePage() {
  return (
    <>
      <section className="band">
        <div className="wrap page-hero">
          <span className="rly-label hero__kicker">Business &amp; specialty</span>
          <h1 className="rly-display page-hero__title">Tell us the job. We’ll price it.</h1>
          <p className="hero__lede">
            Fleets, lots and buildings get recurring on-site service priced per account. Paint correction, ceramic coating, protection film and tint are quoted per vehicle.
          </p>
        </div>
      </section>
      <section className="wrap section">
        <div className="split">
          <QuoteForm />
          <div className="rly-card rly-card--striped stack g-5" style={{ padding: '32px 28px' }}>
            <h3 className="h3">Who we set up accounts for</h3>
            <div className="steps">
              {['Body shops', 'Dealerships', 'Rental car companies', 'Apartment buildings'].map((name, i) => (
                <div key={name} className="step">
                  <span className="rly-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="step__title">{name}</span>
                </div>
              ))}
            </div>
            <p className="small muted">
              Prefer to talk it through? Call{' '}
              <a href={BUSINESS.phoneHref} className="link rly-data">
                {BUSINESS.phone}
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

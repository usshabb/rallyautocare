import Link from 'next/link';
import { BUSINESS, DETAILS, INITIAL_DETAIL, PLANS, SPECIALTY, usd } from '@/lib/catalog';
import { PackageCard } from '../booking/PackageCard';

/** Lap-indexed section heading: red mono index over an expanded display title. */
export function SectionHead({ index, title, aside }: { index: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="section__head">
      <div className="section__title">
        <span className="rly-index">{index}</span>
        <h2 className="rly-display">{title}</h2>
      </div>
      {aside && <p className="section__aside">{aside}</p>}
    </div>
  );
}

export function DetailCards() {
  return (
    <div className="cards">
      {DETAILS.map((p) => (
        <PackageCard key={p.id} pkg={p} mode="detail" />
      ))}
    </div>
  );
}

const planNote = (id: string) => {
  const plan = PLANS.find((p) => p.id === id)!;
  const save = plan.regularValue - plan.price;
  return save > 0 ? `${plan.note} · regular value ${usd(plan.regularValue)} — save ${usd(save)}` : plan.note;
};

export function HowMembershipWorks() {
  return (
    <div className="rly-card rly-card--striped stack g-5" style={{ padding: '32px 28px' }}>
      <h3 className="h3">How membership works</h3>
      <div className="steps">
        <div className="step">
          <span className="rly-index">01</span>
          <div className="step__body">
            <span className="step__title">Initial detail first</span>
            <span className="step__text">From {usd(INITIAL_DETAIL.price)} for cars, priced by size and condition. Brings your vehicle up to our standard.</span>
          </div>
        </div>
        <div className="step">
          <span className="rly-index">02</span>
          <div className="step__body">
            <span className="step__title">Regular visits</span>
            <span className="step__text">One vehicle per membership, kept on a steady schedule. Book each visit from your account.</span>
          </div>
        </div>
        <div className="step">
          <span className="rly-index">03</span>
          <div className="step__body">
            <span className="step__title">No contract</span>
            <span className="step__text">Cancel anytime. SUVs &amp; larger +$20/mo.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MembershipCards() {
  return (
    <div className="cards">
      {PLANS.map((p) => (
        <PackageCard key={p.id} pkg={p} mode="member" note={planNote(p.id)} />
      ))}
      <HowMembershipWorks />
    </div>
  );
}

export function SpecialtyGrid() {
  return (
    <>
      <div className="pricegrid">
        {SPECIALTY.map((g) => (
          <div key={g.name} className="pricegrid__cell">
            <h3 className="h3">{g.name}</h3>
            <div className="pricegrid__rows">
              {g.items.map((it) => (
                <div key={it.k} className="kv">
                  <span>{it.k}</span>
                  <span className="rly-data">{it.v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="wrap-row" style={{ gap: 16, marginTop: 20 }}>
        <span className="small muted">Coating, PPF and tint are quoted per vehicle.</span>
        <Link href="/quote" className="rly-btn rly-btn--secondary rly-btn--sm">
          Request a quote
        </Link>
        <a href={BUSINESS.phoneHref} className="rly-btn rly-btn--ghost rly-btn--sm">
          Call {BUSINESS.phone}
        </a>
      </div>
    </>
  );
}

export function BusinessBand() {
  return (
    <div className="cta-band">
      <div className="stack" style={{ gap: 14 }}>
        <span className="rly-index">05 / BUSINESS</span>
        <h2 className="rly-display">Fleets, lots &amp; buildings</h2>
        <p>Body shops, dealerships, rental companies and apartment buildings — recurring on-site service, priced per account.</p>
      </div>
      <div className="wrap-row">
        <Link href="/quote" className="rly-btn rly-btn--primary rly-btn--lg">
          Request a quote
        </Link>
        <a href={BUSINESS.phoneHref} className="rly-btn rly-btn--secondary rly-btn--on-dark rly-btn--lg">
          Call {BUSINESS.phone}
        </a>
      </div>
    </div>
  );
}

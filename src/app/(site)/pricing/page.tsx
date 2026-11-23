import type { Metadata } from 'next';
import { BookLink } from '@/components/booking/BookLink';
import { BusinessBand, DetailCards, MembershipCards, SectionHead, SpecialtyGrid } from '@/components/site/sections';
import { ADDONS, INITIAL_DETAIL, PLANS, SIZE_SURCHARGE, usd } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Rally Auto Care pricing: one-time details from $150, monthly memberships from $120, add-ons, paint correction, ceramic coating, PPF and tint.',
};

export default function PricingPage() {
  return (
    <>
      <section className="band">
        <div className="wrap page-hero">
          <span className="rly-label hero__kicker">Pricing</span>
          <h1 className="rly-display page-hero__title">Clear prices. No surprises.</h1>
          <p className="hero__lede">
            Every price is listed up front. If your vehicle needs more than the package covers, we tell you before we start — never after.
          </p>
          <div className="wrap-row">
            <BookLink mode="member" serviceId="plus" className="rly-btn rly-btn--primary rly-btn--lg">
              Join a membership
            </BookLink>
            <BookLink mode="detail" serviceId="full" className="rly-btn rly-btn--secondary rly-btn--on-dark rly-btn--lg">
              Book one time
            </BookLink>
          </div>
        </div>
      </section>

      <section id="memberships" className="wrap section">
        <SectionHead index="01 / MEMBERSHIPS" title="Monthly memberships" aside="Keep your vehicle consistently clean and get a better price for staying on a schedule." />
        <MembershipCards />
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="rly-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Visits / month</th>
                <th className="right">Car</th>
                <th className="right">SUV / larger</th>
                <th className="right">You save</th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((p) => {
                const save = p.regularValue - p.price;
                return (
                  <tr key={p.id}>
                    <td className="strong">{p.name}</td>
                    <td className="num">{p.visits}</td>
                    <td className="num right">{usd(p.price)}/mo</td>
                    <td className="num right">{usd(p.price + SIZE_SURCHARGE)}/mo</td>
                    <td className="num right">{save > 0 ? `${usd(save)}–${usd(save + SIZE_SURCHARGE)}/mo` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 12, maxWidth: '70ch' }}>
          New members start with an initial detail, from {usd(INITIAL_DETAIL.price)} for cars and priced by size and condition. Heavily neglected vehicles are quoted individually.
          One vehicle per membership. No long-term contract — cancel anytime.
        </p>
      </section>

      <section id="details" className="wrap section">
        <SectionHead index="02 / ONE-TIME" title="One-time details" aside={`SUVs & larger vehicles +${usd(SIZE_SURCHARGE)}. Each package includes everything in the one before it.`} />
        <DetailCards />
      </section>

      <section id="addons" className="wrap section">
        <SectionHead index="03 / ADD-ONS" title="Add to any visit" aside="Tick these when you book. Each one is a flat price on top of your package." />
        <div className="pricegrid">
          {ADDONS.map((a) => (
            <div key={a.id} className="pricegrid__cell" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 className="h3">{a.name}</h3>
              <span className="rly-data" style={{ fontSize: 20 }}>
                +{usd(a.price)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="specialty" className="wrap section">
        <SectionHead index="04 / SPECIALTY" title="Protect the finish" aside="Starting prices. Final quote depends on vehicle size, condition and materials." />
        <SpecialtyGrid />
      </section>

      <section id="business" className="wrap section">
        <BusinessBand />
      </section>
    </>
  );
}

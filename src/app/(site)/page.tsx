import Image from 'next/image';
import Link from 'next/link';
import { BookingPanel } from '@/components/booking/BookingPanel';
import { BookLink } from '@/components/booking/BookLink';
import { BusinessBand, DetailCards, MembershipCards, SectionHead, SpecialtyGrid } from '@/components/site/sections';
import { bypassCode, currentUser } from '@/lib/auth';
import { panelCustomer } from '@/lib/panel';

// Stock photo standing in until Rally's own before/after shots are supplied.
const HERO = 'https://images.unsplash.com/photo-1739838372850-1a1986e866a7?fm=jpg&q=75&w=1400&auto=format&fit=crop';

export default async function HomePage() {
  const customer = await panelCustomer(await currentUser());

  return (
    <>
      <section className="band" id="top">
        <div className="wrap hero">
          <div className="hero__copy">
            <span className="rly-label hero__kicker">Mobile detailing · Northern Virginia &amp; DMV</span>
            <h1 className="rly-display hero__title">Detailing that comes to you.</h1>
            <p className="hero__lede">
              We bring the water, power and gear to your driveway or office. Book a one-time detail, or stay clean every month with a membership.
            </p>
            <div className="wrap-row">
              <BookLink className="rly-btn rly-btn--primary rly-btn--lg">Book a detail</BookLink>
              <Link href="/#memberships" className="rly-btn rly-btn--secondary rly-btn--on-dark rly-btn--lg">
                See memberships
              </Link>
            </div>
            <div className="hero__facts">
              <div className="hero__fact">
                <span className="rly-index">01</span>
                <span>Fully mobile — water &amp; power on board</span>
              </div>
              <div className="hero__fact">
                <span className="rly-index">02</span>
                <span>Open 10AM – 8PM</span>
              </div>
              <div className="hero__fact">
                <span className="rly-index">03</span>
                <span>Pay after service</span>
              </div>
            </div>
          </div>
          <div className="hero__photo">
            <Image src={HERO} alt="Black car with a deep gloss finish after a detail" fill priority sizes="(max-width: 900px) 100vw, 560px" />
            <div className="hero__caption">
              <div className="stack" style={{ gap: 6 }}>
                <span className="rly-label hero__kicker">Premium Detail</span>
                <span className="strong" style={{ fontSize: 15, lineHeight: 1.3 }}>
                  Clay bar, gloss enhancement, 6-month sealant
                </span>
              </div>
              <span className="rly-data nowrap" style={{ fontSize: 20 }}>
                $350
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="details" className="wrap section">
        <SectionHead
          index="01 / ONE-TIME"
          title="Pick your detail"
          aside="SUVs & larger vehicles +$20. Severe stains, heavy pet hair or neglected vehicles may cost more — we confirm before we start."
        />
        <DetailCards />
      </section>

      <section id="memberships" className="wrap section">
        <SectionHead index="02 / MEMBERSHIPS" title="Stay clean on a schedule" />
        <MembershipCards />
      </section>

      <section id="specialty" className="wrap section">
        <SectionHead index="03 / SPECIALTY" title="Protect the finish" aside="Starting prices. Final quote depends on vehicle size, condition and materials." />
        <SpecialtyGrid />
      </section>

      <section id="book" className="wrap section">
        <SectionHead index="04 / BOOK" title="Book your time" />
        <BookingPanel customer={customer} testCode={bypassCode()} />
      </section>

      <section id="business" className="wrap section">
        <BusinessBand />
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { BookLink } from '@/components/booking/BookLink';
import { BusinessBand, SectionHead } from '@/components/site/sections';
import { SCHEDULE } from '@/lib/availability';
import { BUSINESS, INITIAL_DETAIL, usd } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'About',
  description: 'Rally Auto Care is a mobile detailing crew based in Ashburn, serving Northern Virginia and the DMV. We bring our own water and power.',
};

const STEPS = [
  ['Book a time', 'Pick a package and an open arrival time online. You only see times we can actually make — no double-booking.'],
  ['We come to you', 'Driveway, office or parking lot. We bring our own water, power and gear, so all we need is room to walk around the car.'],
  ['Pay after service', 'Look the car over first. Then pay by Zelle, Apple Pay or card. Larger jobs may need a deposit.'],
];

const WHO = [
  ['Drivers & families', 'Homeowners, families and professionals who want the car handled without giving up a Saturday.'],
  ['Members', 'One or two details a month on a steady schedule, at a lower price than booking each visit separately.'],
  ['Businesses', 'Body shops, dealerships, rental car companies and apartment buildings, serviced on site and priced per account.'],
];

const FAQ: [string, string][] = [
  ['Do I need to provide water or power?', 'No. We carry both. Just leave enough room for us to walk around the vehicle.'],
  ['Where do you work?', `We’re based in ${BUSINESS.city} and cover Northern Virginia. The wider DMV is available on request — call us if you’re not sure you’re in range.`],
  ['When do I pay?', 'After the service is done. We take Zelle, Apple Pay and cards. For large jobs we may ask for a deposit to hold the time.'],
  [
    'What if my vehicle is in rough shape?',
    'Severe stains, excessive pet hair, heavy dirt or mud, and neglected vehicles can take extra time and may cost more. We look at the vehicle and confirm the price with you before we start.',
  ],
  [
    'How do memberships start?',
    `With an initial detail, from ${usd(INITIAL_DETAIL.price)} for cars, that brings the vehicle up to our maintenance standard. After that your monthly visits begin. One vehicle per membership, no contract, cancel anytime.`,
  ],
  [
    'Can I move or cancel a booking?',
    `Yes. Change or cancel it from your account up to ${SCHEDULE.cancelCutoffHours} hours before your arrival time. Inside ${SCHEDULE.cancelCutoffHours} hours, call ${BUSINESS.phone} and we’ll sort it out.`,
  ],
];

export default function AboutPage() {
  return (
    <>
      <section className="band">
        <div className="wrap page-hero">
          <span className="rly-label hero__kicker">About Rally</span>
          <h1 className="rly-display page-hero__title">A detail shop that pulls up to you.</h1>
          <p className="hero__lede">
            Rally Auto Care is a mobile detailing crew based in {BUSINESS.city}. We work across Northern Virginia and the DMV, {BUSINESS.hours.replace(' – ', ' to ')}, at your home or your
            office.
          </p>
        </div>
      </section>

      <section className="wrap section">
        <SectionHead index="01 / HOW IT WORKS" title="Three steps, no shop visit" />
        <div className="pricegrid">
          {STEPS.map(([title, text], i) => (
            <div key={title} className="pricegrid__cell">
              <span className="rly-index">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="h3">{title}</h3>
              <p className="small muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="split">
          <div className="stack g-6">
            <div className="section__title">
              <span className="rly-index">02 / WHAT WE DO</span>
              <h2 className="rly-display">Clean, protected, kept that way</h2>
            </div>
            <div className="prose">
              <p>
                Most cars don’t need a miracle. They need to be cleaned properly, on a schedule, by people who care about the details: wheel wells, door jambs, crevices, glass.
              </p>
              <p>
                That’s the idea behind Rally. <strong>One-time details</strong> get your vehicle right. <strong>Monthly memberships</strong> keep it there, for less than booking visit by
                visit. And when the paint needs more — correction, ceramic coating, protection film or tint — we quote it per vehicle.
              </p>
              <p>We tell you the price before we start, and you pay after you’ve seen the work.</p>
            </div>
            <div className="wrap-row">
              <BookLink className="rly-btn rly-btn--primary">Book a detail</BookLink>
              <Link href="/pricing" className="rly-btn rly-btn--secondary">
                See pricing
              </Link>
            </div>
          </div>
          <div className="rly-card rly-card--striped stack g-5" style={{ padding: '32px 28px' }}>
            <h3 className="h3">Who we work with</h3>
            <div className="steps">
              {WHO.map(([title, text], i) => (
                <div key={title} className="step">
                  <span className="rly-index">{String(i + 1).padStart(2, '0')}</span>
                  <div className="step__body">
                    <span className="step__title">{title}</span>
                    <span className="step__text">{text}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <SectionHead index="03 / QUESTIONS" title="Good to know" />
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <BusinessBand />
      </section>
    </>
  );
}

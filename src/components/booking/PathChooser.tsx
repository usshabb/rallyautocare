'use client';

import { useState } from 'react';
import { DETAILS, INITIAL_DETAIL, PLANS, SIZE_SURCHARGE, usd } from '@/lib/catalog';
import { BookLink } from './BookLink';
import type { Mode } from './BookingPanel';

const fromPlan = Math.min(...PLANS.map((p) => p.price));
const fromDetail = Math.min(...DETAILS.map((d) => d.price));

/**
 * The first question, car-wash style: membership or one time. Membership comes first and is the
 * featured door; the options for a path only appear once it's picked. Picking one opens the booking
 * panel with it selected (on the page, or at /book).
 */
export function PathChooser({ tone = 'light', heading }: { tone?: 'light' | 'dark'; heading?: string }) {
  const [path, setPath] = useState<Mode | null>(null);
  const cls = 'path' + (tone === 'dark' ? ' path--dark' : '');

  if (!path) {
    return (
      <div className={cls}>
        {heading && <span className="rly-label path__ask">{heading}</span>}
        <div className="path__doors">
          <button type="button" className="path__door path__door--featured" onClick={() => setPath('member')}>
            <span className="rly-badge rly-badge--accent">Best value</span>
            <span className="path__door-title">Monthly membership</span>
            <span className="path__door-price">
              from <b>{usd(fromPlan)}</b>/mo
            </span>
            <span className="path__door-text">Stay clean on a schedule: one or two details every month. No contract — cancel anytime.</span>
            <span className="path__door-cta">Choose a plan →</span>
          </button>
          <button type="button" className="path__door" onClick={() => setPath('detail')}>
            <span className="rly-badge rly-badge--outline">Single visit</span>
            <span className="path__door-title">One-time detail</span>
            <span className="path__door-price">
              from <b>{usd(fromDetail)}</b>
            </span>
            <span className="path__door-text">A single visit, from a quick refresh to a full reset with sealant.</span>
            <span className="path__door-cta">Choose a detail →</span>
          </button>
        </div>
      </div>
    );
  }

  const member = path === 'member';
  return (
    <div className={cls}>
      <div className="between">
        <span className="rly-label path__ask">{member ? 'Membership · pick a plan' : 'One-time · pick a detail'}</span>
        <button type="button" className="link small path__back" onClick={() => setPath(null)}>
          ← Back
        </button>
      </div>
      <div className="path__options">
        {member
          ? PLANS.map((p) => {
              const save = p.regularValue - p.price;
              return (
                <BookLink key={p.id} mode="member" serviceId={p.id} className={'path__opt' + (p.featured ? ' path__opt--featured' : '')}>
                  <span className="path__opt-main">
                    <span className="path__opt-name">
                      {p.name}
                      {p.badge && <span className="rly-badge rly-badge--accent">{p.badge}</span>}
                    </span>
                    <span className="path__opt-sub">
                      {p.note}
                      {save > 0 ? ` · regular value ${usd(p.regularValue)}, save ${usd(save)}` : ''}
                    </span>
                  </span>
                  <span className="path__opt-price">{usd(p.price)}/mo</span>
                </BookLink>
              );
            })
          : DETAILS.map((d) => (
              <BookLink key={d.id} mode="detail" serviceId={d.id} className="path__opt">
                <span className="path__opt-main">
                  <span className="path__opt-name">
                    {d.name}
                    {d.badge && <span className="rly-badge rly-badge--outline">{d.badge}</span>}
                  </span>
                  <span className="path__opt-sub">
                    {d.note} · {d.duration}
                  </span>
                </span>
                <span className="path__opt-price">{usd(d.price)}</span>
              </BookLink>
            ))}
      </div>
      {member ? (
        <span className="path__note">
          Starts with an initial detail from {usd(INITIAL_DETAIL.price)} that brings your vehicle up to standard; monthly billing begins after it. SUVs &amp; larger +
          {usd(SIZE_SURCHARGE)}/mo.
        </span>
      ) : (
        <button type="button" className="path__switch" onClick={() => setPath('member')}>
          Want it this clean every month? Memberships start at {usd(fromPlan)}/mo →
        </button>
      )}
    </div>
  );
}

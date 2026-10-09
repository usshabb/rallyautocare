'use client';

import { useState } from 'react';
import { requestQuote } from '@/app/actions/leads';
import { BUSINESS } from '@/lib/catalog';
import { ActionForm, Submit } from '../ui/ActionForm';

const INTERESTS = ['Business / fleet account', 'Paint correction', 'Ceramic coating', 'Paint protection film', 'Window tint', 'Something else'];

export function QuoteForm() {
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="rly-card rly-card--striped stack g-3" style={{ padding: '36px 28px 28px' }}>
        <h2 className="rly-dialog__title">Got it.</h2>
        <p className="small muted">Your request is with the crew. We’ll call or text you back. Need it sooner? Call {BUSINESS.phone}.</p>
      </div>
    );
  }
  return (
    <ActionForm action={requestQuote} onDone={() => setSent(true)} className="panel panel--tight">
      <div className="form-grid">
        <label className="rly-field">
          <span className="rly-field__label">Name</span>
          <input className="rly-input" name="name" autoComplete="name" required />
        </label>
        <label className="rly-field">
          <span className="rly-field__label">Phone</span>
          <input className="rly-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(571) 000-0000" required />
        </label>
        <label className="rly-field">
          <span className="rly-field__label">Business · optional</span>
          <input className="rly-input" name="business" autoComplete="organization" />
        </label>
        <label className="rly-field">
          <span className="rly-field__label">Email · optional</span>
          <input className="rly-input" name="email" type="email" autoComplete="email" />
        </label>
      </div>
      <label className="rly-field">
        <span className="rly-field__label">What do you need?</span>
        <span className="rly-select-wrap">
          <select className="rly-select" name="interest" defaultValue={INTERESTS[0]}>
            {INTERESTS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </span>
      </label>
      <label className="rly-field">
        <span className="rly-field__label">Details</span>
        <textarea className="rly-input" name="message" placeholder="Vehicles, how many, how often, where…" />
      </label>
      {/* Honeypot: hidden from people, tempting for bots. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      <Submit className="rly-btn rly-btn--primary rly-btn--lg rly-btn--block" pending="Sending…">
        Request a quote
      </Submit>
    </ActionForm>
  );
}

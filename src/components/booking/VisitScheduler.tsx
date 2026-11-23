'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { scheduleVisit } from '@/app/actions/booking';
import { ADDONS, usd } from '@/lib/catalog';
import { fmtDateLong, fmtTime } from '@/lib/time';
import { SchedulePicker } from './SchedulePicker';

/** Books a membership's next visit — the initial detail while it's pending, an included visit once it's active. */
export function VisitScheduler({ membershipId, planId, pending: isPending, address: savedAddress, label }: { membershipId: string; planId: string; pending: boolean; address: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [address, setAddress] = useState(savedAddress);
  const [addons, setAddons] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [booked, setBooked] = useState('');
  const [busy, start] = useTransition();

  if (!open) {
    return (
      <div className="stack g-3">
        {booked && (
          <p className="note" role="status">
            {booked}
          </p>
        )}
        <button type="button" className="rly-btn rly-btn--primary" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
    );
  }

  const save = () =>
    start(async () => {
      const r = await scheduleVisit({ membershipId, date: date ?? '', startMin: startMin ?? -1, address, addonIds: addons });
      if (!r.ok) return setError(r.error);
      setBooked(`Booked for ${fmtDateLong(r.date)} at ${fmtTime(r.startMin)}.`);
      setOpen(false);
      setStartMin(null);
      setAddons([]);
      setError('');
      router.refresh();
    });

  return (
    <div className="stack g-5" style={{ paddingTop: 20, borderTop: '1px solid var(--border-2)' }}>
      <label className="rly-field">
        <span className="rly-field__label">Service address</span>
        <input className="rly-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
      </label>
      <SchedulePicker
        kind={isPending ? 'initial' : 'visit'}
        serviceId={planId}
        address={address}
        date={date}
        startMin={startMin}
        onChange={(d, s) => {
          setDate(d);
          setStartMin(s);
        }}
      />
      <div className="stack" style={{ gap: 2 }}>
        <span className="rly-field__label" style={{ marginBottom: 6 }}>
          Add-ons · optional
        </span>
        {ADDONS.map((a) => (
          <label key={a.id} className="rly-check addon-row">
            <span>
              <input type="checkbox" checked={addons.includes(a.id)} onChange={() => setAddons((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id]))} />
              <span className="rly-check__box" />
              {a.name}
            </span>
            <span className="rly-data small muted">+{usd(a.price)}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="wrap-row">
        <button type="button" className="rly-btn rly-btn--primary rly-btn--sm" disabled={busy || startMin === null} onClick={save}>
          {busy ? 'Booking…' : 'Book this visit'}
        </button>
        <button type="button" className="rly-btn rly-btn--ghost rly-btn--sm" onClick={() => setOpen(false)}>
          Never mind
        </button>
      </div>
    </div>
  );
}

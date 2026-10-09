'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reschedule } from '@/app/actions/booking';
import type { BookingKind } from '@/lib/catalog';
import { SchedulePicker } from './SchedulePicker';

/** Moves an existing booking to another open time. Its own slot doesn't count as taken. */
export function RescheduleCard({ bookingId, kind, serviceId, admin = false }: { bookingId: string; kind: BookingKind; serviceId: string; admin?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="rly-btn rly-btn--secondary rly-btn--sm" onClick={() => setOpen(true)}>
        Reschedule
      </button>
    );
  }

  const save = () =>
    start(async () => {
      const r = await reschedule({ bookingId, date: date ?? '', startMin: startMin ?? -1 });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      setError('');
      router.refresh();
    });

  return (
    <div className="stack g-5" style={{ flexBasis: '100%', paddingTop: 20, borderTop: '1px solid var(--border-2)' }}>
      <SchedulePicker
        kind={kind}
        serviceId={serviceId}
        exclude={bookingId}
        admin={admin}
        date={date}
        startMin={startMin}
        onChange={(d, s) => {
          setDate(d);
          setStartMin(s);
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="wrap-row">
        <button type="button" className="rly-btn rly-btn--primary rly-btn--sm" disabled={pending || startMin === null} onClick={save}>
          {pending ? 'Moving…' : 'Move booking'}
        </button>
        <button type="button" className="rly-btn rly-btn--ghost rly-btn--sm" onClick={() => setOpen(false)}>
          Never mind
        </button>
      </div>
    </div>
  );
}

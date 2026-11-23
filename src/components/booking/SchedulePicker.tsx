'use client';

import { useEffect, useRef, useState } from 'react';
import type { Day } from '@/lib/availability';
import type { BookingKind } from '@/lib/catalog';
import { fmtDateLong, fmtMonth } from '@/lib/time';

type Props = {
  kind: BookingKind;
  serviceId: string;
  /** When moving an existing booking, its own time doesn't count as taken. */
  exclude?: string;
  admin?: boolean;
  date: string | null;
  startMin: number | null;
  onChange: (date: string, startMin: number | null) => void;
  /** Bump to re-check availability, e.g. after a booking is made. */
  reloadKey?: number;
  /** Where the job will be. Days the crew is already nearby get marked. */
  address?: string;
};

/** Only look an address up once it looks finished, and once typing pauses. */
function useSettled(address: string): string {
  const ready = /\d/.test(address) && address.trim().length >= 10 ? address.trim() : '';
  const [settled, setSettled] = useState(ready);
  useEffect(() => {
    const t = setTimeout(() => setSettled(ready), 700);
    return () => clearTimeout(t);
  }, [ready]);
  return settled;
}

/** Day strip + arrival times. Availability comes from the server and accounts for job length, so nothing overlaps. */
export function SchedulePicker({ kind, serviceId, exclude, admin, date, startMin, onChange, reloadKey = 0, address = '' }: Props) {
  const place = useSettled(address);
  const [days, setDays] = useState<Day[] | null>(null);
  const [duration, setDuration] = useState('');
  const [failed, setFailed] = useState(false);
  const change = useRef(onChange);
  change.current = onChange;
  const picked = useRef({ date, startMin });
  picked.current = { date, startMin };

  useEffect(() => {
    let live = true;
    setFailed(false);
    fetch('/api/availability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, service: serviceId, exclude, admin, address: place || undefined }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .then((data: { days: Day[]; duration: string }) => {
        if (!live) return;
        setDays(data.days);
        setDuration(data.duration);
        // Keep the current pick only if it is still bookable for this service.
        const cur = data.days.find((d) => d.date === picked.current.date);
        if (!cur) {
          const first = data.days.find((d) => d.open > 0) ?? data.days[0];
          if (first) change.current(first.date, null);
        } else if (picked.current.startMin !== null && cur.slots.find((s) => s.start === picked.current.startMin)?.state !== 'open') {
          change.current(cur.date, null);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [kind, serviceId, exclude, admin, reloadKey, place]);

  const active = days?.find((d) => d.date === date) ?? null;
  const shown = admin ? active?.slots.filter((s) => s.state === 'open' || s.start === startMin) : active?.slots;
  const anyNearby = !!days?.some((d) => d.nearby);

  return (
    <div className="stack g-3">
      <div className="between">
        <span className="rly-field__label">Day</span>
        <span className="rly-data tiny muted">{date ? fmtMonth(date) : ''}</span>
      </div>
      <div className="rly-dates" role="listbox" aria-label="Day">
        {days
          ? days.map((d) => (
              <button
                key={d.date}
                type="button"
                role="option"
                aria-selected={d.date === date}
                aria-label={fmtDateLong(d.date) + (d.open === 0 ? ', no open times' : d.nearby ? (admin ? ', crew nearby' : ', our crew is nearby') : '')}
                disabled={d.open === 0}
                className={'rly-date' + (d.open === 0 ? ' rly-date--disabled' : d.date === date ? ' rly-date--selected' : '')}
                onClick={() => onChange(d.date, null)}
              >
                <span className="rly-date__dow">{d.dow}</span>
                <span className="rly-date__num">{d.num}</span>
                {d.nearby && <span className="rly-date__near" aria-hidden />}
              </button>
            ))
          : Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="rly-date skeleton" aria-hidden>
                <span className="rly-date__dow">···</span>
                <span className="rly-date__num">00</span>
              </span>
            ))}
      </div>

      <span className="rly-field__label" style={{ marginTop: 12 }}>
        Arrival time
      </span>
      <div className={'slots' + (admin ? ' slots--admin' : '')}>
        {failed ? (
          <p className="slots__empty">We couldn’t load open times. Refresh the page, or call us to book.</p>
        ) : !days ? (
          Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="rly-slot skeleton" aria-hidden>
              00:00
            </span>
          ))
        ) : !shown?.length || (admin && !shown.some((s) => s.state === 'open')) ? (
          <p className="slots__empty">Nothing open this day. Try another one.</p>
        ) : (
          shown.map((s) => (
            <button
              key={s.start}
              type="button"
              disabled={s.state !== 'open'}
              aria-pressed={s.start === startMin}
              aria-label={s.best ? `${s.label}, best fit with our route` : undefined}
              className={'rly-slot' + (s.state !== 'open' ? ' rly-slot--unavailable' : s.start === startMin ? ' rly-slot--selected' : '') + (s.best && s.state === 'open' ? ' rly-slot--best' : '')}
              onClick={() => date && onChange(date, s.start)}
            >
              {s.label}
            </button>
          ))
        )}
      </div>
      {anyNearby && !failed && (
        <p className="near-note">
          <span className="rly-date__near" aria-hidden />
          {admin
            ? 'Crew already has a job within a few miles that day. The marked time adds the least driving.'
            : 'Our crew is already working near you on these days. Picking one, and the marked time, keeps our van in your area.'}
        </p>
      )}
      {!admin && days && !failed && (
        <p className="note">Struck-through times are taken or too late in the day for this service{duration ? `, which takes ${duration}` : ''}.</p>
      )}
    </div>
  );
}

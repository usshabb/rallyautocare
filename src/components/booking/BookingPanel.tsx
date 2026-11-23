'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { sendCode } from '@/app/actions/auth';
import { submitBooking } from '@/app/actions/booking';
import { ADDONS, BUSINESS, DETAILS, INITIAL_DETAIL, PLANS, PREP_NOTE, PREP_STEPS, planMonthly, priceVisit, usd, type Size } from '@/lib/catalog';
import { formatPhone, isEmail } from '@/lib/phone';
import { fmtDateLong, fmtTime } from '@/lib/time';
import { Dialog } from '../ui/Dialog';
import { SchedulePicker } from './SchedulePicker';

export type PanelCustomer = { name: string; email: string; phone: string; address: string; vehicles: { id: string; label: string; size: Size }[] };
export type Mode = 'detail' | 'member';
export const PICK_EVENT = 'rally:pick';

type Props = {
  /** The signed-in customer, or the client an admin is booking for. Null when signed out. */
  customer: PanelCustomer | null;
  initial?: { mode: Mode; serviceId: string };
  /** Admin booking on a client's behalf: asks for the client's number instead of a code. */
  admin?: boolean;
  /** True while the test sign-in code is switched on. */
  testCode?: string | null;
};

type Done = { id: string; code: string; date: string; startMin: number; service: string; member: boolean };

const defaultService = (mode: Mode) => (mode === 'member' ? 'plus' : 'full');

export function BookingPanel({ customer, initial, admin = false, testCode = null }: Props) {
  const router = useRouter();
  // Customers start on membership: it's what the business wants more of, and one-time is one tap away.
  // The crew booking for someone starts on one-time, so nobody is put on a plan by accident.
  const startMode: Mode = initial?.mode ?? (admin ? 'detail' : 'member');
  const [mode, setMode] = useState<Mode>(startMode);
  const [serviceId, setServiceId] = useState(initial?.serviceId ?? defaultService(startMode));
  const [size, setSize] = useState<Size>(customer?.vehicles[0]?.size ?? 'car');
  const [addons, setAddons] = useState<string[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState(customer?.vehicles[0]?.id ?? 'new');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, start] = useTransition();

  // "Book Essential" / "Join Rally Plus" buttons elsewhere on the page preselect a package here.
  useEffect(() => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent<{ mode: Mode; serviceId: string }>).detail;
      setMode(d.mode);
      setServiceId(d.serviceId);
    };
    window.addEventListener(PICK_EVENT, onPick);
    return () => window.removeEventListener(PICK_EVENT, onPick);
  }, []);

  // After signing in mid-booking the server sends the customer's saved details.
  useEffect(() => {
    if (!customer) return;
    setName((v) => v || customer.name);
    setEmail((v) => v || customer.email);
    setPhone(customer.phone);
    setAddress((v) => v || customer.address);
    // A vehicle typed before signing in is saved with the booking — select it rather than asking again.
    const match = customer.vehicles.find((v) => v.label.toLowerCase() === vehicleLabel.trim().toLowerCase()) ?? (vehicleLabel.trim() ? undefined : customer.vehicles[0]);
    if (vehicleId === 'new' && match) {
      setVehicleId(match.id);
      setVehicleLabel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the server sends new customer details
  }, [customer]);

  const member = mode === 'member';
  const list = member ? PLANS : DETAILS;
  const service = list.find((s) => s.id === serviceId) ?? list[0];
  const saved = customer?.vehicles.find((v) => v.id === vehicleId);
  const effectiveSize: Size = saved ? saved.size : size;
  const suv = effectiveSize === 'suv';
  const per = member ? '/mo' : '';
  const kind = member ? 'initial' : 'detail';
  const visit = priceVisit({ kind, serviceId: service.id, size: effectiveSize, addonIds: addons });
  const monthly = planMonthly(service.id, effectiveSize);
  const chosen = ADDONS.filter((a) => addons.includes(a.id));
  const ready = startMin !== null && !!date;
  const signedIn = !!customer && !admin;
  const needsIdentity = !customer || admin;

  const switchMode = (next: Mode) => {
    setMode(next);
    setServiceId(defaultService(next));
  };
  const toggleAddon = (id: string) => setAddons((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const payload = (withCode: boolean) => ({
    mode,
    serviceId: service.id,
    size: effectiveSize,
    addonIds: addons,
    date: date ?? '',
    startMin: startMin ?? -1,
    address,
    notes,
    vehicleId: saved?.id,
    vehicleLabel: saved ? undefined : vehicleLabel,
    name,
    email,
    ...(admin ? { forCustomer: { phone, name, email } } : withCode ? { phone, code } : {}),
  });

  const validate = () => {
    if (!ready) return 'Pick a day and an arrival time.';
    if (!saved && vehicleLabel.trim().length < 2) return 'Tell us the vehicle — year, make and model.';
    if (address.trim().length < 5) return 'Enter the address where we should meet you.';
    if (needsIdentity && name.trim().length < 2) return admin ? "Enter the client's name." : 'Enter your name.';
    if (needsIdentity && !admin && !isEmail(email)) return 'Enter a valid email address.';
    if (needsIdentity && admin && email.trim() && !isEmail(email)) return 'That email address looks off.';
    if (needsIdentity && phone.replace(/\D/g, '').length < 10) return 'Enter a 10-digit mobile number.';
    return '';
  };

  const book = (withCode: boolean) =>
    start(async () => {
      const result = await submitBooking(payload(withCode));
      if (!result.ok) {
        setError(result.error);
        setReloadKey((k) => k + 1); // the slot may have just been taken
        router.refresh(); // a correct code signs the customer in even if the slot was lost
        if (!/code/i.test(result.error)) setVerifying(false);
        return;
      }
      setError('');
      setVerifying(false);
      setCode('');
      setDone({ id: result.id, code: result.code, date: result.date, startMin: result.startMin, service: service.name, member });
      setStartMin(null);
      setAddons([]);
      setNotes('');
      setReloadKey((k) => k + 1);
      router.refresh();
    });

  const onConfirm = () => {
    const problem = validate();
    setError(problem);
    if (problem) return;
    if (signedIn || admin) return book(false);
    start(async () => {
      const sent = await sendCode(phone);
      if (!sent.ok) return setError(sent.error ?? 'We couldn’t send a code to that number.');
      setCode('');
      setVerifying(true);
    });
  };

  const cta = !ready ? 'Pick a time to continue' : pending && !verifying ? 'One moment…' : member ? 'Start membership' : 'Confirm booking';

  return (
    <div className="cards cards--2">
      <div className="panel">
        <div className="rly-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={member} className={'rly-tab' + (member ? ' rly-tab--active' : '')} onClick={() => switchMode('member')}>
            Membership
          </button>
          <button type="button" role="tab" aria-selected={!member} className={'rly-tab' + (!member ? ' rly-tab--active' : '')} onClick={() => switchMode('detail')}>
            One-time
          </button>
        </div>

        <div className="field-group">
          <span className="rly-field__label">{member ? 'Plan' : 'Service'}</span>
          {list.map((s) => {
            const on = s.id === service.id;
            const plan = member ? PLANS.find((p) => p.id === s.id) : undefined;
            const save = plan ? plan.regularValue - plan.price : 0;
            return (
              <button key={s.id} type="button" aria-pressed={on} aria-label={`${s.name}, ${usd(s.price + (suv ? 2000 : 0))}${per}`} className={'option' + (on ? ' option--on' : '')} onClick={() => setServiceId(s.id)}>
                <span>
                  <span className="option__name">
                    <span className={'rly-radio__dot' + (on ? ' rly-radio__dot--on' : '')} />
                    {s.name}
                    {plan?.badge && <span className="rly-badge rly-badge--accent">{plan.badge}</span>}
                  </span>
                  {plan && (
                    <span className="option__sub" style={{ paddingLeft: 30 }}>
                      {plan.note}
                      {save > 0 ? ` · save ${usd(save)} on regular value` : ''}
                    </span>
                  )}
                </span>
                <span className="rly-data" style={{ fontSize: 15 }}>
                  {usd(s.price + (suv ? 2000 : 0))}
                  {per}
                </span>
              </button>
            );
          })}
        </div>

        <div className="field-group">
          <span className="rly-field__label">Vehicle size</span>
          <div className="rly-seg" aria-disabled={!!saved}>
            <button type="button" disabled={!!saved} className={'rly-seg__opt' + (!suv ? ' rly-seg__opt--active' : '')} onClick={() => setSize('car')}>
              Car
            </button>
            <button type="button" disabled={!!saved} className={'rly-seg__opt' + (suv ? ' rly-seg__opt--active' : '')} onClick={() => setSize('suv')}>
              SUV / larger +$20
            </button>
          </div>
          {saved && <span className="note">Set by the saved vehicle: {saved.label}.</span>}
        </div>

        {!member && (
          <div className="nudge">
            <span className="rly-label" style={{ color: 'var(--accent)' }}>
              Make it monthly
            </span>
            <span className="nudge__title">Keep it this clean every month with a membership.</span>
            <span className="small muted">
              {PLANS.map((p) => `${p.name} ${usd(p.price)}/mo (${p.note.toLowerCase()})`).join(' · ')}. Starts with an initial detail from {usd(INITIAL_DETAIL.price)}. No contract.
            </span>
            <button type="button" className="rly-btn rly-btn--secondary rly-btn--sm" onClick={() => switchMode('member')}>
              See membership plans
            </button>
          </div>
        )}

        {member && (
          <div className="rly-card rly-card--striped stack g-2">
            <span className="rly-label">Starts with an initial detail</span>
            <span className="small muted">
              From {usd(INITIAL_DETAIL.price)} for cars, priced by size and condition. It brings your vehicle up to our maintenance standard. The time you pick here is for that
              first visit. No contract — cancel anytime.
            </span>
          </div>
        )}

        <div className="stack" style={{ gap: 2 }}>
          <span className="rly-field__label" style={{ marginBottom: 6 }}>
            Add-ons{member ? ' for the first visit' : ''}
          </span>
          {ADDONS.map((a) => (
            <label key={a.id} className="rly-check addon-row">
              <span>
                <input type="checkbox" checked={addons.includes(a.id)} onChange={() => toggleAddon(a.id)} />
                <span className="rly-check__box" />
                {a.name}
              </span>
              <span className="rly-data small muted">+{usd(a.price)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="panel panel--tight">
        <label className="rly-field">
          <span className="rly-field__label">Service address</span>
          <input className="rly-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, ZIP" autoComplete="street-address" />
          <span className="rly-field__hint">We bring our own water and power. Just leave room to walk around the car. Your address also shows which days we’re already nearby.</span>
        </label>
        <SchedulePicker
          kind={kind}
          serviceId={service.id}
          admin={admin}
          date={date}
          startMin={startMin}
          reloadKey={reloadKey}
          address={address}
          onChange={(d, s) => {
            setDate(d);
            setStartMin(s);
          }}
        />

        {customer && customer.vehicles.length > 0 && (
          <label className="rly-field">
            <span className="rly-field__label">Vehicle</span>
            <span className="rly-select-wrap">
              <select className="rly-select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                {customer.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
                <option value="new">Add another vehicle…</option>
              </select>
            </span>
          </label>
        )}
        {!saved && (
          <label className="rly-field">
            <span className="rly-field__label">{customer?.vehicles.length ? 'New vehicle' : 'Vehicle'}</span>
            <input className="rly-input" value={vehicleLabel} onChange={(e) => setVehicleLabel(e.target.value)} placeholder="Year, make, model" autoComplete="off" />
          </label>
        )}
        {needsIdentity && (
          <>
            <div className="form-grid">
              <label className="rly-field">
                <span className="rly-field__label">{admin ? 'Client name' : 'Full name'}</span>
                <input className="rly-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" autoComplete={admin ? 'off' : 'name'} />
              </label>
              <label className="rly-field">
                <span className="rly-field__label">{admin ? 'Client mobile' : 'Mobile'}</span>
                <input
                  className="rly-input"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(571) 000-0000"
                  autoComplete={admin ? 'off' : 'tel'}
                  disabled={admin && !!customer}
                />
              </label>
            </div>
            <label className="rly-field">
              <span className="rly-field__label">{admin ? 'Client email · optional' : 'Email'}</span>
              <input
                className="rly-input"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete={admin ? 'off' : 'email'}
              />
              {!admin && (
                <span className="rly-field__hint">
                  For your booking details and receipts. You’ll sign in with your mobile number. Booked before?{' '}
                  <Link href="/login?next=/book" className="link">
                    Sign in
                  </Link>{' '}
                  to skip this.
                </span>
              )}
            </label>
          </>
        )}
        <label className="rly-field">
          <span className="rly-field__label">Notes · optional</span>
          <textarea className="rly-input" style={{ minHeight: 72 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pet hair, stains, gate code…" />
        </label>

        <div className="total">
          {member ? (
            <>
              <div className="kv">
                <span>{service.name}</span>
                <span className="rly-data">{usd(service.price)}/mo</span>
              </div>
              {suv && (
                <div className="kv">
                  <span>SUV / larger vehicle</span>
                  <span className="rly-data">+$20/mo</span>
                </div>
              )}
              <div className="total__sum">
                <span className="rly-label">Monthly</span>
                <span className="rly-data total__amount">{usd(monthly)}/mo</span>
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <span>First visit · initial detail{chosen.length ? ' + add-ons' : ''}</span>
                <span className="rly-data">from {usd(visit?.total ?? 0)}</span>
              </div>
              <span className="note">
                Billing starts after the initial detail. Nothing is charged now — pay after service by Zelle, Apple Pay or card.
              </span>
            </>
          ) : (
            <>
              {visit?.lines.map((l, i) => (
                <div className="kv" key={l.k}>
                  <span>{l.k}</span>
                  <span className="rly-data">
                    {i > 0 ? '+' : ''}
                    {usd(l.cents)}
                  </span>
                </div>
              ))}
              <div className="total__sum">
                <span className="rly-label">Estimated total</span>
                <span className="rly-data total__amount">{usd(visit?.total ?? 0)}</span>
              </div>
              <span className="note">
                Nothing charged now. Pay after service — Zelle, Apple Pay or card. Severe stains or heavy pet hair may need extra time; we confirm before we
                start.
              </span>
            </>
          )}
        </div>

        {error && !verifying && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className={'rly-btn rly-btn--primary rly-btn--lg rly-btn--block' + (ready ? '' : ' rly-btn--disabled')} disabled={!ready || pending} onClick={onConfirm}>
          {cta}
        </button>
        <span className="note">
          {admin
            ? 'The client gets a text confirming the booking, a reminder the evening before, and your ETA when you send it.'
            : 'We’ll text your confirmation, a reminder the evening before, and our ETA on the day. Msg & data rates may apply. Reply STOP to opt out.'}
        </span>
      </div>

      {verifying && (
        <Dialog title="Confirm your number" onClose={() => !pending && setVerifying(false)}>
          <p className="rly-dialog__text">Enter the 6-digit code we texted to {formatPhone(phone)}. This is how you’ll sign in to manage your booking.</p>
          {testCode && <p className="testmode">Test mode — texts aren’t being sent yet. Use code {testCode}.</p>}
          <form
            className="stack g-4"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) book(true);
            }}
          >
            <input
              className="rly-input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="rly-btn rly-btn--primary rly-btn--block" disabled={pending || code.length !== 6}>
              {pending ? 'Booking…' : member ? 'Verify & start membership' : 'Verify & book'}
            </button>
          </form>
        </Dialog>
      )}

      {done && (
        <Dialog
          title="You’re booked."
          onClose={() => setDone(null)}
          actions={
            <>
              <Link href={admin ? `/admin/bookings/${done.id}` : `/account/bookings/${done.id}`} className="rly-btn rly-btn--ghost rly-btn--sm">
                View booking
              </Link>
              <button type="button" className="rly-btn rly-btn--dark rly-btn--sm" onClick={() => setDone(null)}>
                Done
              </button>
            </>
          }
        >
          <p className="rly-dialog__text">
            {done.member ? `Your initial detail for ${done.service}` : done.service} on {fmtDateLong(done.date)} at {fmtTime(done.startMin)}.{' '}
            {done.member ? 'Your membership starts once that visit is done. ' : ''}Need to change something? Manage it from your account or call {BUSINESS.phone}.
          </p>
          <div className="stack g-2" style={{ marginBottom: 16 }}>
            <span className="rly-label">Before we arrive</span>
            <ul className="prep">
              {PREP_STEPS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <span className="note">{PREP_NOTE}</span>
          </div>
          {!done.member && !admin && (
            <p className="small" style={{ marginBottom: 16 }}>
              Want it this clean every month? Memberships start at {usd(Math.min(...PLANS.map((p) => p.price)))}/mo.{' '}
              <Link href="/pricing#memberships" className="link">
                See plans
              </Link>
            </p>
          )}
          <span className="rly-data tiny muted">BOOKING {done.code}</span>
        </Dialog>
      )}
    </div>
  );
}

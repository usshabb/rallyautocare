'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { finishSignup, sendCode, signIn } from '@/app/actions/auth';
import { formatPhone } from '@/lib/phone';

/** Phone number, then a 6-digit code. A number we haven't seen before finishes with a name and email. No passwords. */
export function LoginForm({ next, testCode, finish: unfinished }: { next?: string; testCode: string | null; /** Signed in, but the account still needs a name or email. */ finish?: { name: string; email: string } }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  // Set once a brand-new number is verified: where to go after the account has a name and email.
  const [finishTo, setFinishTo] = useState<string | null>(unfinished ? (next ?? '/account') : null);
  const [name, setName] = useState(unfinished?.name ?? '');
  const [email, setEmail] = useState(unfinished?.email ?? '');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const request = () =>
    start(async () => {
      const r = await sendCode(phone);
      setError(r.ok ? '' : (r.error ?? 'We couldn’t send a code to that number.'));
      if (r.ok) {
        setCode('');
        setSent(true);
      }
    });

  const verify = () =>
    start(async () => {
      const r = await signIn(phone, code, next);
      if (!r.ok) return setError(r.error ?? 'That code didn’t match.');
      setError('');
      if (r.needsProfile) {
        setName(r.needsProfile.name);
        setEmail(r.needsProfile.email);
        return setFinishTo(r.redirectTo ?? '/account');
      }
      router.replace(r.redirectTo ?? '/account');
      router.refresh();
    });

  const finish = () =>
    start(async () => {
      const r = await finishSignup(name, email);
      if (!r.ok) return setError(r.error ?? 'Check your details and try again.');
      router.replace(finishTo ?? '/account');
      router.refresh();
    });

  if (finishTo) {
    return (
      <form
        className="stack g-5"
        onSubmit={(e) => {
          e.preventDefault();
          finish();
        }}
      >
        <p className="small muted">Your number is confirmed. Two more details and your account is ready.</p>
        <label className="rly-field">
          <span className="rly-field__label">Full name</span>
          <input className="rly-input" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" />
        </label>
        <label className="rly-field">
          <span className="rly-field__label">Email</span>
          <input className="rly-input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <span className="rly-field__hint">For booking details and receipts. You’ll keep signing in with your mobile number.</span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="rly-btn rly-btn--primary rly-btn--lg rly-btn--block" disabled={pending}>
          {pending ? 'One moment…' : 'Create account'}
        </button>
      </form>
    );
  }

  return (
    <form
      className="stack g-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (sent) verify();
        else request();
      }}
    >
      {!sent ? (
        <label className="rly-field">
          <span className="rly-field__label">Mobile number</span>
          <input className="rly-input" type="tel" inputMode="tel" autoComplete="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(571) 000-0000" />
          <span className="rly-field__hint">We’ll text you a 6-digit code. No password needed.</span>
        </label>
      ) : (
        <label className="rly-field">
          <span className="rly-field__label">Code sent to {formatPhone(phone)}</span>
          <input
            className="rly-input code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
          />
        </label>
      )}
      {sent && testCode && <p className="testmode">Test mode — texts aren’t being sent yet. Use code {testCode}.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="rly-btn rly-btn--primary rly-btn--lg rly-btn--block" disabled={pending || (sent && code.length !== 6)}>
        {pending ? 'One moment…' : sent ? 'Sign in' : 'Text me a code'}
      </button>
      {sent && (
        <button
          type="button"
          className="link small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            setSent(false);
            setError('');
          }}
        >
          Use a different number
        </button>
      )}
    </form>
  );
}

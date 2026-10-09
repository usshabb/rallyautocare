// Settings read from the environment. Kept free of framework imports so scripts can use it too.

/**
 * While set, this code signs in any phone number. It exists because no SMS provider is connected yet.
 * Set OTP_BYPASS_CODE=off before taking real customers — until then anyone can sign in as anyone.
 */
export function bypassCode(): string | null {
  const value = (process.env.OTP_BYPASS_CODE ?? '123456').trim();
  return value && value.toLowerCase() !== 'off' ? value : null;
}

/** Where this app is reachable, for links Stripe sends people back to. */
export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

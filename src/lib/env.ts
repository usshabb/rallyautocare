// Settings read from the environment. Kept free of framework imports so scripts can use it too.

const devBuild = process.env.NODE_ENV !== 'production';

/**
 * While set, this code signs in any phone number. It exists because no SMS provider is connected yet.
 * Local development falls back to 123456. A deployed build has no code unless OTP_BYPASS_CODE sets one —
 * and since 123456 is written in this (public) repo, a deployment must never use it.
 * Set OTP_BYPASS_CODE=off once real texts are sent.
 */
export function bypassCode(): string | null {
  const value = (process.env.OTP_BYPASS_CODE ?? (devBuild ? '123456' : '')).trim();
  return value && value.toLowerCase() !== 'off' ? value : null;
}

/** The code is printed on the sign-in screen only in local development, unless OTP_SHOW_CODE=on. */
export function visibleTestCode(): string | null {
  return devBuild || process.env.OTP_SHOW_CODE === 'on' ? bypassCode() : null;
}

/** Where this app is reachable, for links Stripe sends people back to. */
export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');

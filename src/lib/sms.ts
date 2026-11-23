// SMS delivery through Twilio, switched on by TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either
// TWILIO_FROM (a number) or TWILIO_MESSAGING_SERVICE_SID. Without them nothing is sent: messages are
// only written to the server log (and recorded in the messages table by notify.ts).
// Once texts really go out, set OTP_BYPASS_CODE=off.

export type SmsResult = { status: 'sent' | 'logged' | 'failed'; providerId?: string; error?: string };

const env = (k: string) => (process.env[k] ?? '').trim();

export const smsConnected = () => !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID')));

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  // For testing with a real provider: every text goes to this one number instead of the client's.
  const target = env('SMS_REDIRECT_TO') || to;
  if (!smsConnected()) {
    console.log(`[sms → ${target}] ${body}`);
    return { status: 'logged' };
  }
  const sid = env('TWILIO_ACCOUNT_SID');
  const form = new URLSearchParams({ To: target, Body: body });
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
  else form.set('From', env('TWILIO_FROM'));
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { status: 'failed', error: data.message ?? `Twilio ${res.status}` };
    return { status: 'sent', providerId: data.sid };
  } catch (err) {
    return { status: 'failed', error: (err as Error).message };
  }
}

// SMS delivery. No provider is connected yet, so codes are only written to the server log.
// Wire up Twilio (or similar) here, then set OTP_BYPASS_CODE=off.
export async function sendSms(to: string, body: string): Promise<void> {
  console.log(`[sms → ${to}] ${body}`);
}

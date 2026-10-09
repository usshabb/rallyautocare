/** Normalises a US phone number to E.164 (+15714201217). Returns null when it isn't a valid 10-digit number. */
export function normalizePhone(input: string): string | null {
  let digits = (input || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || digits[0] === '0' || digits[0] === '1') return null;
  return '+1' + digits;
}

/** +15714201217 → (571) 420-1217 */
export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

/** Loose check that something looks like an email address. */
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

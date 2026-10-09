import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/errors';

export type ActionState = { ok?: boolean; error?: string };

/** Runs a mutation, refreshes every page that might show its result, and turns rule violations into a message. */
export async function run(fn: () => Promise<unknown>): Promise<ActionState> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

export const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/** "225" or "$225.50" → cents. Returns NaN when it isn't a number. */
export function cents(value: string): number {
  const n = Number(value.replace(/[$,\s]/g, ''));
  return value.trim() === '' || !Number.isFinite(n) ? NaN : Math.round(n * 100);
}

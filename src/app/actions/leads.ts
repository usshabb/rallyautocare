'use server';

import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { DomainError } from '@/lib/errors';
import { newId } from '@/lib/ids';
import { normalizePhone } from '@/lib/phone';
import { run, str, type ActionState } from './result';

export async function requestQuote(_prev: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    if (str(form, 'website')) return; // honeypot field — bots fill it, people never see it
    const name = str(form, 'name').slice(0, 80);
    const phone = normalizePhone(str(form, 'phone'));
    if (!name) throw new DomainError('Enter your name.');
    if (!phone) throw new DomainError('Enter a valid 10-digit phone number.');
    await db.insert(leads).values({
      id: newId(),
      name,
      phone,
      business: str(form, 'business').slice(0, 120),
      email: str(form, 'email').slice(0, 120),
      interest: str(form, 'interest').slice(0, 80),
      message: str(form, 'message').slice(0, 2000),
    });
  });
}

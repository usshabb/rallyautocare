import Stripe from 'stripe';
import { and, eq, isNull } from 'drizzle-orm';
import { nearestPeriodStart, periodFor } from './billing';
import { findPlan, planMonthly, sizeLabel, STRIPE_METHOD, type Size } from './catalog';
import { db } from './db';
import { charges, memberships, stripeEvents, users, vehicles, type Charge, type Membership, type User } from './db/schema';
import { bypassCode } from './env';
import { DomainError } from './errors';
import { newId } from './ids';
import { fmtDatePlain, localToEpoch, nowLocal, today } from './time';

// Stripe is one more way to settle a charge, next to Zelle, Apple Pay and cash. The `charges` table stays
// the record of what is owed and paid; everything here either sends a customer to Stripe to pay a row, or
// writes back what Stripe says happened. Without STRIPE_SECRET_KEY the app works exactly as before.

const key = process.env.STRIPE_SECRET_KEY || '';
const CURRENCY = 'usd';

export const stripeEnabled = () => !!key;
export const stripeLive = () => /^(sk|rk)_live_/.test(key);
export const webhookReady = () => !!process.env.STRIPE_WEBHOOK_SECRET;

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!key) throw new DomainError('Card payments aren’t set up yet.');
  // The test sign-in code lets anyone into any account. Real money must never sit behind that.
  if (stripeLive() && bypassCode()) throw new Error('Refusing to use a live Stripe key while OTP_BYPASS_CODE is on. Set OTP_BYPASS_CODE=off first.');
  return (client ??= new Stripe(key, { appInfo: { name: 'rally-auto-care' } }));
}

// Dashboard labels for comparing checkout flows.
const FLOW = { charge: 'rally_charge_kqzmvtab', autopay: 'rally_autopay_hxwdprjn' };

const asId = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : (v?.id ?? null));
const localDate = (seconds: number) => nowLocal(new Date(seconds * 1000)).date;
const missing = (err: unknown) => err instanceof Stripe.errors.StripeError && err.code === 'resource_missing';

// ── Tax ────────────────────────────────────────────────────────────────────

export type TaxStatus = { requested: boolean; settingsActive: boolean; registrations: number; collecting: boolean };
let taxCache: { at: number; value: TaxStatus } | null = null;

/**
 * Stripe Tax only collects where the account has a head office address and an active registration.
 * Turning `automatic_tax` on without those silently collects nothing, so it is only switched on when
 * STRIPE_AUTOMATIC_TAX=on *and* Stripe confirms both.
 */
export async function taxStatus(): Promise<TaxStatus> {
  const requested = (process.env.STRIPE_AUTOMATIC_TAX ?? 'off').toLowerCase() === 'on';
  // Don't touch the Tax API unless tax was asked for — a restricted key may not be allowed to read it.
  if (!requested) return { requested, settingsActive: false, registrations: 0, collecting: false };
  if (taxCache && Date.now() - taxCache.at < 5 * 60_000 && taxCache.value.requested === requested) return taxCache.value;
  const [settings, regs] = await Promise.all([stripe().tax.settings.retrieve(), stripe().tax.registrations.list({ status: 'active', limit: 100 })]);
  const value = { requested, settingsActive: settings.status === 'active', registrations: regs.data.length, collecting: false };
  value.collecting = requested && value.settingsActive && value.registrations > 0;
  taxCache = { at: Date.now(), value };
  return value;
}

// A product tax code decides how each state taxes the service. It has to be chosen with an accountant,
// so it is configuration, never a guess in code.
const taxCode = () => process.env.STRIPE_TAX_CODE || undefined;

// ── Customers and catalog ──────────────────────────────────────────────────

export async function ensureCustomer(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create(
    { name: user.name || undefined, phone: user.phone, email: user.email || undefined, metadata: { userId: user.id } },
    { idempotencyKey: `rally-customer-${user.id}` },
  );
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id));
  return customer.id;
}

/** One Stripe Product per plan, so invoices and Checkout name the plan the customer chose. */
async function planProduct(planId: string): Promise<string> {
  const plan = findPlan(planId);
  if (!plan) throw new DomainError('Unknown plan.');
  const id = `rally_plan_${planId}`;
  try {
    return (await stripe().products.retrieve(id)).id;
  } catch (err) {
    if (!missing(err)) throw err;
  }
  const product = await stripe().products.create({
    id,
    name: plan.name,
    description: `${plan.note}. ${plan.features.join(' · ')}`,
    tax_code: taxCode(),
    metadata: { planId },
  });
  return product.id;
}

/** One Price per plan and vehicle size, found by lookup key and replaced if the catalog price changes. */
export async function planPrice(planId: string, size: Size): Promise<string> {
  const amount = planMonthly(planId, size);
  const lookup = `rally_${planId}_${size}_monthly`;
  const [found] = (await stripe().prices.list({ lookup_keys: [lookup], active: true, limit: 1 })).data;
  if (found && found.unit_amount === amount) return found.id;
  const price = await stripe().prices.create({
    product: await planProduct(planId),
    currency: CURRENCY,
    unit_amount: amount,
    recurring: { interval: 'month' },
    tax_behavior: 'exclusive',
    lookup_key: lookup,
    transfer_lookup_key: true,
    nickname: `${findPlan(planId)?.name} · ${sizeLabel(size)}`,
  });
  return price.id;
}

/** Creates the plan Products and Prices up front (they are otherwise created the first time they're needed). */
export async function syncCatalog(): Promise<{ planId: string; size: Size; price: string }[]> {
  const out = [];
  for (const planId of ['maint', 'plus']) for (const size of ['car', 'suv'] as const) out.push({ planId, size, price: await planPrice(planId, size) });
  return out;
}

// ── Paying a charge ────────────────────────────────────────────────────────

async function expireSession(id: string | null): Promise<void> {
  if (!id) return;
  await stripe().checkout.sessions.expire(id).catch(() => undefined); // already completed or expired
}

/**
 * Stops any way of paying this charge by card that is still open. Call before the charge is settled by
 * hand, voided or repriced — otherwise the customer could still pay the old link.
 */
export async function releaseCharge(charge: Charge): Promise<void> {
  if (!stripeEnabled() || (!charge.stripeSessionId && !charge.stripeInvoiceId)) return;
  await expireSession(charge.stripeSessionId);
  if (charge.stripeInvoiceId?.startsWith('plink_')) await stripe().paymentLinks.update(charge.stripeInvoiceId, { active: false }).catch(() => undefined);
  else if (charge.stripeInvoiceId) await stripe().invoices.voidInvoice(charge.stripeInvoiceId).catch(() => undefined);
  await db
    .update(charges)
    .set({ stripeSessionId: null, stripeInvoiceId: null, ...(charge.stripeInvoiceId ? { payLink: '' } : {}) })
    .where(eq(charges.id, charge.id));
}

/** Where to send a customer to pay one charge by card: its invoice link if the crew made one, else a fresh Checkout. */
export async function chargeCheckoutUrl(charge: Charge, user: User, origin: string): Promise<string> {
  if (charge.status !== 'due') throw new DomainError('That charge is already settled.');
  if (charge.payLink) return charge.payLink;
  const customer = await ensureCustomer(user);
  await expireSession(charge.stripeSessionId); // one live session per charge, always at the current amount
  const tax = (await taxStatus()).collecting;

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer,
    client_reference_id: charge.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: charge.amountCents,
          product_data: { name: charge.description, tax_code: taxCode() },
          ...(tax ? { tax_behavior: 'exclusive' as const } : {}),
        },
      },
    ],
    ...(tax ? { automatic_tax: { enabled: true }, billing_address_collection: 'required' as const, customer_update: { address: 'auto' as const } } : {}),
    metadata: { chargeId: charge.id },
    payment_intent_data: { description: `Rally Auto Care — ${charge.description}`, metadata: { chargeId: charge.id } },
    success_url: `${origin}/account/payments?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account/payments`,
    integration_identifier: FLOW.charge,
  });
  if (!session.url) throw new DomainError('We couldn’t start the card payment. Try again in a moment.');
  await db.update(charges).set({ stripeSessionId: session.id }).where(eq(charges.id, charge.id));
  return session.url;
}

/**
 * A link the crew can text so a client can pay one charge by card without signing in.
 * Clients with an email on file get a Stripe invoice (a proper document, due in 7 days). Stripe can't
 * invoice someone with no email — and most clients sign in by phone only — so everyone else gets a
 * single-use Payment Link for the same amount. Either way the link is stored on the charge
 * (`stripeInvoiceId` holds the invoice or payment-link id) and paying it settles the charge.
 */
export async function createPayLink(charge: Charge, user: User): Promise<string> {
  if (charge.status !== 'due') throw new DomainError('That charge is already settled.');
  if (charge.payLink) return charge.payLink;
  await expireSession(charge.stripeSessionId);
  const tax = (await taxStatus()).collecting;
  let id: string;
  let url: string | null | undefined;

  if (user.email) {
    const customer = await ensureCustomer(user);
    // An older Stripe customer record may predate the email being added.
    await stripe().customers.update(customer, { email: user.email, name: user.name || undefined });
    const invoice = await stripe().invoices.create({
      customer,
      collection_method: 'send_invoice',
      days_until_due: 7,
      auto_advance: false, // the crew shares the link; Stripe doesn't email or chase
      pending_invoice_items_behavior: 'exclude',
      description: 'Rally Auto Care',
      metadata: { chargeId: charge.id },
      ...(tax ? { automatic_tax: { enabled: true } } : {}),
    });
    if (!invoice.id) throw new DomainError('We couldn’t create the invoice. Try again in a moment.');
    await stripe().invoiceItems.create({ customer, invoice: invoice.id, amount: charge.amountCents, currency: CURRENCY, description: charge.description });
    id = invoice.id;
    url = (await stripe().invoices.finalizeInvoice(invoice.id)).hosted_invoice_url;
  } else {
    const link = await stripe().paymentLinks.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: charge.amountCents,
            product_data: { name: charge.description, tax_code: taxCode() },
            ...(tax ? { tax_behavior: 'exclusive' as const } : {}),
          },
        },
      ],
      restrictions: { completed_sessions: { limit: 1 } }, // one charge, one payment
      metadata: { chargeId: charge.id }, // copied onto the Checkout Session the link creates
      payment_intent_data: { description: `Rally Auto Care — ${charge.description}`, metadata: { chargeId: charge.id } },
      after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Thanks — your payment to Rally Auto Care went through.' } },
      ...(tax ? { automatic_tax: { enabled: true }, billing_address_collection: 'required' as const } : {}),
    });
    id = link.id;
    url = link.url;
  }

  if (!url) throw new DomainError('Stripe didn’t return a payment link. Try again in a moment.');
  await db.update(charges).set({ stripeInvoiceId: id, stripeSessionId: null, payLink: url }).where(eq(charges.id, charge.id));
  return url;
}

/**
 * Records a card payment against its charge. Safe to call any number of times for the same payment.
 * If the charge was already settled another way (say the crew logged a Zelle payment while the customer
 * was in Checkout), the money still arrived — so it is recorded as a duplicate for the crew to refund.
 */
async function settleCharge(input: { chargeId: string; paymentIntentId: string | null; invoiceId?: string | null; totalCents: number; taxCents: number }): Promise<void> {
  const { chargeId, paymentIntentId, invoiceId = null } = input;
  const settled = await db
    .update(charges)
    .set({ status: 'paid', method: STRIPE_METHOD, paidAt: Date.now(), taxCents: input.taxCents, stripePaymentIntentId: paymentIntentId, stripeSessionId: null })
    .where(and(eq(charges.id, chargeId), eq(charges.status, 'due')))
    .returning({ id: charges.id });
  if (settled.length) return;

  const [existing] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (!existing) return;
  const sameIntent = paymentIntentId !== null && existing.stripePaymentIntentId === paymentIntentId;
  const sameInvoice = invoiceId !== null && existing.stripeInvoiceId === invoiceId && existing.method === STRIPE_METHOD;
  if (existing.status === 'paid' && (sameIntent || sameInvoice)) return; // this payment is already recorded

  await db
    .insert(charges)
    .values({
      id: newId(),
      userId: existing.userId,
      bookingId: existing.bookingId,
      kind: 'duplicate',
      description: `Duplicate card payment — ${existing.description}`,
      amountCents: input.totalCents,
      status: 'paid',
      method: STRIPE_METHOD,
      paidAt: Date.now(),
      stripePaymentIntentId: paymentIntentId ?? `invoice:${invoiceId}`,
    })
    .onConflictDoNothing();
}

// ── Membership autopay ─────────────────────────────────────────────────────

/**
 * Checkout that puts a card on file for an active membership. The month in progress is already billed in
 * the app, so Stripe starts with the *next* month: billing is anchored to that month's first day (noon at
 * the business) with no proration, so Stripe's months line up with the app's.
 */
export async function autopayCheckoutUrl(m: Membership, user: User, origin: string): Promise<string> {
  if (m.status !== 'active' || !m.startedOn) throw new DomainError('Autopay can be turned on once your membership has started.');
  if (m.stripeSubscriptionId) throw new DomainError('Autopay is already on for this membership.');
  const period = periodFor(m.startedOn, today());
  if (!period) throw new DomainError('Autopay can be turned on once your membership has started.');
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, m.vehicleId));
  const customer = await ensureCustomer(user);
  const tax = (await taxStatus()).collecting;
  const plan = findPlan(m.planId);

  // Members who joined at an older price keep it: bill their own amount against the plan's product.
  const item =
    m.priceCents === planMonthly(m.planId, m.size)
      ? { price: await planPrice(m.planId, m.size) }
      : { price_data: { currency: CURRENCY, unit_amount: m.priceCents, recurring: { interval: 'month' as const }, product: await planProduct(m.planId), tax_behavior: 'exclusive' as const } };

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: m.id,
    line_items: [{ quantity: 1, ...item }],
    subscription_data: {
      // Noon rather than midnight, so a daylight-saving shift can never move a renewal onto the day before.
      billing_cycle_anchor: Math.floor(localToEpoch(period.end, 12 * 60) / 1000),
      proration_behavior: 'none',
      description: `${plan?.name ?? 'Membership'} · ${vehicle?.label ?? 'vehicle'}`,
      metadata: { membershipId: m.id },
    },
    ...(tax ? { automatic_tax: { enabled: true }, billing_address_collection: 'required' as const, customer_update: { address: 'auto' as const } } : {}),
    metadata: { membershipId: m.id },
    success_url: `${origin}/account/membership?autopay={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account/membership`,
    integration_identifier: FLOW.autopay,
  });
  if (!session.url) throw new DomainError('We couldn’t start autopay setup. Try again in a moment.');
  return session.url;
}

/** Links a new Stripe subscription to its membership — or cancels it if the membership can no longer use it. */
async function attachSubscription(session: Stripe.Checkout.Session): Promise<void> {
  const membershipId = session.metadata?.membershipId;
  const subscriptionId = asId(session.subscription);
  if (!membershipId || !subscriptionId) return;
  const [m] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (m?.stripeSubscriptionId === subscriptionId) return;
  if (!m || m.status !== 'active' || m.stripeSubscriptionId) {
    await stripe().subscriptions.cancel(subscriptionId).catch(() => undefined);
    return;
  }
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  // A session can be applied again long after the fact (a revisited return link, a redelivered event).
  // By then the subscription may have been cancelled — that must never switch autopay back on.
  if (!['active', 'trialing', 'past_due'].includes(subscription.status)) return;
  await db
    .update(memberships)
    .set({ stripeSubscriptionId: subscriptionId, autopayFrom: localDate(subscription.billing_cycle_anchor) })
    .where(and(eq(memberships.id, m.id), isNull(memberships.stripeSubscriptionId)));
}

/** Turns autopay off. The membership carries on, billed month by month in the app as before. */
export async function stopAutopay(m: Membership): Promise<void> {
  if (!m.stripeSubscriptionId) return;
  if (stripeEnabled()) {
    await stripe().subscriptions.cancel(m.stripeSubscriptionId).catch((err) => {
      if (!missing(err)) throw err;
    });
  }
  await db.update(memberships).set({ stripeSubscriptionId: null, autopayFrom: null }).where(eq(memberships.id, m.id));
}

/** Moves the Stripe subscription to the membership's current plan price, from the next invoice, no proration. */
export async function syncSubscriptionPlan(m: Membership): Promise<void> {
  if (!m.stripeSubscriptionId || !stripeEnabled()) return;
  const subscription = await stripe().subscriptions.retrieve(m.stripeSubscriptionId);
  const item = subscription.items.data[0];
  if (!item) return;
  await stripe().subscriptions.update(subscription.id, {
    items: [{ id: item.id, price: await planPrice(m.planId, m.size) }],
    proration_behavior: 'none',
    description: findPlan(m.planId)?.name,
  });
}

/** Stripe's page for updating the card on file. Switching and cancelling stay in the app, so they're switched off there. */
export async function cardPortalUrl(user: User, origin: string): Promise<string> {
  if (!user.stripeCustomerId) throw new DomainError('There’s no card on file yet.');
  const configs = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  const config =
    configs.data.find((c) => c.metadata?.app === 'rally') ??
    (await stripe().billingPortal.configurations.create({
      business_profile: { headline: 'Rally Auto Care — your card on file' },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: false },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
      metadata: { app: 'rally' },
    }));
  const session = await stripe().billingPortal.sessions.create({ customer: user.stripeCustomerId, configuration: config.id, return_url: `${origin}/account/membership` });
  return session.url;
}

// ── What Stripe tells us happened ──────────────────────────────────────────

export type SessionOutcome = 'paid' | 'processing' | 'autopay' | 'none';

/**
 * Applies a finished Checkout Session. Used by the webhook (the source of truth — customers don't always
 * make it back to the site) and by the return page so a customer who does come back sees it straight away.
 */
export async function applySession(input: string | Stripe.Checkout.Session, expectCustomer?: string | null): Promise<SessionOutcome> {
  const session = typeof input === 'string' ? await stripe().checkout.sessions.retrieve(input) : input;
  if (expectCustomer !== undefined && asId(session.customer) !== expectCustomer) return 'none';
  if (session.status !== 'complete') return 'none';

  if (session.mode === 'subscription') {
    await attachSubscription(session);
    return 'autopay';
  }
  const chargeId = session.metadata?.chargeId;
  if (session.mode !== 'payment' || !chargeId) return 'none';
  // Some payment methods confirm later; the charge stays due until Stripe says the money arrived.
  if (session.payment_status === 'unpaid') return 'processing';
  const tax = session.total_details?.amount_tax ?? 0;
  await settleCharge({ chargeId, paymentIntentId: asId(session.payment_intent), totalCents: session.amount_total ?? 0, taxCents: tax });
  return 'paid';
}

async function applyInvoice(invoice: Stripe.Invoice, outcome: 'paid' | 'failed'): Promise<void> {
  if (!invoice.id) return;
  const total = invoice.total ?? 0;
  const tax = Math.max(0, total - (invoice.total_excluding_tax ?? total));

  // An invoice link the crew created for one charge.
  const chargeId = invoice.metadata?.chargeId;
  if (chargeId) {
    if (outcome === 'paid') await settleCharge({ chargeId, paymentIntentId: null, invoiceId: invoice.id, totalCents: total, taxCents: tax });
    return;
  }

  // A membership month billed by autopay.
  const subscriptionId = asId(invoice.parent?.subscription_details?.subscription);
  const line = invoice.lines?.data[0];
  if (!subscriptionId || !line || total <= 0) return; // the $0 invoice at signup has nothing to record
  const [m] = await db.select().from(memberships).where(eq(memberships.stripeSubscriptionId, subscriptionId));
  if (!m) return;

  // Filed under the app's own period for that month (see nearestPeriodStart), not Stripe's exact date.
  const periodStart = m.startedOn ? nearestPeriodStart(m.startedOn, localDate(line.period.start)) : localDate(line.period.start);
  const row = {
    id: newId(),
    userId: m.userId,
    membershipId: m.id,
    kind: 'membership' as const,
    description: `${findPlan(m.planId)?.name ?? 'Membership'} · month starting ${fmtDatePlain(periodStart)}`,
    amountCents: total - tax,
    taxCents: tax,
    periodStart,
    stripeInvoiceId: invoice.id,
  };
  const period = and(eq(charges.membershipId, m.id), eq(charges.periodStart, periodStart), eq(charges.status, 'due'));
  if (outcome === 'paid') {
    await db.insert(charges).values({ ...row, status: 'paid', method: STRIPE_METHOD, paidAt: Date.now() }).onConflictDoNothing();
    // The month may already be on the books as due — after a failed attempt, or billed before autopay began.
    await db.update(charges).set({ status: 'paid', method: STRIPE_METHOD, paidAt: Date.now(), taxCents: tax, stripeInvoiceId: invoice.id, payLink: '' }).where(period);
  } else {
    // The card was declined. Show the month as owed, with Stripe's page to pay it; Stripe also retries.
    const payLink = invoice.hosted_invoice_url ?? '';
    await db.insert(charges).values({ ...row, payLink }).onConflictDoNothing();
    await db.update(charges).set({ payLink, stripeInvoiceId: invoice.id }).where(period);
  }
}

/** A subscription that ended in Stripe (cancelled there, or given up on after failed payments) hands billing back to the app. */
async function detachSubscription(subscriptionId: string): Promise<void> {
  await db.update(memberships).set({ stripeSubscriptionId: null, autopayFrom: null }).where(eq(memberships.stripeSubscriptionId, subscriptionId));
}

/** Handles one verified webhook event. Every branch is idempotent, so Stripe's retries and re-deliveries are harmless. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
  if (seen) return;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await applySession(event.data.object);
      break;
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      // Nothing was paid; the charge stays due and the customer can start again.
      await db.update(charges).set({ stripeSessionId: null }).where(eq(charges.stripeSessionId, event.data.object.id));
      break;
    case 'invoice.paid':
      await applyInvoice(event.data.object, 'paid');
      break;
    case 'invoice.payment_failed':
      await applyInvoice(event.data.object, 'failed');
      break;
    case 'customer.subscription.deleted':
      await detachSubscription(event.data.object.id);
      break;
    case 'customer.subscription.updated':
      if (['canceled', 'unpaid', 'incomplete_expired'].includes(event.data.object.status)) await detachSubscription(event.data.object.id);
      break;
  }
  // Recorded last: if anything above throws, Stripe retries and the event is processed again.
  await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
}

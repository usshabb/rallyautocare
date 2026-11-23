import { sql } from 'drizzle-orm';
import { bigint, boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

// Postgres on Supabase. Supabase serves the `public` schema over a REST API using a key that is meant
// to be public, so every table has row-level security switched on with no policies: nothing is reachable
// that way. The app connects as the table owner, which RLS does not restrict.

/** A moment in time, as epoch milliseconds. (Postgres `integer` is 32-bit and can't hold one.) */
const ms = (name: string) => bigint(name, { mode: 'number' });
/** A calendar day at the business, 'YYYY-MM-DD'. */
const day = (name: string) => date(name, { mode: 'string' });
const createdAt = () => ms('created_at').notNull().$defaultFn(() => Date.now());

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(), // E.164
  name: text('name').notNull().default(''),
  email: text('email').notNull().default(''),
  address: text('address').notNull().default(''),
  adminNotes: text('admin_notes').notNull().default(''),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: createdAt(),
}).enableRLS();

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ms('expires_at').notNull(),
  createdAt: createdAt(),
}).enableRLS();

export const otpCodes = pgTable('otp_codes', {
  phone: text('phone').primaryKey(),
  codeHash: text('code_hash').notNull(),
  expiresAt: ms('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  sentAt: ms('sent_at').notNull(),
}).enableRLS();

export const vehicles = pgTable(
  'vehicles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(), // "2022 BMW X5"
    size: text('size', { enum: ['car', 'suv'] }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('vehicles_user_idx').on(t.userId)],
).enableRLS();

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
    planId: text('plan_id').notNull(),
    size: text('size', { enum: ['car', 'suv'] }).notNull(),
    priceCents: integer('price_cents').notNull(), // monthly, size surcharge included
    // pending: waiting on the initial detail. active: billing monthly from startedOn.
    status: text('status', { enum: ['pending', 'active', 'cancelled'] }).notNull().default('pending'),
    startedOn: day('started_on'), // local date the first billing period began
    // Autopay: Stripe bills the card on file for every period starting on or after autopayFrom.
    stripeSubscriptionId: text('stripe_subscription_id'),
    autopayFrom: day('autopay_from'),
    cancelledAt: ms('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('memberships_user_idx').on(t.userId),
    // One vehicle per membership: a vehicle can only be on one live plan at a time.
    uniqueIndex('memberships_vehicle_live_idx').on(t.vehicleId).where(sql`status != 'cancelled'`),
  ],
).enableRLS();

export const bookings = pgTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(), // RAC-12345
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
    membershipId: text('membership_id').references(() => memberships.id),
    // detail: one-time package. initial: first detail for a new member. visit: included membership visit.
    kind: text('kind', { enum: ['detail', 'initial', 'visit'] }).notNull(),
    serviceId: text('service_id').notNull(), // detail id for `detail`, plan id otherwise
    size: text('size', { enum: ['car', 'suv'] }).notNull(),
    addons: jsonb('addons').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    date: day('date').notNull(),
    startMin: integer('start_min').notNull(), // minutes after local midnight
    durationMin: integer('duration_min').notNull(),
    address: text('address').notNull(),
    notes: text('notes').notNull().default(''),
    adminNotes: text('admin_notes').notNull().default(''),
    status: text('status', { enum: ['confirmed', 'completed', 'cancelled', 'no_show'] }).notNull().default('confirmed'),
    estimateCents: integer('estimate_cents').notNull(),
    finalCents: integer('final_cents'),
    createdBy: text('created_by', { enum: ['customer', 'admin'] }).notNull().default('customer'),
    // Where the address is on the map, for routing. Null when it couldn't be found — the booking still stands.
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    area: text('area'), // town, e.g. "Ashburn"
    cancelledAt: ms('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('bookings_user_idx').on(t.userId),
    index('bookings_date_idx').on(t.date),
    // The migration also adds `bookings_no_overlap`, an exclusion constraint Drizzle can't express:
    // the database itself refuses two live jobs whose times overlap, whatever the application does.
  ],
).enableRLS();

// Money owed and money received. Rally is paid after service, so a charge is created when a job is
// closed out (or a membership month begins) and settled later: by hand for Zelle, Apple Pay and cash,
// or automatically when the customer pays by card through Stripe.
export const charges = pgTable(
  'charges',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => bookings.id),
    membershipId: text('membership_id').references(() => memberships.id),
    // duplicate: a card payment that arrived for a charge already settled another way — needs a refund.
    kind: text('kind', { enum: ['service', 'deposit', 'membership', 'duplicate'] }).notNull(),
    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(), // before tax
    taxCents: integer('tax_cents').notNull().default(0), // sales tax Stripe collected on top, if any
    status: text('status', { enum: ['due', 'paid', 'void'] }).notNull().default('due'),
    method: text('method'),
    payLink: text('pay_link').notNull().default(''), // a hosted invoice the customer can pay (Stripe or QuickBooks)
    stripeSessionId: text('stripe_session_id'), // open Checkout Session, if the customer has started paying
    stripeInvoiceId: text('stripe_invoice_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    periodStart: day('period_start'), // membership charges: first day of the billing period
    paidAt: ms('paid_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('charges_user_idx').on(t.userId),
    index('charges_booking_idx').on(t.bookingId),
    uniqueIndex('charges_period_idx').on(t.membershipId, t.periodStart).where(sql`period_start is not null`),
    // A Stripe payment or invoice can only ever be recorded once.
    uniqueIndex('charges_stripe_pi_idx').on(t.stripePaymentIntentId).where(sql`stripe_payment_intent_id is not null`),
    uniqueIndex('charges_stripe_invoice_idx').on(t.stripeInvoiceId).where(sql`stripe_invoice_id is not null`),
  ],
).enableRLS();

// Stripe webhook events already handled, so a redelivered event is ignored.
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: createdAt(),
}).enableRLS();

// Time the crew is not available: a whole day (10AM–8PM) or part of one.
export const blocks = pgTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    date: day('date').notNull(),
    startMin: integer('start_min').notNull(),
    endMin: integer('end_min').notNull(),
    reason: text('reason').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('blocks_date_idx').on(t.date)],
).enableRLS();

// Quote requests for business accounts and specialty work.
export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  business: text('business').notNull().default(''),
  phone: text('phone').notNull(),
  email: text('email').notNull().default(''),
  interest: text('interest').notNull().default(''),
  message: text('message').notNull().default(''),
  status: text('status', { enum: ['new', 'contacted', 'closed'] }).notNull().default('new'),
  createdAt: createdAt(),
}).enableRLS();

// Addresses already looked up on the map, so the same address is never geocoded twice.
// A miss is remembered too (lat null) and retried after a while.
export const geocodes = pgTable('geocodes', {
  key: text('key').primaryKey(), // normalised address
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  area: text('area'),
  matched: text('matched').notNull().default(''), // the address the geocoder matched
  createdAt: createdAt(),
}).enableRLS();

// Every text the app sends a client, whether or not an SMS provider is connected yet.
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['confirmation', 'reminder', 'eta', 'rescheduled', 'cancelled'] }).notNull(),
    to: text('to').notNull(),
    body: text('body').notNull(),
    // sent: handed to the SMS provider. logged: no provider yet, written to the server log only.
    status: text('status', { enum: ['pending', 'sent', 'logged', 'failed'] }).notNull().default('pending'),
    error: text('error').notNull().default(''),
    providerId: text('provider_id'),
    // Messages that must go out once, e.g. "reminder:<booking>:<date>:<time>". A reschedule makes a new key.
    dedupeKey: text('dedupe_key').unique(),
    createdAt: createdAt(),
  },
  (t) => [index('messages_booking_idx').on(t.bookingId)],
).enableRLS();

export type User = typeof users.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Message = typeof messages.$inferSelect;

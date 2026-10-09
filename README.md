# Rally Auto Care

Booking site and back office for Rally Auto Care, a mobile detailing crew in Northern Virginia.

- **Public site** — landing, pricing, about, quote requests, and a booking panel that only offers times the crew can actually make.
- **Customer account** — bookings (reschedule, cancel, add to calendar), membership (schedule visits, switch plan, autopay, cancel), payments, profile.
- **Admin** — day/week schedule, bookings, clients, memberships, payments, blocked time, quote requests.

Built with Next.js 16 (App Router), Drizzle + libSQL (SQLite), and Stripe. The design system (`src/styles/`) is ported from the Rally design project.

## Run it

```bash
pnpm install
cp .env.example .env.local
pnpm dev --port 3210
```

`pnpm dev` applies database migrations first. Data lives in `./data/rally.db` unless `DATABASE_URL` points elsewhere.

Sign in with any US mobile number and the test code in `.env.local` (`OTP_BYPASS_CODE`). Numbers listed in `ADMIN_PHONES` get the admin area at `/admin`.

| Command | What it does |
| --- | --- |
| `pnpm check` | Runs the scheduling and membership rules against a throwaway database |
| `pnpm typecheck` / `pnpm build` | Type-check / production build |
| `pnpm db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm stripe:setup` | Create the membership products and prices in Stripe; report what's missing |
| `pnpm stripe:listen` | Forward Stripe webhooks to the local server |

## How it fits together

| Where | What |
| --- | --- |
| `src/lib/catalog.ts` | Services, plans, add-ons, prices. The pages and the server both price from here. |
| `src/lib/availability.ts` | Hours, arrival times, travel gap, booking window, cancellation cutoff — and the overlap rule. |
| `src/lib/bookings.ts` | Creating, moving, cancelling and completing jobs. |
| `src/lib/billing.ts` | Memberships and charges. |
| `src/lib/stripe.ts` | Everything Stripe: Checkout, pay links, autopay, the webhook handler. |
| `src/lib/time.ts` | Dates and times, always in `America/New_York`. |
| `src/app/actions/` | Server actions (the only way the UI changes data). |

**No double-booking.** One crew, so jobs can't overlap. A time is offered only if the whole job fits: its length, a 30-minute gap either side, nothing else booked or blocked, and done by closing. The server re-checks inside the same transaction that saves the booking, so two people confirming at once can't both get a slot.

**Paying.** Customers pay after service. Completing a job in admin creates a *charge*; a charge is settled by hand (Zelle, Apple Pay, cash) or by card through Stripe. Memberships get a charge each month from the day their initial detail is completed.

## Stripe

Optional — without `STRIPE_SECRET_KEY` the app runs with hand-recorded payments only.

- **Card payments.** Customers tap *Pay by card* on a charge (Stripe Checkout, includes Apple Pay). The crew can also create a pay link on any charge and text it: a Stripe invoice if the client has an email, otherwise a single-use payment link.
- **Membership autopay.** A member can put a card on file. The month in progress stays on their Payments page; Stripe bills from the next month on, on the same day of the month.
- **Webhook.** `POST /api/stripe/webhook` is what records payments and renewals. Subscribe it to the events listed in `scripts/stripe-listen.mjs` and set `STRIPE_WEBHOOK_SECRET`. Locally, `pnpm stripe:listen` does this for you.
- **Sales tax.** Off. To collect it, give Stripe Tax a head office address and at least one registration, have an accountant confirm what is taxable and pick the product tax code, then set `STRIPE_AUTOMATIC_TAX=on` and `STRIPE_TAX_CODE`. The admin Payments page shows whether tax is actually being collected.

## Before going live

1. **Turn off the test sign-in code** (`OTP_BYPASS_CODE=off`) and connect an SMS provider in `src/lib/sms.ts`. While the code is on, anyone can sign in as anyone, including admin. The app refuses to start Stripe with a live key while it is on.
2. **Use a hosted database.** Set `DATABASE_URL` / `DATABASE_AUTH_TOKEN` to a libSQL (Turso) database and run `pnpm db:migrate` against it. The local SQLite file does not survive serverless deploys.
3. **Stripe:** activate the account, swap in live keys (a restricted `rk_` key is safer than `sk_`), create the production webhook endpoint, set `NEXT_PUBLIC_APP_URL`.
4. Set `ADMIN_PHONES` to the real crew numbers.
5. Replace the stand-ins: the type-set wordmark (`src/components/Wordmark.tsx`) and the stock hero photo (`src/app/(site)/page.tsx`).

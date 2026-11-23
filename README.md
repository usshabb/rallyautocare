# Rally Auto Care

Booking site and back office for Rally Auto Care, a mobile detailing crew in Northern Virginia.

- **Public site** — landing, pricing, about, quote requests, and a booking panel that only offers times the crew can actually make. The first question is *membership or one-time* (membership first), car-wash style; the options for a path appear once it's picked.
- **Customer account** — bookings (reschedule, cancel, add to calendar), membership (schedule visits, switch plan, autopay, cancel), payments, profile.
- **Admin** — day/week schedule, routes (jobs on a map, grouped by area), bookings, clients, memberships, payments, blocked time, quote requests.

Built with Next.js 16 (App Router), Drizzle + Postgres (Supabase), and Stripe. The design system (`src/styles/`) is ported from the Rally design project.

## Run it

```bash
pnpm install
cp .env.example .env.local   # then fill in the two Supabase connection strings
pnpm dev --port 3210
```

`pnpm dev` applies database migrations first. The database is Supabase Postgres; there is no local fallback, so `DATABASE_URL` must be set.

Sign in with any US mobile number and the test code (`OTP_BYPASS_CODE`; 123456 locally, shown on the sign-in screen). Deployed builds don't show the code and don't fall back to 123456 — set a private one in the deployment's environment. Numbers listed in `ADMIN_PHONES` get the admin area at `/admin`.

| Command | What it does |
| --- | --- |
| `pnpm check` | Runs the scheduling and membership rules against real Postgres, in a throwaway schema (`rally_check`) it creates and drops |
| `pnpm typecheck` / `pnpm build` | Type-check / production build |
| `pnpm db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm stripe:setup` | Create the membership products and prices in Stripe; report what's missing |
| `pnpm stripe:listen` | Forward Stripe webhooks to the local server |
| `pnpm geo:backfill` | Put bookings that have no map location yet on the map |

## How it fits together

| Where | What |
| --- | --- |
| `src/lib/catalog.ts` | Services, plans, add-ons, prices. The pages and the server both price from here. |
| `src/lib/availability.ts` | Hours, arrival times, travel gap, booking window, cancellation cutoff — and the overlap rule. |
| `src/lib/bookings.ts` | Creating, moving, cancelling and completing jobs. |
| `src/lib/billing.ts` | Memberships and charges. |
| `src/lib/stripe.ts` | Everything Stripe: Checkout, pay links, autopay, the webhook handler. |
| `src/lib/time.ts` | Dates and times, always in `America/New_York`. |
| `src/lib/geo.ts` | Addresses → map points (US Census geocoder, cached), distances, drive-time estimates. |
| `src/lib/routes.ts` | Day routes, a shorter order for a day, and outlying jobs that would sit better on another day. |
| `src/lib/notify.ts`, `src/lib/sms.ts` | Texts to clients (confirmation, reminder, ETA, new time, cancelled) and the Twilio adapter. |
| `src/app/actions/` | Server actions (the only way the UI changes data). |

**No double-booking.** One crew, so jobs can't overlap. A time is offered only if the whole job fits: its length, a 30-minute gap either side, nothing else booked or blocked, and done by closing. Three things enforce it:

1. Bookings take turns. Every transaction that adds or moves a job first takes one database lock (`lockSchedule`), so two people confirming at once are handled one after the other and the second sees the first.
2. The server re-checks the time inside that transaction, never trusting what the browser showed.
3. The database refuses overlapping jobs on its own (`bookings_no_overlap`, an exclusion constraint added by hand in the first migration).

**Grouping jobs by area.** One crew, so the driving saved comes mostly from *which day* a job lands on. Every booking's address is looked up on the map when it's made (the free US Census geocoder; no key). Then:

- *At booking time* (customer panel, member visits, admin new booking): once the address is in, days the crew already has a job within 5 miles get a green dot, and the open time that adds the least driving is marked. It only ranks — every open time stays bookable, and a failed lookup never blocks a booking.
- *Admin → Routes*: each day's jobs in order with the estimated drive between them, a map of the week (coloured by day), and an *Open in Google Maps* link that drives the day stop by stop. When a later day would drive noticeably less in another order, it proposes one (on the times clients already picked where possible, no one moved more than 3 hours); *Apply* moves them and texts each client. Below that, jobs far from everything else on their day are matched to a day when the crew is nearby, with *Move & text client*. Nothing moves until the admin applies it.
- Drive times are estimates from distance (×1.3 for roads, ~28 mph locally, ~45 mph beyond), not live traffic. They never decide whether a time can be booked: the fixed 30-minute gap still does. Back-to-back jobs whose drive looks longer than the gap are flagged on the route.

**Texts to clients.** Every one is recorded on the booking (admin → booking → *Texts to the client*), sent or not:

| When | What |
| --- | --- |
| Booked (by the client or the crew) | Confirmation with the prep checklist: trash and personal items out, car seats and seat covers removed, car open |
| Evening before (from 3 PM) | Reminder with the arrival time and the checklist. Sent once per date and time, so a moved booking is reminded again |
| On the day | *Text ETA* on the route page or the booking ("about 18 min out"). After a job is marked complete, its page offers the next stop's ETA, starting from the estimated drive |
| Moved or cancelled | The new time, or that it's cancelled |

Reminders run from a daily Vercel Cron (`/api/cron/reminders`, 21:00 UTC, so 4–6 PM Eastern on Hobby's ±59 min timing), and opening the admin schedule catches up if a run was missed. Crons only run on *production* deployments and need `CRON_SECRET` set.

No SMS provider is connected yet: texts are written to the server log and marked *not delivered*. Set the Twilio variables in `.env.example` to send them for real. `SMS_REDIRECT_TO` sends every text to one number instead, for testing.

**Supabase.** Every table has row-level security on with no policies, so Supabase's public REST API reaches nothing; the app talks to Postgres directly as the table owner. Keep it that way when adding tables (`.enableRLS()` in the schema).

**Paying.** Customers pay after service. Completing a job in admin creates a *charge*; a charge is settled by hand (Zelle, Apple Pay, cash) or by card through Stripe. Memberships get a charge each month from the day their initial detail is completed.

## Stripe

Optional — without `STRIPE_SECRET_KEY` the app runs with hand-recorded payments only.

- **Card payments.** Customers tap *Pay by card* on a charge (Stripe Checkout, includes Apple Pay). The crew can also create a pay link on any charge and text it: a Stripe invoice if the client has an email, otherwise a single-use payment link.
- **Membership autopay.** A member can put a card on file. The month in progress stays on their Payments page; Stripe bills from the next month on, on the same day of the month.
- **Webhook.** `POST /api/stripe/webhook` is what records payments and renewals. Subscribe it to the events listed in `scripts/stripe-listen.mjs` and set `STRIPE_WEBHOOK_SECRET`. Locally, `pnpm stripe:listen` does this for you.
- **Sales tax.** Off. To collect it, give Stripe Tax a head office address and at least one registration, have an accountant confirm what is taxable and pick the product tax code, then set `STRIPE_AUTOMATIC_TAX=on` and `STRIPE_TAX_CODE`. The admin Payments page shows whether tax is actually being collected.

## Dev deployment

Vercel project `rallyautocare` in the personal team. Deploy a preview and point the stable dev address at it:

```bash
vercel deploy --target=preview --scope usshabbs-projects
vercel alias set <deployment-url> rallyautocare-dev.vercel.app --scope usshabbs-projects
```

A bare `vercel deploy` on this project goes to *production*, which has no environment variables yet. Preview environment variables live in the Vercel project settings; the deployed sign-in code is private (never 123456).

## Before going live

1. **Connect Twilio and turn off the test sign-in code** (`OTP_BYPASS_CODE=off`). While the code is on, anyone can sign in as anyone, including admin. The app refuses to start Stripe with a live key while it is on. US texting from a regular number needs A2P 10DLC registration (brand + campaign) with Twilio first, which takes days to weeks; booking texts are "customer care / account notifications", and the opt-out line is already on the booking form.
2. **Reminder cron:** set `CRON_SECRET` in Vercel and make a production deployment (crons don't run on previews).
3. **Use a separate production database.** Local development and the dev deployment share one Supabase project. Give production its own project (and a rotated password), and run `pnpm db:migrate` against it.
4. **Stripe:** activate the account, swap in live keys (a restricted `rk_` key is safer than `sk_`), create the production webhook endpoint, set `NEXT_PUBLIC_APP_URL`.
5. Set `ADMIN_PHONES` to the real crew numbers.
6. Check the van's base in `src/lib/geo.ts` (`BASE`, currently central Ashburn): routes start and end there.
7. Replace the stand-ins: the type-set wordmark (`src/components/Wordmark.tsx`) and the stock hero photo (`src/app/(site)/page.tsx`).

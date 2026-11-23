import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Postgres (Supabase). DATABASE_URL should be the *transaction pooler* address (port 6543): it is what
// serverless functions need, and it is why prepared statements are switched off below.
const url = process.env.DATABASE_URL;
if (!url) console.warn('DATABASE_URL is not set — every database call will fail. See .env.example.');

const local = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);
// A different schema than `public` — used by `pnpm check` to run against a throwaway copy of the tables.
const schemaName = process.env.DATABASE_SCHEMA;

function connect() {
  return postgres(url ?? 'postgres://database-url-not-set.invalid:5432/postgres', {
    prepare: false,
    max: Number(process.env.DATABASE_POOL ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: local ? false : 'require',
    onnotice: () => undefined,
    ...(schemaName ? { connection: { search_path: schemaName } } : {}),
  });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __rallyPg?: ReturnType<typeof postgres> };
export const client = globalForDb.__rallyPg ?? connect();
if (process.env.NODE_ENV !== 'production') globalForDb.__rallyPg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

/**
 * One crew, one calendar. Postgres lets many transactions write at once, so two people confirming at
 * the same moment could each check the calendar, each see their time free, and both book it. Taking
 * this lock as the first statement of every transaction that adds or moves a booking makes them go one
 * at a time; it is released automatically when the transaction ends.
 */
export const lockSchedule = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(725511)`);

/** True when Postgres refused a write because it would break a unique or no-overlap rule. */
export function isConflict(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++) {
    if (e.code === '23505' || e.code === '23P01') return true;
  }
  return false;
}

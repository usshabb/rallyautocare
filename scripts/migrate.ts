import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Migrations run over the session pooler / direct address when one is given: schema changes want a
// connection of their own rather than the transaction pooler the app uses.
const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

async function main() {
  if (!url) throw new Error('Set DATABASE_URL (and ideally DATABASE_DIRECT_URL) before migrating. See .env.example.');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => undefined });
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
  console.log('Database is up to date.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

import { migrate } from 'drizzle-orm/libsql/migrator';
import { client, db } from '../src/lib/db';

async function main() {
  await migrate(db, { migrationsFolder: './drizzle' });
  client.close();
  console.log('Database is up to date.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

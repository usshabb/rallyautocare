// Puts existing bookings on the map: looks up every booking address that has no location yet.
// New bookings are located when they are made; this is for the ones from before, or after an outage.
//
//   pnpm geo:backfill
import { eq, isNull } from 'drizzle-orm';

async function main() {
  const { db, client } = await import('../src/lib/db');
  const { bookings } = await import('../src/lib/db/schema');
  const { geocode } = await import('../src/lib/geo');
  const rows = await db.select({ id: bookings.id, code: bookings.code, address: bookings.address }).from(bookings).where(isNull(bookings.lat));
  let found = 0;
  for (const b of rows) {
    const place = await geocode(b.address, { retry: true, timeoutMs: 8000 });
    if (place) {
      await db.update(bookings).set({ lat: place.lat, lng: place.lng, area: place.area || null }).where(eq(bookings.id, b.id));
      found++;
    }
    console.log(`${b.code}  ${place ? `${place.area || '?'} (${place.lat.toFixed(4)}, ${place.lng.toFixed(4)})` : 'not found'}  ${b.address}`);
  }
  console.log(`\n${found} of ${rows.length} located.`);
  await client.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

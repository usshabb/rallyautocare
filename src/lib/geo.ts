import { eq } from 'drizzle-orm';
import { db } from './db';
import { geocodes } from './db/schema';

// Where jobs are on the map and roughly how long the van takes between them.
//
// Addresses are looked up with the US Census Bureau geocoder (free, no key, good at US street
// addresses), falling back to OpenStreetMap's Nominatim for the ones Census's address ranges miss.
// Drive times are estimates from straight-line distance — close enough to tell a 5-minute
// hop from a 40-minute trek, which is all grouping jobs by area needs. They never refuse a booking.

export type Point = { lat: number; lng: number };
export type Place = Point & { area: string };

/** Where the van starts and ends the day. */
export const BASE: Place & { address: string } = { lat: 39.0438, lng: -77.4874, area: 'Ashburn', address: 'Ashburn, VA' };

/** Jobs this close together count as the same area. */
export const NEARBY_MILES = 5;

/** Straight-line distance in miles. */
export function miles(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road miles: roads wind, so about 1.3× the straight line. */
export const roadMiles = (a: Point, b: Point) => miles(a, b) * 1.3;

/**
 * Estimated drive in minutes: a few minutes to park and set up, ~28 mph for the first local miles,
 * ~45 mph beyond that (Route 7, the Greenway, 28).
 */
export function driveMinutes(a: Point, b: Point): number {
  const road = roadMiles(a, b);
  if (road < 0.05) return 0;
  return Math.round(3 + (Math.min(road, 5) / 28) * 60 + (Math.max(road - 5, 0) / 45) * 60);
}

export const pointOf = (row: { lat: number | null; lng: number | null }): Point | null => (row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null);

const keyOf = (address: string) => address.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();

/** True when the text looks enough like a street address to be worth looking up. */
export const looksLikeAddress = (address: string) => /\d/.test(address) && /[a-z]{3}/i.test(address) && address.trim().length >= 8;

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const RETRY_MISS_MS = 7 * 86_400_000;

type Found = { place: Place; matched: string };

async function census(address: string, timeoutMs: number): Promise<Found | null> {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const data = (await res.json()) as {
    result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; addressComponents?: { city?: string } }[] };
  };
  const m = data.result?.addressMatches?.[0];
  if (!m) return null;
  return { place: { lat: m.coordinates.y, lng: m.coordinates.x, area: titleCase(m.addressComponents?.city ?? '') }, matched: m.matchedAddress };
}

// Nominatim's usage policy: at most one request a second, and say who is asking.
let nominatimAt = 0;
async function nominatim(address: string, timeoutMs: number): Promise<Found | null> {
  const wait = nominatimAt + 1100 - Date.now();
  nominatimAt = Math.max(Date.now(), nominatimAt + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const url = new URL('https://nominatim.openstreetmap.org/search');
  for (const [k, v] of Object.entries({ q: address, format: 'jsonv2', addressdetails: '1', limit: '1', countrycodes: 'us' })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', headers: { 'user-agent': 'RallyAutoCare/1.0 (booking app; +https://rallyautocare.us)' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const [m] = (await res.json()) as { lat: string; lon: string; place_rank: number; display_name: string; address?: Record<string, string> }[];
  // Street level or better: a town's centre is too rough to route by.
  if (!m || m.place_rank < 26) return null;
  const a = m.address ?? {};
  return { place: { lat: Number(m.lat), lng: Number(m.lon), area: a.city || a.town || a.village || a.hamlet || a.suburb || '' }, matched: m.display_name };
}


/**
 * Finds an address on the map. Returns null when it can't be found or the lookup is slow or down —
 * callers carry on without a location. Answers are cached, so each address is looked up once.
 * `fallback: false` skips Nominatim, whose usage policy rules out lookups while someone is typing.
 */
export async function geocode(address: string, opts: { timeoutMs?: number; retry?: boolean; fallback?: boolean } = {}): Promise<Place | null> {
  const key = keyOf(address);
  if (!looksLikeAddress(key)) return null;
  try {
    const [hit] = await db.select().from(geocodes).where(eq(geocodes.key, key));
    if (hit && hit.lat !== null && hit.lng !== null) return { lat: hit.lat, lng: hit.lng, area: hit.area ?? '' };
    if (hit && !opts.retry && Date.now() - hit.createdAt < RETRY_MISS_MS) return null;

    const timeoutMs = opts.timeoutMs ?? 4000;
    const found = (await census(address, timeoutMs)) ?? (opts.fallback === false ? undefined : await nominatim(address, timeoutMs));
    // Without the fallback a miss proves little (the address may still be half typed): don't remember it.
    if (found === undefined) return null;
    const row = { key, lat: found?.place.lat ?? null, lng: found?.place.lng ?? null, area: found?.place.area ?? null, matched: found?.matched ?? '', createdAt: Date.now() };
    await db.insert(geocodes).values(row).onConflictDoUpdate({ target: geocodes.key, set: row });
    return found?.place ?? null;
  } catch (err) {
    // Slow or unreachable geocoder: don't cache, just go without a location this time.
    console.warn('[geocode] lookup failed:', (err as Error).message);
    return null;
  }
}

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client, type Transaction } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Local SQLite file by default; point DATABASE_URL at a hosted libSQL (Turso) database in production.
const url = process.env.DATABASE_URL || 'file:./data/rally.db';
const isFile = url.startsWith('file:');

/**
 * SQLite allows one writer at a time, and the local driver runs each statement synchronously. If a
 * second write starts while a transaction is open on another connection, it can't wait — the thread
 * it would wait on is the one that has to finish the transaction — so it fails as "database is locked".
 * Running every operation one after another, with a transaction holding its place until it commits or
 * rolls back, gives each write a clean turn. A hosted database queues writers itself and skips this.
 */
function oneAtATime(client: Client): Client {
  let tail: Promise<unknown> = Promise.resolve();
  const turn = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = tail.then(fn, fn);
    tail = result.catch(() => undefined);
    return result;
  };

  // A transaction keeps its turn until it commits, rolls back or is closed.
  const holdTurn = (begin: () => Promise<Transaction>): Promise<Transaction> =>
    new Promise((resolve, reject) => {
      void turn(
        () =>
          new Promise<void>((release) => {
            begin().then(
              (tx) =>
                resolve(
                  new Proxy(tx, {
                    get(target, prop) {
                      const value = Reflect.get(target, prop, target);
                      if (typeof value !== 'function') return value;
                      const bound = value.bind(target);
                      if (prop !== 'commit' && prop !== 'rollback' && prop !== 'close') return bound;
                      return (...args: unknown[]) => {
                        let out: unknown;
                        try {
                          out = bound(...args);
                        } catch (err) {
                          release();
                          throw err;
                        }
                        return out instanceof Promise ? out.finally(release) : (release(), out);
                      };
                    },
                  }),
                ),
              (err) => {
                release();
                reject(err);
              },
            );
          }),
      );
    });

  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      const bound = value.bind(target);
      if (prop === 'transaction') return (...args: unknown[]) => holdTurn(() => bound(...args));
      if (prop === 'execute' || prop === 'batch' || prop === 'migrate' || prop === 'executeMultiple') return (...args: unknown[]) => turn(() => bound(...args));
      return bound;
    },
  });
}

function connect(): Client {
  if (!isFile) return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  // `timeout` makes a write wait for another *process* (a script, a second server) instead of failing at once.
  return oneAtATime(createClient({ url, timeout: 5000 }));
}

// Reuse one connection across hot reloads in development.
const globalForDb = globalThis as unknown as { __rallyClient?: Client };
export const client = globalForDb.__rallyClient ?? connect();
if (process.env.NODE_ENV !== 'production') globalForDb.__rallyClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };

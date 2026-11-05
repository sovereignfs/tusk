import type { SQL } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Run raw SQL on either dialect. The query builder is the usual way in; this is
 * the one small place for what it does not cover, so no caller branches on the
 * dialect itself (DESIGN.md §22). Queries written for it use standard SQL only:
 * `ON CONFLICT … DO UPDATE`, `RETURNING` and `LIMIT` mean the same on both.
 *
 * Two things differ and are handled here, not by callers:
 *
 * - Rows. PostgreSQL's `execute` returns `{ rows }`; libSQL's `all`, `get` and `run`
 *   return the rows (or nothing). Everything is awaited, since libSQL's are
 *   promises and a plain value awaits to itself.
 * - Zero rows. drizzle-orm 0.45's libSQL `.get()` throws a TypeError when a raw
 *   query matches no row (its row normaliser calls Object.keys on `undefined`), so
 *   `dbGet` goes through `.all()`, which has no such case.
 *
 * Booleans read back as 0/1 on SQLite and true/false on PostgreSQL: cast where it
 * matters. 64-bit integers are numbers on both (`client.ts` sets the parser).
 * Raw SQL returns column names as written, so alias camelCase explicitly
 * (`created_at AS "createdAt"`).
 */

/** At most one row. */
export async function dbGet<T>(database: Database, query: SQL): Promise<T | undefined> {
  const rows = await dbAll<T>(database, query);
  return rows[0];
}

/** Every row. */
export async function dbAll<T>(database: Database, query: SQL): Promise<T[]> {
  if (database.dialect === 'sqlite') {
    return (await database.db.all(query)) as T[];
  }
  const result = await database.db.execute(query);
  return result.rows as T[];
}

/** A statement run for its effect, with no rows wanted. */
export async function dbRun(database: Database, query: SQL): Promise<void> {
  if (database.dialect === 'sqlite') {
    await database.db.run(query);
    return;
  }
  await database.db.execute(query);
}

const queues = new WeakMap<object, Promise<unknown>>();

/** Runs `work` after every earlier piece of work for the same `key` has ended, whether it succeeded or not. */
function oneAtATime<T>(key: object, work: () => Promise<T>): Promise<T> {
  const turn = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(
    key,
    turn.then(
      () => undefined,
      () => undefined,
    ),
  );
  return turn;
}

/**
 * Runs `work` in one transaction, on either dialect: it commits if `work` returns and rolls back if it throws. `work` is given a handle to
 * run its statements on, and anything it runs on the original handle is outside the transaction, so it uses only the one it is given.
 *
 * Transactions are short, and none is held open across a call to a git host or to core (DESIGN.md §5): a mutation reads, decides and writes
 * inside one, and anything slower happens before or after.
 */
export async function transaction<T>(
  database: Database,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  if (database.dialect === 'sqlite') {
    const run = () =>
      database.db.transaction((tx) =>
        work({ ...database, db: tx as unknown as typeof database.db }),
      );
    // A file is written by one transaction at a time in this process, and here, in JavaScript, rather than by SQLite's lock: libSQL's driver
    // waits for a lock synchronously, on the one thread, so a second transaction that waited for the first would stop the very work that
    // lets the first finish. (Other processes sharing the file wait on the busy timeout, which is a different thread of theirs.) An sqld service
    // takes its writers in turn itself.
    return database.form === 'file' ? oneAtATime(database.db, run) : run();
  }
  return database.db.transaction((tx) =>
    work({ ...database, db: tx as unknown as typeof database.db }),
  );
}

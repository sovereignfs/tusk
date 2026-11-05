import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbRun } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { testTarget } from '../db/test-support';
import { applyMutation } from './apply';
import type { Mutation, Pull } from './format';
import { pull } from './pull';
import { account, card, check, id, list, makeStore, mutation } from './test-support';

/**
 * Pull (DESIGN.md §8.3): what changed for an account since a cursor, in pages, and **a cursor that never skips a row**.
 */
const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

let clock = 1_800_000_000_000;
const apply = async (owner: string, m: Mutation) => {
  const result = await applyMutation(database, owner, m, { now: (clock += 1000) });
  if (result.status !== 'applied') throw new Error(`refused: ${result.code}`);
  return result;
};

/** Pull page after page from a cursor until there is no more, returning every page. */
async function pullAll(owner: string, from = 0, limit?: number): Promise<Pull[]> {
  const pages: Pull[] = [];
  let cursor = from;
  for (let i = 0; i < 1000; i++) {
    const page = await pull(database, owner, cursor, limit === undefined ? {} : { limit });
    pages.push(page);
    cursor = page.cursor;
    if (!page.more) return pages;
  }
  throw new Error('a pull that never ends');
}

const ids = (pages: Pull[]) => pages.flatMap((page) => page.rows.map((row) => row.id));

describe(`pull (${leg})`, () => {
  it('has nothing to say to an account with nothing, and leaves the cursor where it was', async () => {
    expect(await pull(database, account(), 0)).toEqual({
      cursor: 0,
      more: false,
      rows: [],
      tombstones: [],
    });
    expect(await pull(database, account(), 41)).toEqual({
      cursor: 41,
      more: false,
      rows: [],
      tombstones: [],
    });
  });

  it('is every row of the account from zero, with its structure, deletion, fields and the seq each field was written at', async () => {
    const ada = account();
    const l = list({ title: 'Home' });
    const t = card(l.id, { position: 'a3' });
    const sub = check(t.id);
    await apply(ada, mutation(l, t, sub));
    await apply(ada, mutation({ table: 'desk_check', id: sub.id, deleted: true }));
    await apply(
      ada,
      mutation({ table: 'desk_card', id: t.id, fields: { description: { v: 'later' } } }),
    );

    const [page] = await pullAll(ada);
    expect(page?.cursor).toBe(3);
    expect(page?.more).toBe(false);
    const byId = new Map(page?.rows.map((row) => [row.id, row]));
    expect(byId.get(l.id)).toMatchObject({
      table: 'desk_list',
      position: 'a0',
      deletedAt: null,
      seq: 1,
      fields: { title: { v: 'Home', s: 1 } },
    });
    expect(byId.get(t.id)).toMatchObject({
      table: 'desk_card',
      listId: l.id,
      position: 'a3',
      seq: 3,
      fields: { title: { v: 'Buy milk', s: 1 }, description: { v: 'later', s: 3 } },
    });
    expect(byId.get(sub.id)).toMatchObject({ table: 'desk_check', cardId: t.id, seq: 2 });
    expect(Number(byId.get(sub.id)?.deletedAt)).toBeGreaterThan(0);
    // The owner and the mirrors are the server's, and are not sent.
    expect(JSON.stringify(page)).not.toContain(ada);
    expect(Object.keys(byId.get(t.id) ?? {}).sort()).toEqual(
      ['createdAt', 'deletedAt', 'fields', 'id', 'listId', 'position', 'seq', 'table'].sort(),
    );
  });

  it('is only what is past the cursor', async () => {
    const ada = account();
    const l = list();
    const a = card(l.id);
    const b = card(l.id);
    await apply(ada, mutation(l));
    const second = await apply(ada, mutation(a));
    await apply(ada, mutation(b));
    expect(ids(await pullAll(ada, second.seq))).toEqual([b.id]);
    expect(ids(await pullAll(ada, second.seq + 1))).toEqual([]);
  });

  it('is only the account’s own: another’s rows are not in it, whatever the cursor', async () => {
    const ada = account();
    const grace = account();
    const aList = list();
    await apply(ada, mutation(aList, card(aList.id)));
    const gList = list();
    await apply(grace, mutation(gList));
    expect(ids(await pullAll(grace)).sort()).toEqual([gList.id]);
    expect(ids(await pullAll(grace, 0, 1)).sort()).toEqual([gList.id]);
    expect(await pull(database, grace, 1)).toMatchObject({ rows: [], tombstones: [] });
  });

  it('is in pages that end at a seq, so that the rows of one mutation are never split', async () => {
    const ada = account();
    const l = list();
    await apply(ada, mutation(l));
    const big = Array.from({ length: 7 }, () => card(l.id));
    await apply(ada, mutation(...big));
    await apply(ada, mutation(card(l.id)));

    const pages = await pullAll(ada, 0, 3);
    // The second mutation is seven rows and the limit three: it comes whole, on a page of its own.
    for (const page of pages) {
      const seqs = new Set(page.rows.map((row) => row.seq));
      for (const seq of seqs) {
        const total = pages.flatMap((p) => p.rows).filter((row) => row.seq === seq).length;
        expect(page.rows.filter((row) => row.seq === seq).length, `seq ${seq}`).toBe(total);
      }
    }
    expect(ids(pages)).toHaveLength(9);
    expect(new Set(ids(pages)).size).toBe(9);
    expect(pages.at(-1)?.more).toBe(false);
  });

  it('covers every row once and in order, however small the page, and the cursor only goes forward', async () => {
    const ada = account();
    const l = list();
    await apply(ada, mutation(l));
    const made: string[] = [l.id];
    for (let i = 0; i < 25; i++) {
      const t = card(l.id);
      made.push(t.id);
      await apply(ada, mutation(t));
    }
    for (const limit of [1, 2, 7, 10, 26, 100]) {
      const pages = await pullAll(ada, 0, limit);
      expect(ids(pages), `limit ${limit}`).toEqual(made);
      const cursors = pages.map((page) => page.cursor);
      expect(cursors, `limit ${limit}`).toEqual([...cursors].sort((a, b) => a - b));
      expect(pages.filter((page) => page.more).length).toBe(pages.length - 1);
    }
  });

  it('says there is nothing more when the last page ends exactly at the end', async () => {
    const ada = account();
    const l = list();
    await apply(ada, mutation(l));
    await apply(ada, mutation(card(l.id)));
    const page = await pull(database, ada, 0, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.more).toBe(false);
  });

  it('carries the tombstones of an account, past the cursor, and only that account’s', async () => {
    const ada = account();
    const grace = account();
    const l = list();
    const mine = await apply(ada, mutation(l));
    const tombstone =
      database.dialect === 'postgres' ? postgresSchema.tombstone : sqliteSchema.tombstone;
    const gone = id();
    const others = id();
    await dbRun(
      database,
      sql`INSERT INTO ${tombstone} (table_name, id, account_id, seq, deleted_at) VALUES ('desk_card', ${gone}, ${ada}, ${mine.seq + 4}, 1)`,
    );
    await dbRun(
      database,
      sql`INSERT INTO ${tombstone} (table_name, id, account_id, seq, deleted_at) VALUES ('desk_card', ${others}, ${grace}, ${mine.seq + 4}, 1)`,
    );

    const [page] = await pullAll(ada);
    expect(page?.tombstones).toEqual([{ table: 'desk_card', id: gone, seq: mine.seq + 4 }]);
    expect(page?.cursor).toBe(mine.seq + 4);
    expect((await pullAll(ada, mine.seq + 4))[0]?.tombstones).toEqual([]);
  });

  it('asks for no more than the most, and no fewer than one', async () => {
    const ada = account();
    const l = list();
    await apply(ada, mutation(l));
    expect((await pull(database, ada, 0, { limit: 0 })).rows).toHaveLength(1);
    expect((await pull(database, ada, 0, { limit: -5 })).rows).toHaveLength(1);
  });

  it('never skips a row, though mutations commit while it is being read', async () => {
    const ada = account();
    const l = list();
    await apply(ada, mutation(l));
    const made = new Set<string>([l.id]);

    let writing = true;
    const writer = (async () => {
      for (let i = 0; i < 40; i++) {
        const t = card(l.id);
        await apply(ada, mutation(t));
        made.add(t.id);
      }
      writing = false;
    })();

    // A reader that keeps pulling small pages, from where its last page ended, while the writer works.
    const seen: string[] = [];
    let cursor = 0;
    const reader = (async () => {
      while (writing) {
        const page = await pull(database, ada, cursor, { limit: 3 });
        seen.push(...page.rows.map((row) => row.id));
        cursor = page.cursor;
      }
    })();
    await Promise.all([writer, reader]);
    // And once more, to the end.
    for (;;) {
      const page = await pull(database, ada, cursor, { limit: 3 });
      seen.push(...page.rows.map((row) => row.id));
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(new Set(seen)).toEqual(made);
    expect(seen).toHaveLength(made.size);
  });
});

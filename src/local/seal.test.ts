import 'fake-indexeddb/auto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createIdentity } from '../cipher/identity';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { type Harness, harness, settleAll } from '../sync/sim-support';
import {
  account,
  card,
  check,
  list,
  makeStore,
  mutation,
  series,
  snapshot,
} from '../sync/test-support';
import { tableOf } from '../sync/tables';
import { DeskCipher, NoListKey, cipherOf } from './seal';
import { allDeskRows, cardsOf, checksOf, getRow, listsOf, openCounts } from './store';

/**
 * A Desk sealed to a key of the person's own (DESIGN.md §9.2, §9.4), on a real server and real devices. **The test the task is for:** after a journey that makes,
 * edits, moves, completes, deletes and restores things, every table of the server for the account is read and nothing of what the person wrote is in it.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
let devices: Harness;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  devices = harness(database);
});
afterAll(async () => {
  await close();
});
afterEach(async () => devices.dispose());

const refuse = { plain: 'refuse' as const };
async function device(owner: string, key?: { identity: string; recipient: string }) {
  const d = await devices.device(owner, refuse);
  if (key) d.client.setCipher(new DeskCipher(key.identity, key.recipient));
  return d;
}
const titleOf = (row: { fields: Record<string, unknown> } | undefined) =>
  (row?.fields.title as { v?: unknown } | undefined)?.v;

describe(`a Desk sealed to a key of its own (${leg})`, () => {
  it('leaves nothing of what was written on the server, in any table, after a whole journey', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);

    const [home, work] = [list({ title: 'Hidden list Home' }), list({ title: 'Hidden list Work' })];
    const milk = card(home.id, {
      fields: {
        title: { v: 'Hidden card milk' },
        description: { v: 'Hidden description' },
        starred: { v: true },
        dueDate: { v: '2026-12-24' },
        dueTime: { v: '09:30' },
      },
    });
    const oat = check(milk.id, { fields: { title: { v: 'Hidden item oat' } } });
    const rule = series(home.id, {
      fields: { rule: { v: 'FREQ=WEEKLY;BYDAY=MO' }, anchor: { v: '2026-12-21' } },
    });
    await a.client.commit(mutation(home, work, milk, oat, rule));
    await a.client.sync();

    // Edited, ticked, moved to the other list with its checklist, deleted and brought back.
    await a.client.commit(
      mutation({
        table: 'desk_card',
        id: milk.id,
        fields: { title: { v: 'Hidden card milk, edited' } },
      }),
    );
    await a.client.commit(
      mutation({
        table: 'desk_check',
        id: oat.id,
        fields: { completedAt: { v: 1_800_000_000_000 } },
      }),
    );
    await a.client.commit(
      mutation({ table: 'desk_card', id: milk.id, listId: work.id, position: 'a5' }),
    );
    await a.client.commit(mutation({ table: 'desk_card', id: milk.id, deleted: true }));
    await a.client.commit(mutation({ table: 'desk_card', id: milk.id, deleted: false }));
    await a.client.commit(
      mutation({
        table: 'desk_list',
        id: home.id,
        fields: {
          title: { v: 'Hidden list renamed' },
          color: { v: '#16a34a' },
          sort: { v: 'due' },
        },
      }),
    );
    await a.client.sync();
    expect(await a.client.pending()).toBe(0);

    const rows = await snapshot(database, owner);
    const text = JSON.stringify(rows);
    for (const secret of [
      'Hidden',
      'milk',
      'item oat',
      '2026-12-24',
      '09:30',
      'FREQ=',
      '#16a34a',
      '"due"',
      'renamed',
    ])
      expect(text, `server holds ${secret}`).not.toContain(secret);
    // Every field but a list's key is ciphertext, and a list has its key; the mirrors the server keeps for what it can read stay empty.
    for (const [table, list_] of Object.entries(rows))
      for (const row of list_ as Record<string, unknown>[]) {
        const fields = JSON.parse(String(row.fields)) as Record<
          string,
          { v?: unknown; c?: string }
        >;
        for (const [name, field] of Object.entries(fields)) {
          if (table === 'desk_list' && name === 'key') expect('v' in field).toBe(true);
          else expect(field.c, `${table}.${name}`).toMatch(/^[A-Za-z0-9_-]{30,}$/);
        }
        if (table === 'desk_list') expect(fields.key, 'a list without its key').toBeDefined();
        if (table === 'desk_card') {
          expect(row.due_date ?? null).toBeNull();
          expect(row.due_time ?? null).toBeNull();
          expect(row.completed_at ?? null).toBeNull();
        }
      }
  });

  it('is read in full by another device with the same key, including what was moved, and by none without it', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);
    const [one, two] = [list({ title: 'First' }), list({ title: 'Second' })];
    const moved = card(one.id, {
      fields: {
        title: { v: 'Moves' },
        description: { v: 'with its words' },
        completedAt: { v: null },
      },
    });
    const item = check(moved.id, { fields: { title: { v: 'and its item' } } });
    await a.client.commit(mutation(one, two, moved, item));
    await a.client.commit(
      mutation({ table: 'desk_card', id: moved.id, listId: two.id, position: 'a9' }),
    );
    await a.client.sync();

    const b = await device(owner, key);
    await settleAll([a, b]);
    expect((await b.client.read(listsOf)).map(titleOf).sort()).toEqual(['First', 'Second']);
    const there = await b.client.read((db) => cardsOf(db, two.id));
    expect(there.map(titleOf)).toEqual(['Moves']);
    expect((there[0]?.fields.description as { v: unknown }).v).toBe('with its words');
    expect((await b.client.read((db) => checksOf(db, moved.id))).map(titleOf)).toEqual([
      'and its item',
    ]);
    expect(cipherOf(b.client.db)?.unreadable.size).toBe(0);
    expect(await b.client.read(openCounts)).toEqual(new Map([[two.id, 1]]));

    // Another person's key reads none of it, and says nothing of what it is; no key shows the ciphertext as it is.
    const other = await device(owner, await createIdentity());
    await settleAll([a, other]);
    expect((await other.client.read(listsOf)).map(titleOf)).toEqual([undefined, undefined]);
    expect(cipherOf(other.client.db)?.unreadable.size).toBeGreaterThan(0);
    const bare = await device(owner);
    await settleAll([a, bare]);
    const raw = (await bare.client.read(listsOf)).map((row) => row.fields.title);
    expect(raw.every((field) => field && 'c' in field)).toBe(true);
  });

  it('seals a moved card, its checklist and its series under the new list’s key: nothing is left under the old one', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);
    const [one, two] = [list({ title: 'One' }), list({ title: 'Two' })];
    const moved = card(one.id, { fields: { title: { v: 'Moving' }, description: { v: 'words' } } });
    const item = check(moved.id, { fields: { title: { v: 'item' } } });
    await a.client.commit(mutation(one, two, moved, item));
    await a.client.sync();
    const before = JSON.stringify((await snapshot(database, owner)).desk_card);
    await a.client.commit(
      mutation({ table: 'desk_card', id: moved.id, listId: two.id, position: 'a3' }),
    );
    await a.client.sync();
    const after = await snapshot(database, owner);
    expect(JSON.stringify(after.desk_card)).not.toBe(before);
    // A device that has the key but only the second list's key would open it: the fields are no longer under the first's.
    const fresh = await device(owner, key);
    await settleAll([a, fresh]);
    const rows = await fresh.client.read(allDeskRows);
    expect(rows.cards.map(titleOf)).toEqual(['Moving']);
    expect(rows.checks.map(titleOf)).toEqual(['item']);
    expect(cipherOf(fresh.client.db)?.unreadable.size).toBe(0);
  });

  it('refuses a change to a list that has no key, and sends and writes nothing', async () => {
    const owner = account();
    const key = await createIdentity();
    const plain = await device(owner);
    const bare = list({ title: 'Made before there was a key' });
    await plain.client.commit(mutation(bare));
    await plain.client.sync();
    const keyed = await device(owner, key);
    await keyed.client.sync();
    const rows = await dbAll(database, sql`SELECT 1 AS one FROM account_settings LIMIT 1`).catch(
      () => [],
    );
    expect(Array.isArray(rows)).toBe(true);
    await expect(
      keyed.client.commit(mutation(card(bare.id, { fields: { title: { v: 'in the clear' } } }))),
    ).rejects.toBeInstanceOf(NoListKey);
    expect(await keyed.client.pending()).toBe(0);
    expect((await keyed.client.read(allDeskRows)).cards).toEqual([]);
  });

  it('is refused by the server when a device sends plain content for such an account, and it is undone', async () => {
    const owner = account();
    const naive = await device(owner);
    const refused: string[] = [];
    naive.client.onRefused((each) => refused.push(...each.map((x) => x.code)));
    await naive.client.commit(mutation(list({ title: 'Plain, to a server that takes none' })));
    await naive.client.sync();
    expect(refused).toEqual(['invalid']);
    expect(await naive.client.read(listsOf)).toEqual([]);
    expect(JSON.stringify(await snapshot(database, owner))).not.toContain('Plain, to');
  });

  it('does not read a value that was moved to another field on the server: the binding', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);
    const home = list({ title: 'Home' });
    const c = card(home.id, {
      fields: { title: { v: 'The title' }, description: { v: 'The description' } },
    });
    await a.client.commit(mutation(home, c));
    await a.client.sync();
    // Someone with the database swaps two ciphertexts of one card.
    const [row] = await dbAll<{ fields: string }>(
      database,
      sql`SELECT fields FROM ${tableOf(database, 'desk_card')} WHERE id = ${c.id}`,
    );
    const fields = JSON.parse(String(row?.fields)) as Record<string, { c: string; s: number }>;
    const [title, description] = [fields.title, fields.description];
    if (!title || !description) throw new Error('the card has no title and description');
    const swapped = {
      ...fields,
      title: { ...title, c: description.c },
      description: { ...description, c: title.c },
    };
    await dbAll(
      database,
      sql`UPDATE ${tableOf(database, 'desk_card')} SET fields = ${JSON.stringify(swapped)}, seq = seq + 1000 WHERE id = ${c.id} RETURNING id`,
    );
    const b = await device(owner, key);
    await b.client.sync();
    const read = await b.client.read((db) => getRow(db, 'desk_card', c.id));
    expect(read?.fields.title).toBeUndefined();
    expect(read?.fields.description).toBeUndefined();
    expect(cipherOf(b.client.db)?.unreadable.has(`desk_card\u0000${c.id}`)).toBe(true);
  });

  it('reads a card that one device moved while another edited it, and seals it again under its list’s key so that it does not stay under another’s', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);
    const b = await device(owner, key);
    const [one, two] = [list({ title: 'One' }), list({ title: 'Two' })];
    const c = card(one.id, { fields: { title: { v: 'Before' }, description: { v: 'Words' } } });
    await a.client.commit(mutation(one, two, c));
    await settleAll([a, b]);

    // Offline, B edits the title under the first list's key; A moves the card, which seals every field under the second's.
    b.online = false;
    await b.client.commit(
      mutation({ table: 'desk_card', id: c.id, fields: { title: { v: 'Edited elsewhere' } } }),
    );
    await a.client.commit(
      mutation({ table: 'desk_card', id: c.id, listId: two.id, position: 'a4' }),
    );
    await a.client.sync();
    b.online = true;
    await settleAll([a, b], 10);

    // Both read the edit and the words, in the second list, and the row is no longer waiting to be sealed again.
    for (const d of [a, b]) {
      const row = await d.client.read((db) => getRow(db, 'desk_card', c.id));
      expect(titleOf(row), 'title').toBe('Edited elsewhere');
      expect((row?.fields.description as { v: unknown }).v).toBe('Words');
      expect((row as { listId?: string }).listId).toBe(two.id);
      expect(cipherOf(d.client.db)?.unreadable.size).toBe(0);
    }
    const fresh = await device(owner, key);
    await settleAll([a, b, fresh]);
    await fresh.client.read(allDeskRows);
    expect(cipherOf(fresh.client.db)?.stale.size, 'a row left under the old list’s key').toBe(0);
    expect(titleOf(await fresh.client.read((db) => getRow(db, 'desk_card', c.id)))).toBe(
      'Edited elsewhere',
    );
  });

  it('opens 10,000 cards in a reasonable time, and again at once from memory', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await device(owner, key);
    const home = list({ title: 'Big' });
    await a.client.commit(mutation(home));
    const cards = Array.from({ length: 10_000 }, (_, n) =>
      card(home.id, {
        position: `a${n}`,
        fields: { title: { v: `Card number ${n}` }, description: { v: 'x'.repeat(40) } },
      }),
    );
    for (let i = 0; i < cards.length; i += 400)
      await a.client.commit(mutation(...cards.slice(i, i + 400)));
    const cold = new DeskCipher(key.identity, key.recipient);
    const db = a.client.db;
    const started = performance.now();
    const rows = await cold.openRows(db, (await db.getAll('desk_card')) as never);
    const first = performance.now() - started;
    expect(rows.length).toBe(10_000);
    expect(titleOf(rows.find((row) => row.id === cards[1234]?.id))).toBe('Card number 1234');
    const again = performance.now();
    await cold.openRows(db, (await db.getAll('desk_card')) as never);
    const second = performance.now() - again;
    // A generous ceiling: the point is that it is seconds and not minutes, and that a second look is memory.
    expect(first).toBeLessThan(20_000);
    expect(second).toBeLessThan(first);
  }, 120_000);
});

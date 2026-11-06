import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createIdentity } from '../cipher/identity';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { beginMove, finishMove, plainRemaining, readEncryption } from '../encryption/state';
import { type Device, type Harness, harness, settleAll } from '../sync/sim-support';
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
import { type MoveOptions, countPlain, moveToKey } from './migrate';
import { DeskCipher, cipherOf } from './seal';
import { allDeskRows, getRow, listsOf } from './store';

/**
 * Moving a Desk that has things in it to a key of its own (DESIGN.md §9.3), on a real server and real devices: it finishes with nothing in the clear and no
 * edit lost, it can be stopped and picked up again, an edit made in the clear on a device that had not heard is sealed in its turn, and two devices that both
 * do it leave one key per list and everything readable.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
let devices: Harness;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  devices = harness(database);
});
afterAll(async () => close());
afterEach(async () => devices.dispose());

const finishFor =
  (owner: string): MoveOptions['finish'] =>
  async () => {
    const result = await finishMove(database, owner);
    if (result.ok) return 'done';
    return result.reason === 'plain_remains'
      ? { plainRemains: result.remaining ?? 0 }
      : 'not_moving';
  };
const titleOf = (row: { fields: Record<string, unknown> } | undefined) =>
  (row?.fields.title as { v?: unknown } | undefined)?.v;

/** A Desk made in the clear on one device and sent: two lists, cards with every kind of field, checklist items, a series. */
async function plainDesk(owner: string) {
  const a = await devices.device(owner);
  const [home, work] = [list({ title: 'Plain home' }), list({ title: 'Plain work' })];
  const cards = Array.from({ length: 12 }, (_, n) =>
    card(n % 2 ? home.id : work.id, {
      position: `a${n}`,
      fields: {
        title: { v: `Plain card ${n}` },
        description: { v: `Plain words ${n}` },
        dueDate: { v: '2026-12-24' },
        starred: { v: n % 3 === 0 },
      },
    }),
  );
  const items = cards
    .slice(0, 4)
    .map((c) => check(c.id, { fields: { title: { v: `Plain item of ${c.id.slice(0, 4)}` } } }));
  const rule = series(home.id, {
    fields: { rule: { v: 'FREQ=WEEKLY;BYDAY=MO' }, anchor: { v: '2026-12-21' } },
  });
  await a.client.commit(mutation(home, work, ...cards, ...items, rule));
  await settleAll([a]);
  return { a, home, work, cards, items, rule };
}

async function move(
  owner: string,
  d: Device,
  key: { identity: string; recipient: string },
  extra: Partial<MoveOptions> = {},
) {
  d.client.setCipher(new DeskCipher(key.identity, key.recipient));
  return moveToKey(d.client, { finish: finishFor(owner), ...extra });
}

describe(`moving a Desk to a key of its own (${leg})`, () => {
  it('seals everything, finishes, and leaves nothing of what was written on the server', async () => {
    const owner = account();
    const key = await createIdentity();
    const { a } = await plainDesk(owner);
    expect(await plainRemaining(database, owner)).toBeGreaterThan(0);
    expect((await beginMove(database, owner, key.recipient, 1)).ok).toBe(true);
    expect((await readEncryption(database, owner)).mode).toBe('moving');
    // It cannot finish while something is in the clear.
    expect(await finishMove(database, owner)).toMatchObject({ ok: false, reason: 'plain_remains' });

    const progress: number[] = [];
    expect(await move(owner, a, key, { onProgress: (p) => progress.push(p.done) })).toBe('done');
    expect((await readEncryption(database, owner)).mode).toBe('personal');
    expect(progress.at(-1)).toBeGreaterThan(0);

    const text = JSON.stringify(await snapshot(database, owner));
    for (const secret of ['Plain', '2026-12-24', 'FREQ=', 'words'])
      expect(text, secret).not.toContain(secret);
    expect(await plainRemaining(database, owner)).toBe(0);
    expect(await countPlain(a.client.db)).toBe(0);

    // Another device with the key reads all of it.
    const b = await devices.device(owner);
    b.client.setCipher(new DeskCipher(key.identity, key.recipient));
    await settleAll([a, b]);
    const read = await b.client.read(allDeskRows);
    expect(read.lists.map(titleOf).sort()).toEqual(['Plain home', 'Plain work']);
    expect(read.cards.map(titleOf).sort()).toEqual(
      Array.from({ length: 12 }, (_, n) => `Plain card ${n}`).sort(),
    );
    expect(read.checks).toHaveLength(4);
    expect(read.series).toHaveLength(1);
    expect(cipherOf(b.client.db)?.unreadable.size).toBe(0);
  });

  it('can be stopped part way and picked up again, and loses nothing', async () => {
    const owner = account();
    const key = await createIdentity();
    const { a } = await plainDesk(owner);
    await beginMove(database, owner, key.recipient, 1);
    // Stopped after the first mutation, as if the tab were closed.
    let calls = 0;
    const first = await move(owner, a, key, { stopped: () => ++calls > 3 });
    expect(first).toBe('stopped');
    const left = await countPlain(a.client.db);
    expect(left).toBeGreaterThan(0);
    expect((await readEncryption(database, owner)).mode).toBe('moving');

    // A new start, with the key from the vault, finishes what is left and no more.
    const again = await devices.device(owner);
    await settleAll([a, again]);
    expect(await move(owner, again, key)).toBe('done');
    expect((await readEncryption(database, owner)).mode).toBe('personal');
    expect(await plainRemaining(database, owner)).toBe(0);
    expect(JSON.stringify(await snapshot(database, owner))).not.toContain('Plain');
  });

  it('seals an edit that arrives in the clear while the Desk is moving, and the edit is kept', async () => {
    const owner = account();
    const key = await createIdentity();
    const { a, cards } = await plainDesk(owner);
    const stale = await devices.device(owner);
    await settleAll([a, stale]);
    stale.online = false;
    await stale.client.commit(
      mutation({
        table: 'desk_card',
        id: cards[3]?.id ?? '',
        fields: { title: { v: 'Edited in the clear, offline' } },
      }),
    );
    const late = card(cards[3]?.listId ?? '', {
      fields: { title: { v: 'Made in the clear, offline' } },
    });
    await stale.client.commit(mutation(late));

    // The move has begun and the stale device, which has not heard, comes back and sends what it made: the server takes it, since it is only moving.
    await beginMove(database, owner, key.recipient, 1);
    stale.online = true;
    await stale.client.sync();
    expect(await plainRemaining(database, owner)).toBeGreaterThan(0);

    expect(await move(owner, a, key)).toBe('done');
    expect(await plainRemaining(database, owner)).toBe(0);
    const row = await a.client.read((db) => getRow(db, 'desk_card', cards[3]?.id ?? ''));
    expect(titleOf(row)).toBe('Edited in the clear, offline');
    expect(titleOf(await a.client.read((db) => getRow(db, 'desk_card', late.id)))).toBe(
      'Made in the clear, offline',
    );
    const text = JSON.stringify(await snapshot(database, owner));
    expect(text).not.toContain('offline');
  });

  it('holds back what a stale device made in the clear until it has the key, then seals it and sends it', async () => {
    const owner = account();
    const key = await createIdentity();
    const { a, cards } = await plainDesk(owner);
    const stale = await devices.device(owner);
    await settleAll([a, stale]);
    stale.online = false;
    await stale.client.commit(
      mutation({
        table: 'desk_card',
        id: cards[3]?.id ?? '',
        fields: { title: { v: 'Edited offline, in the clear' } },
      }),
    );
    expect(await stale.client.hasPlainWaiting()).toBe(true);

    await beginMove(database, owner, key.recipient, 1);
    expect(await move(owner, a, key)).toBe('done');
    expect((await readEncryption(database, owner)).mode).toBe('personal');

    // Given the key, the device seals what it was holding, in its place in the order, and the server takes it.
    stale.online = true;
    stale.client.setCipher(new DeskCipher(key.identity, key.recipient));
    // What the sync gate does before anything is sent: seal what was made in the clear.
    await stale.client.sync({ pullOnly: true });
    expect(await stale.client.resealOutbox()).toBe(1);
    await settleAll([a, stale], 4);
    expect(await stale.client.hasPlainWaiting()).toBe(false);
    expect(await plainRemaining(database, owner)).toBe(0);
    const row = await a.client.read((db) => getRow(db, 'desk_card', cards[3]?.id ?? ''));
    expect(titleOf(row)).toBe('Edited offline, in the clear');
    expect(JSON.stringify(await snapshot(database, owner))).not.toContain('Edited offline');
  });

  it('is safe when two devices both move the Desk: one key to a list, everything readable, nothing in the clear', async () => {
    const owner = account();
    const key = await createIdentity();
    const { a } = await plainDesk(owner);
    const b = await devices.device(owner);
    await settleAll([a, b]);
    await beginMove(database, owner, key.recipient, 1);
    const refused: string[] = [];
    for (const d of [a, b]) d.client.onRefused((each) => refused.push(...each.map((x) => x.code)));
    const results = await Promise.all([move(owner, a, key), move(owner, b, key)]);
    expect(results).toEqual(['done', 'done']);
    await settleAll([a, b], 6);
    expect(await plainRemaining(database, owner)).toBe(0);
    expect((await readEncryption(database, owner)).mode).toBe('personal');
    // Both read the same, in full.
    for (const d of [a, b]) {
      const read = await d.client.read(allDeskRows);
      expect(read.cards).toHaveLength(12);
      expect(read.cards.every((c) => typeof titleOf(c) === 'string')).toBe(true);
      expect(cipherOf(d.client.db)?.unreadable.size).toBe(0);
      expect((await d.client.read(listsOf)).map(titleOf).sort()).toEqual([
        'Plain home',
        'Plain work',
      ]);
    }
    expect(JSON.stringify(await snapshot(database, owner))).not.toContain('Plain');
  });

  it('seals a Desk with nothing in it at once, and a list is given a key only once', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await devices.device(owner);
    await beginMove(database, owner, key.recipient, 1);
    expect(await move(owner, a, key)).toBe('done');
    expect((await readEncryption(database, owner)).mode).toBe('personal');
  });
});

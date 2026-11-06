import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { completeCard } from '../actions/cards';
import { setRepeat } from '../actions/series';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import type { LocalRow } from '../local/rows';
import { cardsOf, checksOf, getRow } from '../local/store';
import { type Device, type Harness, harness, settleAll as settleDevices } from './sim-support';
import { account, id, makeStore } from './test-support';

/**
 * A repeating card on two devices that were apart (DESIGN.md §8.4, §12.1), against the real server on whichever database the leg runs: completing it
 * makes one next occurrence, the same one on every device, and two devices that completed it on different days end with one open occurrence. The
 * harness is `sim-support.ts`, the one the convergence suite (`simulate.test.ts`) uses too.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

let devices: Harness;
beforeAll(() => {
  devices = harness(database);
});
afterEach(async () => devices.dispose());

const device = (owner: string) => devices.device(owner);
const settleAll = (...all: Device[]) => settleDevices(all);

const ids = { newId: () => crypto.randomUUID() };
const everyCard = async (d: Device) =>
  ((await d.client.db.getAll('desk_card')) as LocalRow[]).sort((a, b) => (a.id < b.id ? -1 : 1));
const live = (rows: LocalRow[]) => rows.filter((row) => row.deletedAt === null);
const plain = (row: LocalRow, name: string) => {
  const field = row.fields[name];
  return field && 'v' in field ? field.v : undefined;
};
const summary = (rows: LocalRow[]) =>
  live(rows)
    .map(
      (row) =>
        `${plain(row, 'title')}|${plain(row, 'dueDate')}|${plain(row, 'completedAt') ? 'done' : 'open'}`,
    )
    .sort();

/** Two devices that have both heard of a daily card ("Water", due 2026-11-01) with a two-item checklist. */
async function twoDevices() {
  const owner = account();
  const [a, b] = [await device(owner), await device(owner)];
  const listId = id();
  const cardId = id();
  await a.client.commit({
    mutationId: id(),
    changes: [
      { table: 'desk_list', id: listId, position: 'a0', fields: { title: { v: 'Home' } } },
      {
        table: 'desk_card',
        id: cardId,
        listId,
        position: 'a0',
        fields: { title: { v: 'Water' }, dueDate: { v: '2026-11-01' } },
      },
      {
        table: 'desk_check',
        id: id(),
        cardId,
        position: 'a0',
        fields: { title: { v: 'Fill the can' } },
      },
      {
        table: 'desk_check',
        id: id(),
        cardId,
        position: 'a1',
        fields: { title: { v: 'Turn the pots' } },
      },
    ],
  });
  const card = await getRow(a.client.db, 'desk_card', cardId);
  const made = setRepeat(card, undefined, 'FREQ=DAILY', '2026-11-01', ids);
  if (!made.ok) throw new Error('could not repeat');
  await a.client.commit(made.mutation);
  await settleAll(a, b);
  return { a, b, listId, cardId };
}

/** Completes the card on one device, as its row does: the checklist and the series read from that device's own copy. */
async function complete(d: Device, cardId: string, today: string, now: number) {
  const { card, items, series } = await d.client.read(async (db) => {
    const card = await getRow(db, 'desk_card', cardId);
    const seriesId = card && plain(card, 'seriesId');
    return {
      card,
      items: await checksOf(db, cardId),
      series: typeof seriesId === 'string' ? await getRow(db, 'desk_series', seriesId) : undefined,
    };
  });
  const result = completeCard(card, now, ids, items, { series, today });
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  await d.client.commit(result.mutation);
}

describe(`a repeating card on two devices (${leg})`, () => {
  it('makes the next occurrence on completing, with its checklist unticked, and it arrives on the other device', async () => {
    const { a, b, listId, cardId } = await twoDevices();
    await complete(a, cardId, '2026-11-01', 1_000);
    await settleAll(a, b);
    for (const d of [a, b]) {
      expect(summary(await everyCard(d))).toEqual([
        'Water|2026-11-01|done',
        'Water|2026-11-02|open',
      ]);
      const next = (await cardsOf(d.client.db, listId)).find(
        (c) => plain(c, 'completedAt') === undefined || plain(c, 'completedAt') === null,
      );
      expect(next).toBeDefined();
      const items = await checksOf(d.client.db, next?.id ?? '');
      expect(items.map((i) => plain(i, 'title'))).toEqual(['Fill the can', 'Turn the pots']);
      expect(items.every((i) => !plain(i, 'completedAt'))).toBe(true);
    }
  });

  it('makes one next when two devices complete it offline on the same day, however many times each taps', async () => {
    const { a, b, cardId } = await twoDevices();
    a.online = false;
    b.online = false;
    await complete(a, cardId, '2026-11-01', 1_000);
    await complete(b, cardId, '2026-11-01', 2_000);
    // A second tap on the same device finds the card done already and does nothing.
    await expect(complete(a, cardId, '2026-11-01', 3_000)).rejects.toThrow(/nothing/);
    a.online = true;
    b.online = true;
    await settleAll(a, b);
    expect(summary(await everyCard(a))).toEqual(['Water|2026-11-01|done', 'Water|2026-11-02|open']);
    expect(await everyCard(a)).toEqual(await everyCard(b));
    // It is one row and not two with one deleted: both devices made the same id, so nothing had to be settled.
    expect(await everyCard(a)).toHaveLength(2);
    // The next occurrence's checklist is two items, not four.
    const next = live(await everyCard(a)).find((c) => !plain(c, 'completedAt'));
    expect((await checksOf(a.client.db, next?.id ?? '')).length).toBe(2);
    expect((await checksOf(b.client.db, next?.id ?? '')).length).toBe(2);
  });

  it('settles on one open occurrence when two devices complete it on different days: the earlier stays, and both agree', async () => {
    const { a, b, cardId } = await twoDevices();
    a.online = false;
    b.online = false;
    await complete(a, cardId, '2026-11-01', 1_000);
    await complete(b, cardId, '2026-11-05', 2_000);
    a.online = true;
    b.online = true;
    await settleAll(a, b);
    const expected = ['Water|2026-11-01|done', 'Water|2026-11-06|open'];
    // The one made on the 1st would be due the 2nd; the one made on the 5th, the 6th. The earlier is kept.
    const after = summary(await everyCard(a));
    expect(after).toEqual(['Water|2026-11-01|done', 'Water|2026-11-02|open']);
    expect(after).not.toEqual(expected);
    expect(await everyCard(a)).toEqual(await everyCard(b));
    expect(live(await everyCard(a)).filter((c) => !plain(c, 'completedAt'))).toHaveLength(1);
  });

  it('keeps ticking along: completing the next makes the one after, and each series has one open occurrence at a time', async () => {
    const { a, b, cardId } = await twoDevices();
    await complete(a, cardId, '2026-11-01', 1_000);
    await settleAll(a, b);
    const second = live(await everyCard(b)).find((c) => !plain(c, 'completedAt'));
    await complete(b, second?.id ?? '', '2026-11-02', 2_000);
    await settleAll(a, b);
    expect(summary(await everyCard(a))).toEqual([
      'Water|2026-11-01|done',
      'Water|2026-11-02|done',
      'Water|2026-11-03|open',
    ]);
    expect(await everyCard(a)).toEqual(await everyCard(b));
  });
});

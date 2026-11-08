import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { type Database, openDatabase } from '../db/client';
import { dbAll } from '../db/exec';
import { runMigrations } from '../db/migrate';
import { testTarget } from '../db/test-support';
import { RateLimiter } from '../limits/rate';
import { setUpPersonalKey } from '../encryption/state';
import { saveSettings } from '../settings/account-settings';
import type { Channel, Outgoing } from '../notifications/channels';
import { deliverNotices, noticeText } from '../notifications/deliver';
import { tick } from '../notifications/job';
import { openText } from '../workspaces/content';
import { putSlots } from './endpoint';
import { claimSlot, dueSlots, forgetSlots, parseSlots, pruneSlots, replaceSlots } from './slots';

/**
 * The times a device uploads for a Desk the server cannot read (DESIGN.md §25.2, task 14.6), on every form of the database: what the body may hold, who may send it, what a
 * claim does, and that the notice made from a slot says nothing of a card. The time is given to every call.
 */
const { leg } = testTarget();
const MINUTE = 60_000;
const NOW = Date.parse('2026-11-08T09:00:00Z');
const RECIPIENT = `age1${'q'.repeat(58)}`;
let t: TwoAccounts;
let database: Database;
beforeAll(async () => {
  t = await twoAccounts();
  database = await openDatabase(testTarget().config, 'app');
  await runMigrations(database);
});
afterAll(async () => {
  await database.close();
  await t.close();
});

const rowsOf = (who: string) =>
  dbAll<{ at: number | string; claimedAt: number | string | null }>(
    database,
    sql`SELECT at, claimed_at AS "claimedAt" FROM reminder_slot WHERE account_id = ${who} ORDER BY at`,
  ).then((rows) =>
    rows.map((row) => ({
      at: Number(row.at),
      claimedAt: row.claimedAt === null ? null : Number(row.claimedAt),
    })),
  );

describe('what the body may hold', () => {
  it('is the instants to the minute, within the fortnight, and nothing else', () => {
    expect(parseSlots({ slots: [NOW + MINUTE, NOW + 2 * MINUTE] }, NOW)).toEqual({
      ok: true,
      value: [NOW + MINUTE, NOW + 2 * MINUTE],
    });
    // Repeats are one slot, and the order is made.
    expect(parseSlots({ slots: [NOW + 2 * MINUTE, NOW + MINUTE, NOW + MINUTE] }, NOW)).toEqual({
      ok: true,
      value: [NOW + MINUTE, NOW + 2 * MINUTE],
    });
    expect(parseSlots({ slots: [] }, NOW).ok).toBe(true);
    for (const bad of [
      null,
      [],
      { slots: 'x' },
      { slots: [NOW + 1] },
      { slots: [NOW + 20 * 24 * 60 * MINUTE] },
      { slots: [NOW - 2 * 60 * MINUTE] },
      { slots: [1.5 * MINUTE] },
      { slots: ['soon'] },
      { slots: Array.from({ length: 701 }, (_, i) => NOW + i * MINUTE) },
      // A card cannot be named here: any other key is refused.
      { slots: [], cardId: 'a3d9' },
      { slots: [{ at: NOW, cardId: 'a3d9' }] },
    ])
      expect(parseSlots(bad, NOW).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe(`a slot's life (${leg})`, () => {
  it('is kept only for a Desk with a key of its own', async () => {
    const who = crypto.randomUUID();
    expect(await replaceSlots(database, who, [NOW + MINUTE])).toBe('not_personal');
    expect(await rowsOf(who)).toEqual([]);
    expect((await setUpPersonalKey(database, who, RECIPIENT, 1)).ok).toBe(true);
    expect(await replaceSlots(database, who, [NOW + MINUTE])).toBe('replaced');
    expect(await rowsOf(who)).toEqual([{ at: NOW + MINUTE, claimedAt: null }]);
  });

  it('is replaced as a set, and one already claimed stays claimed and is not armed again', async () => {
    const who = crypto.randomUUID();
    await setUpPersonalKey(database, who, RECIPIENT, 1);
    await replaceSlots(database, who, [NOW + MINUTE, NOW + 2 * MINUTE]);
    await dbAll(
      database,
      sql`UPDATE reminder_slot SET claimed_at = ${NOW} WHERE account_id = ${who} AND at = ${NOW + MINUTE} RETURNING at`,
    );
    await replaceSlots(database, who, [NOW + MINUTE, NOW + 3 * MINUTE]);
    expect(await rowsOf(who)).toEqual([
      { at: NOW + MINUTE, claimedAt: NOW },
      { at: NOW + 3 * MINUTE, claimedAt: null },
    ]);
  });

  it('is claimed by one process only, and only while it is not late', async () => {
    const who = crypto.randomUUID();
    await setUpPersonalKey(database, who, RECIPIENT, 1);
    await saveSettings(database, who, { remindersOn: true }, 1);
    await replaceSlots(database, who, [NOW - 10 * MINUTE, NOW + 10 * MINUTE]);
    const due = (await dueSlots(database, NOW, 10)).filter((slot) => slot.accountId === who);
    expect(due).toEqual([{ accountId: who, at: NOW - 10 * MINUTE }]);
    const results = await Promise.all([
      claimSlot(database, who, NOW - 10 * MINUTE, NOW),
      claimSlot(database, who, NOW - 10 * MINUTE, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // Late is too late: an hour on, the first is not due any more.
    expect(
      (await dueSlots(database, NOW + 60 * MINUTE, 10)).filter((slot) => slot.accountId === who),
    ).toEqual([]);
    // And it is not claimed for an account with reminders off.
    await saveSettings(database, who, { remindersOn: false }, 2);
    expect(
      (await dueSlots(database, NOW + 10 * MINUTE, 10)).filter((slot) => slot.accountId === who),
    ).toEqual([]);
  });

  it('is pruned a day on, and goes with the person', async () => {
    const who = crypto.randomUUID();
    await setUpPersonalKey(database, who, RECIPIENT, 1);
    await replaceSlots(database, who, [NOW + MINUTE]);
    await pruneSlots(database, NOW + 2 * 24 * 60 * MINUTE);
    expect(await rowsOf(who)).toEqual([]);
    await replaceSlots(database, who, [NOW + MINUTE]);
    expect(await forgetSlots(database, who)).toBe(1);
  });
});

describe(`the job makes a notice that says nothing of a card (${leg})`, () => {
  it('writes one notice for a slot that has come: "cards due", with no subject, once', async () => {
    const who = crypto.randomUUID();
    await setUpPersonalKey(database, who, RECIPIENT, 1);
    await saveSettings(database, who, { remindersOn: true, timeZone: 'UTC' }, 1);
    await replaceSlots(database, who, [NOW - 5 * MINUTE]);
    const first = await tick(database, NOW);
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    const notices = await dbAll<{
      id: string;
      kind: string;
      details: string;
      cardId: string | null;
    }>(
      database,
      sql`SELECT id, kind, details, card_id AS "cardId" FROM notice WHERE account_id = ${who}`,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('reminder');
    expect(notices[0]?.cardId).toBeNull();
    const [notice] = notices as [(typeof notices)[number]];
    expect(JSON.parse(openText('notice', notice.id, 'details', notice.details))).toEqual({
      title: '',
    });
    // Outside the app it says only that cards are due, and asks a device to look for itself: Push is told to wake, and no other channel is given a title.
    const seen: Outgoing[] = [];
    const recorder: Channel = {
      name: 'test',
      send: async (out) => {
        seen.push(out);
        return { outcome: 'sent' };
      },
    };
    await deliverNotices(database, [recorder], NOW);
    expect(seen.filter((each) => each.accountId === who)).toEqual([
      {
        accountId: who,
        kind: 'reminder',
        title: 'You have cards due',
        path: '/desk',
        key: notice.id,
        wake: true,
      },
    ]);
    expect(noticeText('reminder', '')).toBe('You have cards due');
    expect(noticeText('reminder', 'Pay the rent')).toBe('Due now: “Pay the rent”');
    // A second look at the same minute, and the next one, write nothing more.
    await tick(database, NOW);
    await tick(database, NOW + MINUTE);
    expect(
      await dbAll(database, sql`SELECT id FROM notice WHERE account_id = ${who}`),
    ).toHaveLength(1);
  });
});

describe('who may call the route', () => {
  const deps = () => ({ database, limiter: new RateLimiter(database), now: () => NOW });
  const route = () =>
    accountRoute(({ request, accountId }) => putSlots(request, accountId, deps()), t.deps);

  it('refuses no session (401) and another site (403), and writes nothing', async () => {
    await setUpPersonalKey(database, t.ada.id, RECIPIENT, 1);
    const put = route();
    const body = { slots: [NOW + MINUTE] };
    expect(
      (await put(t.request(null, '/api/reminders/slots', { method: 'PUT', body }))).status,
    ).toBe(401);
    expect(
      (
        await put(
          t.request(t.ada, '/api/reminders/slots', {
            method: 'PUT',
            body,
            headers: { origin: 'https://evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
    expect(await rowsOf(t.ada.id)).toEqual([]);
  });

  it('keeps the signed-in account’s own times, says 409 for a plain Desk, and 400 for a body that names anything else', async () => {
    const put = route();
    const send = (who: typeof t.ada, body: unknown) =>
      put(t.request(who, '/api/reminders/slots', { method: 'PUT', body }));
    expect((await send(t.ada, { slots: [NOW + MINUTE] })).status).toBe(200);
    expect(await rowsOf(t.ada.id)).toEqual([{ at: NOW + MINUTE, claimedAt: null }]);
    // Grace's Desk is plain: her upload is refused, and Ada's rows are as they were.
    expect((await send(t.grace, { slots: [NOW + MINUTE] })).status).toBe(409);
    expect(await rowsOf(t.grace.id)).toEqual([]);
    expect((await send(t.ada, { slots: [NOW + MINUTE], card: 'a3d9' })).status).toBe(400);
    expect((await send(t.ada, { slots: ['x'] })).status).toBe(400);
    expect(await rowsOf(t.ada.id)).toEqual([{ at: NOW + MINUTE, claimedAt: null }]);
  });
});

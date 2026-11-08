import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll, dbRun } from '../db/exec';
import { testTarget } from '../db/test-support';
import { saveSettings } from '../settings/account-settings';
import { applyMutation } from '../sync/apply';
import { account, card, list, makeStore, mutation } from '../sync/test-support';
import { openText } from '../workspaces/content';
import { seedWorld, type World } from '../workspaces/testing/roles';
import { briefLine, minusMinutes, tick } from './job';

/**
 * The daily brief and the reminders at a due time (DESIGN.md §25.2, tasks 8.5 and 8.6), on every form of the database. The time is given to every call: nothing here reads a clock.
 */
const { leg } = testTarget();
const at = (iso: string) => Date.parse(iso);
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

/** An account with its settings, and a Desk card that is due as given. */
async function person(
  settings: Parameters<typeof saveSettings>[2],
  cards: { title?: string; dueDate?: string; dueTime?: string; completedAt?: number }[] = [],
) {
  const who = account();
  await saveSettings(database, who, settings, 1);
  const l = list();
  const made = cards.map((each) =>
    card(l.id, {
      fields: {
        title: { v: each.title ?? 'A card' },
        ...(each.dueDate ? { dueDate: { v: each.dueDate } } : {}),
        ...(each.dueTime ? { dueTime: { v: each.dueTime } } : {}),
        ...(each.completedAt ? { completedAt: { v: each.completedAt } } : {}),
      },
    }),
  );
  await applyMutation(database, who, mutation(l, ...made), { now: 1 });
  return { who, cards: made };
}

async function noticesOf(who: string) {
  const rows = await dbAll<{ id: string; kind: string; details: string }>(
    database,
    sql`SELECT id, kind, details FROM notice WHERE account_id = ${who} ORDER BY created_at, id`,
  );
  return rows.map((row) => ({
    kind: row.kind,
    text: (JSON.parse(openText('notice', row.id, 'details', row.details)) as { title: string })
      .title,
  }));
}

describe('the lines and the arithmetic', () => {
  it('says the counts that are not nothing', () => {
    expect(briefLine(3, 2)).toBe('3 due today · 2 overdue');
    expect(briefLine(0, 2)).toBe('2 overdue');
    expect(briefLine(1, 0)).toBe('1 due today');
    expect(briefLine(0, 0)).toBe('');
  });
  it('takes minutes from a time and stops at midnight', () => {
    expect(minusMinutes('09:00', 30)).toBe('08:30');
    expect(minusMinutes('10:05', 10)).toBe('09:55');
    expect(minusMinutes('00:10', 30)).toBe('00:00');
  });
});

describe(`the daily brief (${leg})`, () => {
  it('is written once a local day, at its time, and not before', async () => {
    const { who } = await person({ briefOn: true, briefAt: '08:00', timeZone: 'UTC' }, [
      { dueDate: '2026-11-08' },
      { dueDate: '2026-11-01' },
      { dueDate: '2026-11-20' },
      { dueDate: '2026-11-08', completedAt: 5 },
    ]);
    expect(await tick(database, at('2026-11-08T07:59:00Z'))).toMatchObject({ briefs: 0 });
    expect(await noticesOf(who)).toEqual([]);
    await tick(database, at('2026-11-08T08:00:00Z'));
    expect(await noticesOf(who)).toEqual([{ kind: 'brief', text: '1 due today · 1 overdue' }]);
    // Again the same day: nothing more.
    await tick(database, at('2026-11-08T12:00:00Z'));
    await tick(database, at('2026-11-08T23:59:00Z'));
    expect((await noticesOf(who)).length).toBe(1);
    // The next day it is written again.
    await tick(database, at('2026-11-09T08:00:00Z'));
    expect((await noticesOf(who)).length).toBe(2);
  });

  it('is sent once by two runners at the same moment', async () => {
    const { who } = await person({ briefOn: true, briefAt: '06:00', timeZone: 'UTC' }, [
      { dueDate: '2026-11-08' },
    ]);
    await Promise.all([
      tick(database, at('2026-11-08T06:00:00Z')),
      tick(database, at('2026-11-08T06:00:00Z')),
    ]);
    expect((await noticesOf(who)).filter((n) => n.kind === 'brief')).toHaveLength(1);
  });

  it('is in the account’s own zone: 08:00 is 08:00 where they are, either side of midnight in UTC', async () => {
    const auckland = await person(
      { briefOn: true, briefAt: '08:00', timeZone: 'Pacific/Auckland' },
      [{ dueDate: '2026-11-09' }],
    );
    const angeles = await person(
      { briefOn: true, briefAt: '08:00', timeZone: 'America/Los_Angeles' },
      [{ dueDate: '2026-11-08' }],
    );
    // 23:30 UTC on the 8th: Auckland is 12:30 on the 9th (past 08:00), and Los Angeles 15:30 on the 8th.
    await tick(database, at('2026-11-08T23:30:00Z'));
    expect(await noticesOf(auckland.who)).toEqual([{ kind: 'brief', text: '1 due today' }]);
    expect(await noticesOf(angeles.who)).toEqual([{ kind: 'brief', text: '1 due today' }]);
    // 08:00 on the 9th in Auckland is 19:00 UTC on the 8th: before that, it had not been sent for that day.
    const early = await person({ briefOn: true, briefAt: '08:00', timeZone: 'Pacific/Auckland' }, [
      { dueDate: '2026-11-09' },
    ]);
    await tick(database, at('2026-11-08T18:59:00Z'));
    expect(await noticesOf(early.who)).toEqual([]);
    await tick(database, at('2026-11-08T19:00:00Z'));
    expect(await noticesOf(early.who)).toEqual([{ kind: 'brief', text: '1 due today' }]);
  });

  it('writes nothing on a quiet day, and does not look again that day', async () => {
    const quiet = await person({ briefOn: true, briefAt: '08:00', timeZone: 'UTC' });
    await tick(database, at('2026-11-10T08:00:00Z'));
    expect(await noticesOf(quiet.who)).toEqual([]);
    // A card that becomes due later the same day is not in a brief that was already looked at.
    const l = list();
    await applyMutation(
      database,
      quiet.who,
      mutation(l, card(l.id, { fields: { title: { v: 'Late' }, dueDate: { v: '2026-11-10' } } })),
      { now: 2 },
    );
    await tick(database, at('2026-11-10T09:00:00Z'));
    expect(await noticesOf(quiet.who)).toEqual([]);
  });

  it('is for the person who turned it on, and counts a board card assigned to them', async () => {
    const off = await person({ briefOn: false, timeZone: 'UTC' }, [{ dueDate: '2026-11-11' }]);
    await tick(database, at('2026-11-11T09:00:00Z'));
    expect(await noticesOf(off.who)).toEqual([]);
    const w: World = await seedWorld(database);
    const member = w.accounts.boardMember;
    await saveSettings(database, member, { briefOn: true, briefAt: '08:00', timeZone: 'UTC' }, 1);
    await dbRun(
      database,
      sql`UPDATE card SET due_date = '2026-11-11', due_time = '10:00' WHERE id = ${w.cards.open}`,
    );
    await dbRun(
      database,
      sql`INSERT INTO card_assignee (card_id, account_id, board_id, assigned_by, created_at) VALUES (${w.cards.open}, ${member}, ${w.boards.publicBoard}, ${w.accounts.boardOwner}, 1)`,
    );
    await tick(database, at('2026-11-11T09:00:00Z'));
    expect(await noticesOf(member)).toEqual([{ kind: 'brief', text: '1 due today' }]);
  });
});

describe(`reminders at a due time (${leg})`, () => {
  it('fires a card once, at its time in the account’s zone, and not again', async () => {
    const { who } = await person({ remindersOn: true, timeZone: 'Pacific/Auckland' }, [
      { title: 'Call Sam', dueDate: '2026-11-12', dueTime: '09:00' },
    ]);
    // 09:00 on the 12th in Auckland is 20:00 UTC on the 11th.
    await tick(database, at('2026-11-11T19:59:00Z'));
    expect(await noticesOf(who)).toEqual([]);
    await tick(database, at('2026-11-11T20:00:00Z'));
    expect(await noticesOf(who)).toEqual([{ kind: 'reminder', text: 'Call Sam' }]);
    await tick(database, at('2026-11-11T20:01:00Z'));
    await tick(database, at('2026-11-11T20:20:00Z'));
    expect(await noticesOf(who)).toHaveLength(1);
  });

  it('fires again when its time is changed, at the new time', async () => {
    const { who, cards } = await person({ remindersOn: true, timeZone: 'UTC' }, [
      { title: 'Move me', dueDate: '2026-11-13', dueTime: '09:00' },
    ]);
    await tick(database, at('2026-11-13T09:00:00Z'));
    expect(await noticesOf(who)).toHaveLength(1);
    const id = cards[0]?.id ?? '';
    await applyMutation(
      database,
      who,
      mutation({
        table: 'desk_card',
        id,
        fields: { dueDate: { v: '2026-11-13' }, dueTime: { v: '09:30' } },
      }),
      { now: 5 },
    );
    await tick(database, at('2026-11-13T09:29:00Z'));
    expect(await noticesOf(who)).toHaveLength(1);
    await tick(database, at('2026-11-13T09:30:00Z'));
    expect(await noticesOf(who)).toHaveLength(2);
  });

  it('does not send yesterday’s missed reminder, one long past, a done card, or one for a person with reminders off', async () => {
    const on = await person({ remindersOn: true, timeZone: 'UTC' }, [
      { title: 'Yesterday', dueDate: '2026-11-13', dueTime: '09:00' },
      { title: 'Hours ago', dueDate: '2026-11-14', dueTime: '06:00' },
      { title: 'Done', dueDate: '2026-11-14', dueTime: '09:00', completedAt: 3 },
      { title: 'Later', dueDate: '2026-11-14', dueTime: '18:00' },
    ]);
    const off = await person({ remindersOn: false, timeZone: 'UTC' }, [
      { title: 'Not wanted', dueDate: '2026-11-14', dueTime: '09:00' },
    ]);
    await tick(database, at('2026-11-14T09:10:00Z'));
    expect(await noticesOf(on.who)).toEqual([]);
    expect(await noticesOf(off.who)).toEqual([]);
    // "Later" fires at its time.
    await tick(database, at('2026-11-14T18:00:00Z'));
    expect(await noticesOf(on.who)).toEqual([{ kind: 'reminder', text: 'Later' }]);
  });

  it('is sent once by two runners, and a board card goes to each person assigned who has reminders on, once', async () => {
    const w = await seedWorld(database);
    const [one, two, off] = [w.accounts.boardOwner, w.accounts.boardMember, w.accounts.member];
    for (const who of [one, two])
      await saveSettings(database, who, { remindersOn: true, timeZone: 'UTC' }, 1);
    await saveSettings(database, off, { remindersOn: false, timeZone: 'UTC' }, 1);
    await dbRun(
      database,
      sql`UPDATE card SET due_date = '2026-11-15', due_time = '09:00' WHERE id = ${w.cards.open}`,
    );
    for (const who of [one, two, off])
      await dbRun(
        database,
        sql`INSERT INTO card_assignee (card_id, account_id, board_id, assigned_by, created_at) VALUES (${w.cards.open}, ${who}, ${w.boards.publicBoard}, ${one}, 1)`,
      );
    await Promise.all([
      tick(database, at('2026-11-15T09:00:00Z')),
      tick(database, at('2026-11-15T09:00:00Z')),
    ]);
    expect(await noticesOf(one)).toEqual([{ kind: 'reminder', text: 'Open one' }]);
    expect(await noticesOf(two)).toEqual([{ kind: 'reminder', text: 'Open one' }]);
    expect(await noticesOf(off)).toEqual([]);
  });

  it('writes at most the cap in a tick, and the rest wait for the next', async () => {
    const { who } = await person({ remindersOn: true, timeZone: 'UTC' }, [
      { title: 'a', dueDate: '2026-11-16', dueTime: '09:00' },
      { title: 'b', dueDate: '2026-11-16', dueTime: '09:00' },
      { title: 'c', dueDate: '2026-11-16', dueTime: '09:00' },
    ]);
    expect(await tick(database, at('2026-11-16T09:00:00Z'), { cap: 2 })).toMatchObject({
      reminders: 2,
    });
    expect(await noticesOf(who)).toHaveLength(2);
    expect(await tick(database, at('2026-11-16T09:01:00Z'), { cap: 2 })).toMatchObject({
      reminders: 1,
    });
    expect(await noticesOf(who)).toHaveLength(3);
  });
});

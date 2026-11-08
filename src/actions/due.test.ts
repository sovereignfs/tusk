import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { createDueCard, dueOf, setDue } from './due';

const ids = { newId: () => crypto.randomUUID() };
/** A card whose fields are the given plain values (or `{ c }` for sealed ones), each stamped. */
const card = (given: Record<string, unknown> = {}): LocalRow => {
  const fields = Object.fromEntries(
    Object.entries({ title: 'x', ...given }).map(([name, value]) => [
      name,
      typeof value === 'object' && value !== null && 'c' in value
        ? { ...(value as object), s: 1 }
        : { v: value, s: 1 },
    ]),
  );
  return rowOf(fields);
};
const rowOf = (fields: Record<string, unknown>): LocalRow =>
  ({
    table: 'desk_card',
    id: crypto.randomUUID(),
    ownerId: 'a',
    listId: crypto.randomUUID(),
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields,
  }) as unknown as LocalRow;

describe('setting what a Desk card is due', () => {
  it('writes the date and the time together, in one change', () => {
    const result = setDue(card(), { date: '2026-11-07', time: '09:30' }, ids);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.mutation.changes).toHaveLength(1);
    expect(result.mutation.changes[0]).toMatchObject({
      table: 'desk_card',
      fields: { dueDate: { v: '2026-11-07' }, dueTime: { v: '09:30' } },
    });
  });

  it('clears the time with the date: there is no time without a date', () => {
    const due = card({ dueDate: '2026-11-07', dueTime: '09:30' });
    const result = setDue(due, { date: null, time: '10:00' }, ids);
    expect(result.ok && result.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: null }, dueTime: { v: null } },
    });
  });

  it('can set a date alone, and take a time off a date that keeps it', () => {
    const withTime = card({ dueDate: '2026-11-07', dueTime: '09:30' });
    const result = setDue(withTime, { date: '2026-11-07', time: null }, ids);
    expect(result.ok && result.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: '2026-11-07' }, dueTime: { v: null } },
    });
  });

  it('writes nothing when nothing changes, and nothing for a card that is not there', () => {
    const due = card({ dueDate: '2026-11-07', dueTime: null });
    expect(setDue(due, { date: '2026-11-07', time: null }, ids)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(setDue(card(), { date: null, time: '09:00' }, ids)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(setDue(undefined, { date: '2026-11-07', time: null }, ids)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('reads what a card is due, and takes a time with no date, or a sealed date, for none', () => {
    expect(dueOf(card({ dueDate: '2026-11-07', dueTime: '09:30' }))).toEqual({
      date: '2026-11-07',
      time: '09:30',
      end: null,
    });
    expect(dueOf(card({ dueDate: null, dueTime: '09:30' }))).toEqual({
      date: null,
      time: null,
      end: null,
    });
    expect(dueOf(card({ dueDate: { c: 'YWdl' }, dueTime: { c: 'YWdl' } }))).toEqual({
      date: null,
      time: null,
      end: null,
    });
  });
});

describe('a card that ends (task 19.5)', () => {
  const timed = { dueDate: '2026-11-07', dueTime: '09:30' };

  it('reads an end only with a time and after it', () => {
    expect(dueOf(card({ ...timed, dueEnd: '10:15' })).end).toBe('10:15');
    // Not after the time, no time, no date: none.
    expect(dueOf(card({ ...timed, dueEnd: '09:30' })).end).toBeNull();
    expect(dueOf(card({ ...timed, dueEnd: '09:00' })).end).toBeNull();
    expect(dueOf(card({ dueDate: '2026-11-07', dueEnd: '10:15' })).end).toBeNull();
    expect(dueOf(card({ dueEnd: '10:15' })).end).toBeNull();
    expect(dueOf(card(timed)).end).toBeNull();
  });

  it('is written with the date and the time, in the one change, and cleared with them', () => {
    const set = setDue(card(), { date: '2026-11-07', time: '09:30', end: '10:15' }, ids);
    expect(set.ok && set.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: '2026-11-07' }, dueTime: { v: '09:30' }, dueEnd: { v: '10:15' } },
    });
    // An end alone changes the card, and the same end changes nothing.
    const only = setDue(card(timed), { date: '2026-11-07', time: '09:30', end: '11:00' }, ids);
    expect(only.ok).toBe(true);
    expect(
      setDue(
        card({ ...timed, dueEnd: '11:00' }),
        { date: '2026-11-07', time: '09:30', end: '11:00' },
        ids,
      ),
    ).toEqual({ ok: false, reason: 'nothing' });
    // No time, so no end; no date, so none of them.
    const noTime = setDue(card(), { date: '2026-11-07', time: null, end: '10:15' }, ids);
    expect(noTime.ok && noTime.mutation.changes[0]).toMatchObject({
      fields: { dueEnd: { v: null } },
    });
    const none = setDue(
      card({ ...timed, dueEnd: '11:00' }),
      { date: null, time: '09:30', end: '11:00' },
      ids,
    );
    expect(none.ok && none.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: null }, dueTime: { v: null }, dueEnd: { v: null } },
    });
    // An end that is not after the time is not written.
    const early = setDue(card(), { date: '2026-11-07', time: '09:30', end: '09:00' }, ids);
    expect(early.ok && early.mutation.changes[0]).toMatchObject({
      fields: { dueEnd: { v: null } },
    });
  });

  it('is carried by a card made due from the start', () => {
    const made = createDueCard(
      'L1',
      [],
      { title: 'x', due: { date: '2026-11-07', time: '09:30', end: '10:30' } },
      ids,
    );
    expect(made.ok && made.mutation.changes[0]).toMatchObject({
      fields: { dueTime: { v: '09:30' }, dueEnd: { v: '10:30' } },
    });
  });
});

describe('who writes the due fields', () => {
  it('is this action alone: no other file of actions names them', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'due.ts')
      .filter((file) => /dueDate|dueTime/.test(readFileSync(path.join(dir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('making a card that is due from the start', () => {
  it('carries the date and the time in the change that makes the card, at the top of its list', () => {
    const top = card({ title: 'Top' });
    const result = createDueCard(
      'L1',
      [top],
      { title: '  Call the plumber ', due: { date: '2026-11-09', time: '14:00' } },
      ids,
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.mutation.changes).toHaveLength(1);
    expect(result.mutation.changes[0]).toMatchObject({
      table: 'desk_card',
      listId: 'L1',
      fields: {
        title: { v: 'Call the plumber' },
        dueDate: { v: '2026-11-09' },
        dueTime: { v: '14:00' },
      },
    });
  });

  it('is a card with a date and no time when it has none, and no time when it has no date', () => {
    const noTime = createDueCard(
      'L1',
      [],
      { title: 'x', due: { date: '2026-11-09', time: null } },
      ids,
    );
    expect(noTime.ok && noTime.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: '2026-11-09' }, dueTime: { v: null } },
    });
    const noDate = createDueCard('L1', [], { title: 'x', due: { date: null, time: '09:00' } }, ids);
    expect(noDate.ok && noDate.mutation.changes[0]).toMatchObject({
      fields: { dueDate: { v: null }, dueTime: { v: null } },
    });
  });

  it('refuses what a card is refused: an empty title, and a full account', () => {
    expect(createDueCard('L1', [], { title: '  ', due: { date: null, time: null } }, ids)).toEqual({
      ok: false,
      reason: 'title',
    });
    expect(
      createDueCard('L1', [], { title: 'x', due: { date: null, time: null } }, ids, 50_000),
    ).toEqual({ ok: false, reason: 'limit' });
  });
});

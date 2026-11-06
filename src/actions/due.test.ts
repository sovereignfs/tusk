import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { dueOf, setDue } from './due';

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
    });
    expect(dueOf(card({ dueDate: null, dueTime: '09:30' }))).toEqual({
      date: null,
      time: null,
    });
    expect(dueOf(card({ dueDate: { c: 'YWdl' }, dueTime: { c: 'YWdl' } }))).toEqual({
      date: null,
      time: null,
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

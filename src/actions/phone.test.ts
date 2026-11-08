import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { cancelCard, dismissCard, markReviewed, restoreDismissal } from './phone';

const ids = { newId: () => 'm1' };
const row = (
  table: LocalRow['table'],
  id: string,
  fields: Record<string, string | number | boolean | null>,
  extra: Record<string, unknown> = {},
): LocalRow =>
  ({
    table,
    id,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    listId: 'l1',
    position: 'a0',
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
    ...extra,
  }) as unknown as LocalRow;
const card = (fields = {}) => row('desk_card', 'c1', { title: 'Pay rent', ...fields });

describe('what the phone’s swipe views do', () => {
  it('dismisses by setting the day, and nothing else; again on the same day is nothing', () => {
    const result = dismissCard(card({ dueDate: '2026-11-01', starred: true }), '2026-11-08', ids);
    expect(result).toMatchObject({
      ok: true,
      mutation: {
        changes: [{ table: 'desk_card', id: 'c1', fields: { dismissedOn: { v: '2026-11-08' } } }],
      },
    });
    expect(dismissCard(card({ dismissedOn: '2026-11-08' }), '2026-11-08', ids)).toEqual({
      ok: false,
      reason: 'nothing',
    });
    // The next day it can be dismissed again.
    expect(dismissCard(card({ dismissedOn: '2026-11-08' }), '2026-11-09', ids).ok).toBe(true);
  });

  it('undoes a dismissal to the day it had, or to none', () => {
    expect(restoreDismissal(card(), null, ids)).toMatchObject({
      ok: true,
      mutation: { changes: [{ fields: { dismissedOn: { v: null } } }] },
    });
    expect(restoreDismissal(card(), '2026-11-01', ids)).toMatchObject({
      mutation: { changes: [{ fields: { dismissedOn: { v: '2026-11-01' } } }] },
    });
  });

  it('marks reviewed by setting when, and nothing else', () => {
    expect(markReviewed(card(), 1_794_000_000_000, ids)).toMatchObject({
      ok: true,
      mutation: { changes: [{ fields: { reviewedAt: { v: 1_794_000_000_000 } } }] },
    });
    expect(markReviewed(undefined, 1, ids)).toEqual({ ok: false, reason: 'missing' });
  });

  it('cancels a card by deleting it with its checklist, and makes nothing for one that does not repeat', () => {
    const item = row('desk_check', 'i1', { title: 'Call' }, { cardId: 'c1' });
    const result = cancelCard(card(), [item], { series: undefined, today: '2026-11-08' }, ids);
    expect(result).toMatchObject({
      ok: true,
      mutation: {
        changes: [
          { table: 'desk_card', id: 'c1', deleted: true },
          { table: 'desk_check', id: 'i1', deleted: true },
        ],
      },
    });
    expect(result.ok && result.made).toBeUndefined();
  });

  it('cancels a card that repeats by skipping this occurrence: the next is made in the same mutation, and named', () => {
    const series = row('desk_series', 's1', { rule: 'FREQ=DAILY', anchor: '2026-11-05' });
    const repeating = card({ seriesId: 's1', dueDate: '2026-11-05' });
    const result = cancelCard(repeating, [], { series, today: '2026-11-08' }, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const made = result.made;
    expect(made).toBeDefined();
    expect(result.mutation.changes[0]).toMatchObject({
      table: 'desk_card',
      id: 'c1',
      deleted: true,
    });
    const next = result.mutation.changes.find((c) => c.table === 'desk_card' && c.id === made);
    expect(next).toMatchObject({ fields: { dueDate: { v: '2026-11-09' }, seriesId: { v: 's1' } } });
  });

  it('cancels a card that is not there as nothing', () => {
    expect(cancelCard(undefined, [], { series: undefined, today: '2026-11-08' }, ids)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

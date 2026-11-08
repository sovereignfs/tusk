import { describe, expect, it } from 'vitest';
import type { LocalRow } from './local/rows';
import { buildReview } from './review';

/** Review's order (DESIGN.md §25.3), with no clock. */
const card = (
  id: string,
  extra: {
    reviewedAt?: number;
    position?: string;
    listId?: string;
    completedAt?: number;
    deletedAt?: number | null;
  } = {},
): LocalRow => {
  const fields: Record<string, { v: number | string; s: number }> = { title: { v: id, s: 1 } };
  if (extra.reviewedAt !== undefined) fields.reviewedAt = { v: extra.reviewedAt, s: 1 };
  if (extra.completedAt !== undefined) fields.completedAt = { v: extra.completedAt, s: 1 };
  return {
    table: 'desk_card',
    id,
    deletedAt: extra.deletedAt ?? null,
    seq: 1,
    createdAt: 1,
    listId: extra.listId ?? 'l1',
    position: extra.position ?? 'a0',
    fields,
  } as unknown as LocalRow;
};
const ids = (rows: LocalRow[]) => rows.map((row) => row.id);

describe('buildReview', () => {
  it('has never-reviewed first, then the least recently reviewed, then by position', () => {
    const rows = buildReview([
      card('recent', { reviewedAt: 900, position: 'a0' }),
      card('old', { reviewedAt: 100, position: 'a9' }),
      card('new-b', { position: 'a2' }),
      card('new-a', { position: 'a1' }),
    ]);
    expect(ids(rows)).toEqual(['new-a', 'new-b', 'old', 'recent']);
  });

  it('is only the open cards: not done, not deleted', () => {
    expect(
      ids(
        buildReview([
          card('open'),
          card('done', { completedAt: 5 }),
          card('gone', { deletedAt: 9 }),
        ]),
      ),
    ).toEqual(['open']);
  });

  it('can be one list’s', () => {
    expect(
      ids(
        buildReview([card('a', { listId: 'l1' }), card('b', { listId: 'l2' })], { listId: 'l2' }),
      ),
    ).toEqual(['b']);
  });

  it('orders cards that tie by the list’s place, then position, then id', () => {
    const listRank = new Map([
      ['l1', 1],
      ['l2', 0],
    ]);
    const rows = buildReview(
      [
        card('x', { listId: 'l1', position: 'a0' }),
        card('y', { listId: 'l2', position: 'a5' }),
        card('w', { listId: 'l2', position: 'a1' }),
      ],
      { listRank },
    );
    expect(ids(rows)).toEqual(['w', 'y', 'x']);
    // The same cards in any order make the same one.
    expect(
      ids(buildReview([card('b', { position: 'a0' }), card('a', { position: 'a0' })])),
    ).toEqual(['a', 'b']);
  });

  it('goes on from where it stopped: a card that was swiped goes to the end', () => {
    const before = [
      card('one'),
      card('two', { position: 'a1' }),
      card('three', { position: 'a2' }),
    ];
    expect(ids(buildReview(before))).toEqual(['one', 'two', 'three']);
    const after = [card('one', { reviewedAt: 1000 }), before[1] as LocalRow, before[2] as LocalRow];
    expect(ids(buildReview(after))).toEqual(['two', 'three', 'one']);
  });
});

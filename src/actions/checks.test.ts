import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { LIMITS, type Mutation } from '../sync/format';
import { parseMutation } from '../sync/validate';
import {
  addItem,
  deleteItem,
  moveItem,
  renameItem,
  restoreItem,
  tickItem,
  untickItem,
} from './checks';
import type { ActionResult, Ids } from './lists';

function counting(): Ids {
  let n = 0;
  return { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}
const LIST = '10000000-0000-4000-8000-000000000001';
const CARD = '20000000-0000-4000-8000-000000000001';
const S1 = '40000000-0000-4000-8000-000000000001';
const S2 = '40000000-0000-4000-8000-000000000002';
const S3 = '40000000-0000-4000-8000-000000000003';

const card = (extra: Record<string, unknown> = {}): LocalRow =>
  ({
    table: 'desk_card',
    id: CARD,
    listId: LIST,
    position: 'a0',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: 'Plants', s: 1 } },
    ...extra,
  }) as LocalRow;
const item = (
  id: string,
  position: string,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'desk_check',
    id,
    cardId: CARD,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: id, s: 1 }, ...fields },
  }) as LocalRow;

const mutationOf = (result: ActionResult): Mutation => {
  if (!result.ok) throw new Error(`no mutation: ${result.reason}`);
  return result.mutation;
};
const accepted = (result: ActionResult) => expect(parseMutation(mutationOf(result)).ok).toBe(true);

describe('adding an item', () => {
  it('goes at the bottom of the card’s checklist, with its title trimmed, and is a mutation the server takes', () => {
    const items = [item(S1, 'a0'), item(S2, 'a1')];
    const result = addItem(card(), items, { title: ' Book the flights ' }, counting());
    accepted(result);
    const change = mutationOf(result).changes[0] as { position: string };
    expect(change).toMatchObject({
      table: 'desk_check',
      cardId: CARD,
      fields: { title: { v: 'Book the flights' } },
    });
    expect(change.position > 'a1').toBe(true);
    expect(
      (
        mutationOf(addItem(card(), [], { title: 'First' }, counting())).changes[0] as {
          position: string;
        }
      ).position,
    ).toBe('a0');
  });

  it('is refused unless the card is there, and for a bad title or a full account', () => {
    expect(addItem(undefined, [], { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(addItem(card({ deletedAt: 5 }), [], { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(addItem(item(S1, 'a0'), [], { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(addItem(card(), [], { title: '  ' }, counting())).toEqual({
      ok: false,
      reason: 'title',
    });
    expect(addItem(card(), [], { title: 'x' }, counting(), LIMITS.checksPerAccount)).toEqual({
      ok: false,
      reason: 'limit',
    });
  });

  it('each goes below the one made before it, though the screen has not caught up', () => {
    let below: string | undefined;
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const change = mutationOf(addItem(card(), [], { title: `s${i}` }, counting(), 0, below))
        .changes[0] as { position: string };
      made.push(change.position);
      below = change.position;
    }
    expect(made).toEqual([...made].sort());
    expect(new Set(made).size).toBe(5);
  });
});

describe('an item’s title, tick and place', () => {
  it('renames with only a title that differs', () => {
    const one = item(S1, 'a0');
    expect(mutationOf(renameItem(one, ' Oat milk ', counting())).changes).toEqual([
      { table: 'desk_check', id: S1, fields: { title: { v: 'Oat milk' } } },
    ]);
    expect(renameItem(one, S1, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(renameItem(one, '  ', counting())).toEqual({ ok: false, reason: 'title' });
    expect(renameItem(undefined, 'x', counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('ticks at the time given, and ticking one that is done does nothing; unticking one that is not does nothing', () => {
    const open = item(S1, 'a0');
    expect(mutationOf(tickItem(open, 9, counting())).changes).toEqual([
      { table: 'desk_check', id: S1, fields: { completedAt: { v: 9 } } },
    ]);
    accepted(tickItem(open, 9, counting()));
    const done = item(S1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(tickItem(done, 9, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(mutationOf(untickItem(done, counting())).changes).toEqual([
      { table: 'desk_check', id: S1, fields: { completedAt: { v: null } } },
    ]);
    expect(untickItem(open, counting())).toEqual({ ok: false, reason: 'nothing' });
  });

  it('ticking the last item completes nothing else', () => {
    expect(mutationOf(tickItem(item(S2, 'a1'), 9, counting())).changes).toHaveLength(1);
  });

  it('moves with one change to one row, between the two it ends up between', () => {
    const rows = [item(S1, 'a0'), item(S2, 'a1'), item(S3, 'a2')];
    const result = moveItem(rows, S3, 1, counting());
    accepted(result);
    const change = mutationOf(result).changes[0] as { position: string };
    expect(mutationOf(result).changes).toHaveLength(1);
    expect(change.position > 'a0' && change.position < 'a1').toBe(true);
    expect(moveItem(rows, S2, 1, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(moveItem(rows, 'x', 0, counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('deletes with an undo', () => {
    const one = item(S1, 'a0');
    expect(mutationOf(deleteItem(one, counting())).changes).toEqual([
      { table: 'desk_check', id: S1, deleted: true },
    ]);
    expect(mutationOf(restoreItem(one, counting())).changes).toEqual([
      { table: 'desk_check', id: S1, deleted: false },
    ]);
  });
});

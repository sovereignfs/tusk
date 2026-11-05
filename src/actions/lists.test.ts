import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { after, between, first } from '../position';
import { LIMITS, type Mutation } from '../sync/format';
import { parseMutation } from '../sync/validate';
import {
  type ActionResult,
  FIRST_LIST_TITLE,
  type Ids,
  createList,
  deleteList,
  ensureFirstList,
  firstListId,
  moveList,
  renameList,
  restoreList,
  setColor,
} from './lists';

const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(
  (letter) => `00000000-0000-4000-8000-00000000000${letter.charCodeAt(0) - 96}`,
) as [string, string, string, string];

/** Ids that count, so that a test knows which was made when and nothing is random. */
function counting(): Ids & { made: string[] } {
  let n = 0;
  const made: string[] = [];
  return {
    made,
    newId: () => {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      made.push(id);
      return id;
    },
  };
}

const row = (
  id: string,
  position: string,
  fields: Record<string, { v: unknown; s: number }> = {},
  extra = {},
): LocalRow =>
  ({
    table: 'desk_list',
    id,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: id, s: 1 }, ...fields },
    ...extra,
  }) as LocalRow;

const mutationOf = (result: ActionResult): Mutation => {
  if (!result.ok) throw new Error(`no mutation: ${result.reason}`);
  return result.mutation;
};

/** What every action makes must be something the server takes: the same validators, run on what the action produced. */
const accepted = (result: ActionResult) => {
  const parsed = parseMutation(mutationOf(result));
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
};

describe('making a list', () => {
  it('goes at the bottom, black unless told, with its title trimmed, and is a mutation the server takes', () => {
    const ids = counting();
    const lists = [row('a', 'a0'), row('b', 'a1')];
    const result = createList(lists, { title: '  Garden  ' }, ids);
    accepted(result);
    const change = mutationOf(result).changes[0];
    expect(change).toMatchObject({
      table: 'desk_list',
      fields: { title: { v: 'Garden' }, color: { v: 'black' } },
    });
    expect((change as { position: string }).position > 'a1').toBe(true);
    expect(mutationOf(result).mutationId).not.toBe(change?.id);
  });

  it('is the first position in an empty sidebar, and takes a colour', () => {
    const result = createList([], { title: 'Work', color: 'blue' }, counting());
    expect(mutationOf(result).changes[0]).toMatchObject({
      position: first(),
      fields: { color: { v: 'blue' } },
    });
  });

  it('refuses a title that is empty, blank or too long, and makes nothing', () => {
    for (const title of ['', '   ', '\n\t', 'x'.repeat(LIMITS.titleChars + 1)]) {
      expect(createList([], { title }, counting())).toEqual({ ok: false, reason: 'title' });
    }
    expect(createList([], { title: 'x'.repeat(LIMITS.titleChars) }, counting()).ok).toBe(true);
  });

  it('refuses the 201st, counting the lists that are deleted and not yet gone', () => {
    const live = Array.from({ length: 199 }, (_, i) => row(`l${i}`, `a${i}`));
    expect(createList(live, { title: 'The 200th' }, counting()).ok).toBe(true);
    const full = [...live, row('l199', 'a199')];
    expect(createList(full, { title: 'The 201st' }, counting())).toEqual({
      ok: false,
      reason: 'limit',
    });
    const withDeleted = [row('d', 'z', {}, { deletedAt: 5 })];
    expect(
      createList(live.slice(0, 1), { title: 'x' }, counting(), [
        ...full.slice(0, 199),
        ...withDeleted,
        row('e', 'zz'),
      ]),
    ).toEqual({
      ok: false,
      reason: 'limit',
    });
  });
});

describe('renaming and recolouring', () => {
  it('change that field of that list and nothing else', () => {
    const list = row(A, 'a0', { color: { v: 'black', s: 1 } });
    const renamed = renameList(list, ' Errands ', counting());
    accepted(renamed);
    expect(mutationOf(renamed).changes).toEqual([
      { table: 'desk_list', id: A, fields: { title: { v: 'Errands' } } },
    ]);
    const coloured = setColor(list, 'red', counting());
    accepted(coloured);
    expect(mutationOf(coloured).changes).toEqual([
      { table: 'desk_list', id: A, fields: { color: { v: 'red' } } },
    ]);
  });

  it('do nothing when nothing changes, and refuse a bad title or colour, and a list that is not there', () => {
    const list = row(A, 'a0', { color: { v: 'green', s: 1 }, title: { v: 'Home', s: 1 } });
    expect(renameList(list, 'Home', counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(renameList(list, '  ', counting())).toEqual({ ok: false, reason: 'title' });
    expect(setColor(list, 'green', counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(setColor(list, 'purple', counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(renameList(undefined, 'x', counting())).toEqual({ ok: false, reason: 'missing' });
    expect(setColor(undefined, 'red', counting())).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('moving a list', () => {
  const lists = [A, B, C, D].map((id, i) => row(id, `a${i}`));
  const positionOf = (result: ActionResult) =>
    (mutationOf(result).changes[0] as { position: string }).position;

  it('writes one change to one row, between the two it ends up between', () => {
    const result = moveList(lists, D, 1, counting());
    accepted(result);
    expect(mutationOf(result).changes).toHaveLength(1);
    expect(mutationOf(result).changes[0]).toMatchObject({ table: 'desk_list', id: D });
    expect(positionOf(result) > 'a0' && positionOf(result) < 'a1').toBe(true);
  });

  it('is to the top, to the bottom, and into the middle, as rendered after the move', () => {
    expect(positionOf(moveList(lists, C, 0, counting())) < 'a0').toBe(true);
    expect(positionOf(moveList(lists, A, 3, counting())) > 'a3').toBe(true);
    const down = positionOf(moveList(lists, A, 2, counting()));
    // a goes after b and c are in front of it: between 'a2' (c) and 'a3' (d).
    expect(down > 'a2' && down < 'a3').toBe(true);
    const up = positionOf(moveList(lists, D, 2, counting()));
    expect(up > 'a1' && up < 'a2').toBe(true);
  });

  it('applied, gives the order that was asked for, for every list to every place', () => {
    for (const mover of lists) {
      for (let to = 0; to < lists.length; to++) {
        const result = moveList(lists, mover.id, to, counting());
        if (!result.ok) {
          expect(result.reason).toBe('nothing');
          expect(lists.findIndex((l) => l.id === mover.id)).toBe(to);
          continue;
        }
        const moved = lists.map((l) =>
          l.id === mover.id ? { ...l, position: positionOf(result) } : l,
        ) as (LocalRow & { position: string })[];
        moved.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
        const expected = lists.filter((l) => l.id !== mover.id).map((l) => l.id);
        expected.splice(to, 0, mover.id);
        expect(
          moved.map((l) => l.id),
          `${mover.id} to ${to}`,
        ).toEqual(expected);
      }
    }
  });

  it('does nothing for a list that is already there, and clamps an index that is off the end', () => {
    expect(moveList(lists, B, 1, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(moveList(lists, A, 99, counting()).ok).toBe(true);
    expect(moveList(lists, D, 99, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(moveList(lists, A, -4, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(moveList(lists, 'nope', 0, counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('does not throw when two devices have put lists at the same position', () => {
    const tied = [row(A, 'a0'), row(B, 'a0'), row(C, 'a0')];
    expect(() => moveList(tied, C, 1, counting())).not.toThrow();
    expect(moveList(tied, A, 2, counting()).ok).toBe(true);
    expect(between('a0', 'a0')).toBe('a0');
    expect(after('a0') > 'a0').toBe(true);
  });
});

describe('deleting and undoing', () => {
  it('marks only the list, and the undo clears it', () => {
    const list = row(A, 'a0');
    expect(mutationOf(deleteList(list, counting())).changes).toEqual([
      { table: 'desk_list', id: A, deleted: true },
    ]);
    expect(mutationOf(restoreList(list, counting())).changes).toEqual([
      { table: 'desk_list', id: A, deleted: false },
    ]);
    accepted(deleteList(list, counting()));
    expect(deleteList(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
    expect(restoreList(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('the first list', () => {
  it('is made for an account that has synced and has no lists at all, with an id that is the account’s', () => {
    const result = ensureFirstList('user-1', [], true, counting());
    accepted(result);
    expect(mutationOf(result).changes[0]).toMatchObject({
      table: 'desk_list',
      id: firstListId('user-1'),
      position: first(),
      fields: { title: { v: FIRST_LIST_TITLE } },
    });
  });

  it('is the same id on every device and for no other account', () => {
    expect(firstListId('user-1')).toBe(firstListId('user-1'));
    expect(firstListId('user-1')).not.toBe(firstListId('user-2'));
    const [a, b] = [
      ensureFirstList('user-1', [], true, counting()),
      ensureFirstList('user-1', [], true, counting()),
    ];
    expect(mutationOf(a).changes[0]?.id).toBe(mutationOf(b).changes[0]?.id);
  });

  it('is not made before the device has heard from the server, or when there is any list, deleted or not', () => {
    expect(ensureFirstList('user-1', [], false, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(ensureFirstList('user-1', [row('a', 'a0')], true, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(
      ensureFirstList('user-1', [row('a', 'a0', {}, { deletedAt: 3 })], true, counting()),
    ).toEqual({ ok: false, reason: 'nothing' });
  });
});

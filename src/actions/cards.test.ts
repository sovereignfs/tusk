import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import type { LocalRow } from '../local/rows';
import { LIMITS, type Mutation } from '../sync/format';
import { applyMutation } from '../sync/apply';
import { account, makeStore, rowOf, snapshot } from '../sync/test-support';
import { parseMutation } from '../sync/validate';
import type { ActionResult, Ids } from './lists';
import {
  completeCard,
  createCard,
  deleteCard,
  isCompleted,
  isStarred,
  moveCard,
  moveToList,
  reopenCard,
  restoreCard,
  setStarred,
  setStatus,
  startCard,
  statusOf,
  updateCard,
} from './cards';

const { leg } = testTarget();

function counting(): Ids {
  let n = 0;
  return { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
}
const LIST = '10000000-0000-4000-8000-000000000001';
const T1 = '20000000-0000-4000-8000-000000000001';

const card = (
  id: string,
  position: string,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId: LIST,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: 'Buy milk', s: 1 }, ...fields },
  }) as LocalRow;

const mutationOf = (result: ActionResult): Mutation => {
  if (!result.ok) throw new Error(`no mutation: ${result.reason}`);
  return result.mutation;
};
const accepted = (result: ActionResult) => expect(parseMutation(mutationOf(result)).ok).toBe(true);

describe('making a card', () => {
  it('goes at the top of the list, with its title trimmed, and is a mutation the server takes', () => {
    const cards = [card(T1, 'a0'), card('20000000-0000-4000-8000-000000000002', 'a1')];
    const result = createCard(LIST, cards, { title: '  Water the plants ' }, counting());
    accepted(result);
    const change = mutationOf(result).changes[0] as {
      position: string;
      listId: string;
      fields: unknown;
    };
    expect(change).toMatchObject({
      table: 'desk_card',
      listId: LIST,
      fields: { title: { v: 'Water the plants' } },
    });
    expect(change.position < 'a0').toBe(true);
  });

  it('is the first position in an empty list, and each new one sorts above the last, however many', () => {
    const empty = mutationOf(createCard(LIST, [], { title: 'First' }, counting())).changes[0] as {
      position: string;
    };
    let top = empty.position;
    for (let i = 0; i < 200; i++) {
      const next = mutationOf(createCard(LIST, [card(T1, top)], { title: `n${i}` }, counting()))
        .changes[0] as { position: string };
      expect(next.position < top).toBe(true);
      top = next.position;
    }
    expect(top.length).toBeLessThan(8);
  });

  it('refuses an empty or too long title, and a full account', () => {
    for (const title of ['', '   ', '\n', 'x'.repeat(LIMITS.titleChars + 1)]) {
      expect(createCard(LIST, [], { title }, counting())).toEqual({ ok: false, reason: 'title' });
    }
    expect(createCard(LIST, [], { title: 'x' }, counting(), LIMITS.cardsPerAccount)).toEqual({
      ok: false,
      reason: 'limit',
    });
    expect(createCard(LIST, [], { title: 'x' }, counting(), LIMITS.cardsPerAccount - 1).ok).toBe(
      true,
    );
  });
});

describe('making cards in quick succession', () => {
  it('puts each above the last, though the screen has not caught up with the one before', () => {
    // The screen still shows only the first task when the second and third are made.
    const shown = [card(T1, 'a5')];
    let above: string | undefined;
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const change = mutationOf(
        createCard(LIST, shown, { title: `n${i}` }, counting(), shown.length, above),
      ).changes[0] as { position: string };
      made.push(change.position);
      above = change.position;
    }
    expect(made).toEqual([...made].sort().reverse());
    expect(new Set(made).size).toBe(5);
    expect((made[0] as string) < 'a5').toBe(true);
  });

  it('is the screen’s top when that is the higher, and the last one made when the screen is empty', () => {
    expect(
      (
        mutationOf(createCard(LIST, [card(T1, 'a0')], { title: 'x' }, counting(), 1, 'a5'))
          .changes[0] as { position: string }
      ).position < 'a0',
    ).toBe(true);
    expect(
      (
        mutationOf(createCard(LIST, [], { title: 'x' }, counting(), 0, 'a3')).changes[0] as {
          position: string;
        }
      ).position < 'a3',
    ).toBe(true);
  });
});

describe('editing a card', () => {
  const t = card(T1, 'a0', { description: { v: 'two pints', s: 1 } });

  it('sends only the field that differs', () => {
    expect(
      mutationOf(updateCard(t, { title: 'Buy oat milk', description: 'two pints' }, counting()))
        .changes,
    ).toEqual([{ table: 'desk_card', id: T1, fields: { title: { v: 'Buy oat milk' } } }]);
    expect(mutationOf(updateCard(t, { description: 'three pints\n' }, counting())).changes).toEqual(
      [{ table: 'desk_card', id: T1, fields: { description: { v: 'three pints\n' } } }],
    );
    accepted(updateCard(t, { title: 'x', description: 'y' }, counting()));
  });

  it('does nothing when nothing differs, and refuses a bad title or description that are too long', () => {
    expect(updateCard(t, { title: ' Buy milk ', description: 'two pints' }, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(updateCard(t, {}, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(updateCard(t, { title: '  ' }, counting())).toEqual({ ok: false, reason: 'title' });
    expect(
      updateCard(t, { description: 'n'.repeat(LIMITS.descriptionChars + 1) }, counting()),
    ).toEqual({
      ok: false,
      reason: 'title',
    });
    expect(updateCard(card(T1, 'a0'), { description: '' }, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(updateCard(undefined, { title: 'x' }, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('ticking off', () => {
  it('stamps the time given, and ticking one that is done already does nothing, so a double tap is one thing', () => {
    const open = card(T1, 'a0');
    const first = completeCard(open, 1_800_000_000_000, counting());
    accepted(first);
    expect(mutationOf(first).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { completedAt: { v: 1_800_000_000_000 } } },
    ]);
    const done = card(T1, 'a0', { completedAt: { v: 1_800_000_000_000, s: 2 } });
    expect(completeCard(done, 1_800_000_999_999, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(isCompleted(done)).toBe(true);
    expect(isCompleted(open)).toBe(false);
    expect(isCompleted(card(T1, 'a0', { completedAt: { v: null, s: 2 } }))).toBe(false);
  });

  it('reopens one that is done, and leaves one that is not', () => {
    const done = card(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenCard(done, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { completedAt: { v: null } } },
    ]);
    accepted(reopenCard(done, counting()));
    expect(reopenCard(card(T1, 'a0'), counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(completeCard(undefined, 1, counting())).toEqual({ ok: false, reason: 'missing' });
    expect(reopenCard(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
  });
});

const item = (
  id: string,
  position: string,
  cardId: string,
  fields: Record<string, { v: unknown; s: number }> = {},
): LocalRow =>
  ({
    table: 'desk_check',
    id,
    cardId,
    position,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: id, s: 1 }, ...fields },
  }) as LocalRow;
const S1 = '40000000-0000-4000-8000-000000000001';
const S2 = '40000000-0000-4000-8000-000000000002';
const S3 = '40000000-0000-4000-8000-000000000003';

describe('a card’s checklist', () => {
  it('completing the card completes its open items in the same mutation, and leaves the time of those already done alone', () => {
    const items = [
      item(S1, 'a0', T1),
      item(S2, 'a1', T1, { completedAt: { v: 1_700_000_000_000, s: 2 } }),
      item(S3, 'a2', T1),
    ];
    const result = completeCard(card(T1, 'a0'), 1_800_000_000_000, counting(), items);
    accepted(result);
    const changes = mutationOf(result).changes;
    expect(changes.map((c) => c.id)).toEqual([T1, S1, S3]);
    expect(changes.map((c) => c.table)).toEqual(['desk_card', 'desk_check', 'desk_check']);
    for (const change of changes)
      expect(change.fields).toEqual({ completedAt: { v: 1_800_000_000_000 } });
    // The one that was done is not in it: its completion time is not touched.
    expect(changes.some((c) => c.id === S2)).toBe(false);
  });

  it('reopening a card reopens nothing else', () => {
    const done = card(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenCard(done, counting())).changes).toHaveLength(1);
  });

  it('is still one thing when the card is ticked twice', () => {
    const done = card(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(completeCard(done, 9, counting(), [item(S1, 'a0', T1)])).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('is not a card’s to tick when it is an item or a list', () => {
    expect(completeCard(item(S1, 'a0', T1), 9, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('moving a card', () => {
  const ids3 = [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000004',
  ];
  const rows = ids3.map((id, i) => card(id, `a${i}`));
  const positionOf = (result: ActionResult) =>
    (mutationOf(result).changes[0] as { position: string }).position;

  it('writes one change to one row, between the two it ends up between, and the server takes it', () => {
    const result = moveCard(rows, ids3[3] as string, 1, counting());
    accepted(result);
    expect(mutationOf(result).changes).toHaveLength(1);
    expect(mutationOf(result).changes[0]).toMatchObject({ table: 'desk_card', id: ids3[3] });
    expect(positionOf(result) > 'a0' && positionOf(result) < 'a1').toBe(true);
  });

  it('is against what is on the screen: under a filter it lands between the rows it was dropped between, whatever else there is', () => {
    // The list has six cards; the screen shows three of them, with others between that are not shown.
    const all = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map((position, i) =>
      card(`60000000-0000-4000-8000-00000000000${i}`, position),
    );
    const shown = [all[0], all[2], all[5]] as LocalRow[];
    const result = moveCard(shown, (all[5] as LocalRow).id, 1, counting());
    // Dropped between the first and the second shown: between 'a0' and 'a2', which is not between its old neighbours' neighbours.
    expect(positionOf(result) > 'a0' && positionOf(result) < 'a2').toBe(true);
    // And only that row is written: the three that are not shown are not in it.
    expect(mutationOf(result).changes).toHaveLength(1);
  });

  it('gives the order that was asked for, for every card to every place', () => {
    for (const mover of rows) {
      for (let to = 0; to < rows.length; to++) {
        const result = moveCard(rows, mover.id, to, counting());
        if (!result.ok) {
          expect(rows.findIndex((r) => r.id === mover.id)).toBe(to);
          continue;
        }
        const moved = rows.map((r) =>
          r.id === mover.id ? { ...r, position: positionOf(result) } : r,
        ) as (LocalRow & { position: string })[];
        moved.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
        const expected = rows.filter((r) => r.id !== mover.id).map((r) => r.id);
        expected.splice(to, 0, mover.id);
        expect(
          moved.map((r) => r.id),
          `${mover.id} to ${to}`,
        ).toEqual(expected);
      }
    }
  });

  it('does nothing for a card already there, and says so for one that is not on the screen, and does not throw for a tie', () => {
    expect(moveCard(rows, ids3[1] as string, 1, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(moveCard(rows, 'not-shown', 0, counting())).toEqual({ ok: false, reason: 'missing' });
    const tied = ids3.slice(0, 3).map((id) => card(id, 'a0'));
    expect(() => moveCard(tied, ids3[2] as string, 1, counting())).not.toThrow();
  });
});

describe('deleting', () => {
  it('marks the card, and the undo clears it', () => {
    const t = card(T1, 'a0');
    expect(mutationOf(deleteCard(t, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, deleted: true },
    ]);
    expect(mutationOf(restoreCard(t, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, deleted: false },
    ]);
    accepted(deleteCard(t, counting()));
    expect(deleteCard(undefined, counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('takes a card’s live items with it, in the one mutation, and not one that is deleted already', () => {
    const gone = { ...item(S2, 'a1', T1), deletedAt: 1_000 } as LocalRow;
    const result = deleteCard(card(T1, 'a0'), counting(), [
      item(S1, 'a0', T1),
      gone,
      item(S3, 'a2', T1),
    ]);
    accepted(result);
    expect(mutationOf(result).changes).toEqual([
      { table: 'desk_card', id: T1, deleted: true },
      { table: 'desk_check', id: S1, deleted: true },
      { table: 'desk_check', id: S3, deleted: true },
    ]);
  });

  it('is undone exactly: the items that went with the card come back, and one that was deleted before stays deleted', () => {
    const parent = { ...card(T1, 'a0'), deletedAt: 5_000 } as LocalRow;
    const withIt = { ...item(S1, 'a0', T1), deletedAt: 5_000 } as LocalRow;
    const before = { ...item(S2, 'a1', T1), deletedAt: 1_000 } as LocalRow;
    const alsoWithIt = { ...item(S3, 'a2', T1), deletedAt: 5_000 } as LocalRow;
    const result = restoreCard(parent, counting(), [withIt, before, alsoWithIt]);
    accepted(result);
    expect(mutationOf(result).changes).toEqual([
      { table: 'desk_card', id: T1, deleted: false },
      { table: 'desk_check', id: S1, deleted: false },
      { table: 'desk_check', id: S3, deleted: false },
    ]);
  });

  it('restoring a card that is not deleted brings back nothing else', () => {
    expect(
      mutationOf(restoreCard(card(T1, 'a0'), counting(), [item(S1, 'a0', T1)])).changes,
    ).toHaveLength(1);
  });
});

describe(`the plugin's flaw is gone (${leg}): another account's card cannot be changed by any of these, by any route`, () => {
  let database: Database;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ database, close } = await makeStore());
  });
  afterAll(async () => close());

  it('moves nothing into another account’s list: the move is refused and everything stays where it was', async () => {
    const [ada, grace] = [account(), account()];
    const ids = counting();
    let clock = 1_800_000_000_000;
    const apply = (owner: string, m: Mutation) =>
      applyMutation(database, owner, m, { now: (clock += 1000) });
    const aList = '31000000-0000-4000-8000-000000000001';
    const gList = '31000000-0000-4000-8000-000000000002';
    const cardId = '31000000-0000-4000-8000-000000000003';
    const itemId = '31000000-0000-4000-8000-000000000004';
    await apply(ada, {
      mutationId: ids.newId(),
      changes: [
        { table: 'desk_list', id: aList, position: 'a0', fields: { title: { v: 'Ada' } } },
        {
          table: 'desk_card',
          id: cardId,
          listId: aList,
          position: 'a0',
          fields: { title: { v: 'Mine' } },
        },
        {
          table: 'desk_check',
          id: itemId,
          cardId,
          position: 'a0',
          fields: { title: { v: 'Part' } },
        },
      ],
    });
    await apply(grace, {
      mutationId: ids.newId(),
      changes: [
        { table: 'desk_list', id: gList, position: 'a0', fields: { title: { v: 'Grace' } } },
      ],
    });
    const before = await snapshot(database, ada);

    const result = moveToList({ ...card(cardId, 'a0'), listId: aList } as LocalRow, gList, [], ids);
    expect(await apply(ada, mutationOf(result))).toEqual({
      status: 'refused',
      code: 'unavailable',
    });
    expect(await snapshot(database, ada)).toEqual(before);
  });

  it('is refused, and changes nothing, for each thing a person does to a card', async () => {
    const [ada, grace] = [account(), account()];
    const ids = counting();
    let clock = 1_800_000_000_000;
    const apply = (owner: string, m: Mutation) =>
      applyMutation(database, owner, m, { now: (clock += 1000) });

    const listId = '30000000-0000-4000-8000-000000000001';
    const cardId = '30000000-0000-4000-8000-000000000002';
    await apply(ada, {
      mutationId: ids.newId(),
      changes: [
        { table: 'desk_list', id: listId, position: 'a0', fields: { title: { v: 'Ada' } } },
        {
          table: 'desk_card',
          id: cardId,
          listId,
          position: 'a0',
          fields: { title: { v: 'Ada’s' } },
        },
      ],
    });
    const graceList = '30000000-0000-4000-8000-000000000003';
    await apply(grace, {
      mutationId: ids.newId(),
      changes: [
        { table: 'desk_list', id: graceList, position: 'a0', fields: { title: { v: 'Grace' } } },
      ],
    });
    const before = await snapshot(database, ada);

    // What Grace's screen would produce if it somehow held Ada's card, which it cannot: the actions take no account and so cannot name one, and the
    // server decides whose a row is, by the session.
    const hers = { ...card(cardId, 'a0'), listId } as LocalRow;
    const attempts = [
      updateCard(hers, { title: 'mine now', description: 'mine' }, ids),
      completeCard(hers, clock, ids),
      deleteCard(hers, ids),
      restoreCard(hers, ids),
      createCard(listId, [], { title: 'into Ada’s list' }, ids),
      createCard(graceList, [], { title: 'x' }, ids),
    ];
    const results = [];
    for (const attempt of attempts.slice(0, 5))
      results.push(await apply(grace, mutationOf(attempt)));
    expect(results.every((r) => r.status === 'refused')).toBe(true);
    expect(await snapshot(database, ada)).toEqual(before);
    expect((await rowOf(database, 'desk_card', cardId))?.deleted_at).toBeNull();
    // Her own list is hers: the last attempt is an ordinary one, and is let through.
    expect((await apply(grace, mutationOf(attempts[5] as ActionResult))).status).toBe('applied');
  });
});

describe('moving a card to another list', () => {
  const OTHER = '80000000-0000-4000-8000-000000000001';
  const parent = card(T1, 'a5');

  it('is one change: the card at the top of the destination, and the server takes it', () => {
    const destination = [
      { ...card('90000000-0000-4000-8000-000000000001', 'a3'), listId: OTHER } as LocalRow,
    ];
    const result = moveToList(parent, OTHER, destination, counting());
    accepted(result);
    const changes = mutationOf(result).changes as unknown as {
      id: string;
      listId: string;
      position?: string;
    }[];
    expect(changes.map((c) => c.id)).toEqual([T1]);
    expect(changes[0]?.listId).toBe(OTHER);
    expect((changes[0]?.position ?? '') < 'a3').toBe(true);
  });

  it('leaves the checklist alone, since an item is where its card is', () => {
    const changes = mutationOf(moveToList(parent, OTHER, [], counting())).changes;
    expect(changes.every((c) => c.table === 'desk_card')).toBe(true);
  });

  it('is first in an empty destination, and does nothing for the list it is in, or for what is not a card', () => {
    expect(
      (mutationOf(moveToList(parent, OTHER, [], counting())).changes[0] as { position: string })
        .position,
    ).toBe('a0');
    expect(moveToList(parent, LIST, [], counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(moveToList(item(S1, 'a0', T1), OTHER, [], counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(moveToList(undefined, OTHER, [], counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('starring a card', () => {
  it('stars it, takes the star off, and does nothing when nothing changes', () => {
    const plain = card(T1, 'a0');
    expect(mutationOf(setStarred(plain, true, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { starred: { v: true } } },
    ]);
    accepted(setStarred(plain, true, counting()));
    const starred = card(T1, 'a0', { starred: { v: true, s: 2 } });
    expect(isStarred(starred)).toBe(true);
    expect(mutationOf(setStarred(starred, false, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { starred: { v: false } } },
    ]);
    expect(setStarred(starred, true, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(setStarred(plain, false, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(setStarred(undefined, true, counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('has no meaning for an item: here, and at the server, which knows no such field', () => {
    expect(setStarred(item(S1, 'a0', T1), true, counting())).toEqual({
      ok: false,
      reason: 'missing',
    });
    const forced = {
      mutationId: '00000000-0000-4000-8000-000000000009',
      changes: [
        {
          table: 'desk_check' as const,
          id: S1,
          cardId: T1,
          position: 'a0',
          fields: { title: { v: 'x' }, starred: { v: true } },
        },
      ],
    };
    expect(parseMutation(forced).ok).toBe(false);
  });
});

describe('the status of a card', () => {
  const started = (extra: Record<string, { v: unknown; s: number }> = {}) =>
    card(T1, 'a0', { startedAt: { v: 1_000, s: 2 }, ...extra });

  it('is Done if there is a completion time, In progress if there is only a start time, and Open otherwise', () => {
    expect(statusOf(card(T1, 'a0'))).toBe('open');
    expect(statusOf(started())).toBe('in_progress');
    expect(statusOf(card(T1, 'a0', { completedAt: { v: 5, s: 2 } }))).toBe('done');
    // Done wins over a start time, whichever was written later.
    expect(statusOf(started({ completedAt: { v: 5, s: 1 } }))).toBe('done');
    // A time that was cleared is not a time, and one that is ciphertext cannot be read.
    expect(statusOf(card(T1, 'a0', { startedAt: { v: null, s: 2 } }))).toBe('open');
    expect(
      statusOf({ ...card(T1, 'a0'), fields: { startedAt: { c: 'YWdl', s: 1 } } } as LocalRow),
    ).toBe('open');
  });

  it('is started with only the start time on an open card, so that a completion made meanwhile elsewhere still stands', () => {
    const result = startCard(card(T1, 'a0'), 7_000, counting());
    accepted(result);
    expect(mutationOf(result).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { startedAt: { v: 7_000 } } },
    ]);
  });

  it('is started from done as a reopening: the completion time goes too', () => {
    const done = card(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(startCard(done, 7_000, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { startedAt: { v: 7_000 }, completedAt: { v: null } } },
    ]);
    expect(startCard(started(), 8_000, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(startCard(undefined, 1, counting())).toEqual({ ok: false, reason: 'missing' });
  });

  it('clears both times on a reopening, but only sends the start time when there is one', () => {
    const both = started({ completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenCard(both, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { completedAt: { v: null }, startedAt: { v: null } } },
    ]);
    const onlyDone = card(T1, 'a0', { completedAt: { v: 5, s: 2 } });
    expect(mutationOf(reopenCard(onlyDone, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { completedAt: { v: null } } },
    ]);
  });

  it('is set from the detail to any of the three, each as the right change, and the one it has is nothing', () => {
    const open = card(T1, 'a0');
    const items = [
      {
        table: 'desk_check',
        id: S1,
        cardId: T1,
        position: 'a0',
        deletedAt: null,
        seq: 1,
        createdAt: 1,
        fields: { title: { v: 'x', s: 1 } },
      } as LocalRow,
    ];
    const done = mutationOf(setStatus(open, 'done', 9, counting(), items)).changes;
    expect(done.map((c) => c.id)).toEqual([T1, S1]);
    expect(mutationOf(setStatus(open, 'in_progress', 9, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { startedAt: { v: 9 } } },
    ]);
    expect(mutationOf(setStatus(started(), 'open', 9, counting())).changes).toEqual([
      { table: 'desk_card', id: T1, fields: { startedAt: { v: null } } },
    ]);
    expect(
      mutationOf(setStatus(card(T1, 'a0', { completedAt: { v: 5, s: 2 } }), 'open', 9, counting()))
        .changes,
    ).toEqual([{ table: 'desk_card', id: T1, fields: { completedAt: { v: null } } }]);
    expect(setStatus(open, 'open', 9, counting())).toEqual({ ok: false, reason: 'nothing' });
    expect(setStatus(started(), 'in_progress', 9, counting())).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(setStatus(undefined, 'done', 9, counting())).toEqual({ ok: false, reason: 'missing' });
    for (const status of ['done', 'in_progress', 'open'] as const)
      accepted(setStatus(status === 'open' ? started() : open, status, 9, counting()));
  });
});

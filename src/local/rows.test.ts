import { describe, expect, it } from 'vitest';
import type { Change, PulledRow } from '../sync/format';
import { type LocalRow, applyChange, byPosition, mergePulled } from './rows';

const ID = () => crypto.randomUUID();

const card = (extra: Partial<Extract<PulledRow, { table: 'desk_card' }>> = {}): LocalRow => ({
  table: 'desk_card',
  id: ID(),
  listId: ID(),
  position: 'a0',
  deletedAt: null,
  seq: 4,
  createdAt: 1000,
  fields: { title: { v: 'Buy milk', s: 4 }, description: { v: 'two', s: 2 } },
  ...extra,
});

describe('a change laid over a row', () => {
  it('makes a row that is not there, with what the change says and the server’s order not yet known', () => {
    const change: Change = {
      table: 'desk_card',
      id: ID(),
      listId: ID(),
      position: 'a1',
      fields: { title: { v: 'New' } },
    };
    expect(applyChange(undefined, change, 5000)).toEqual({
      table: 'desk_card',
      id: change.id,
      listId: change.listId,
      position: 'a1',
      deletedAt: null,
      seq: 0,
      createdAt: 5000,
      fields: { title: { v: 'New', s: 0 } },
    });
  });

  it('changes a field at a time, keeping the seq that last wrote each, and leaves the row it was given alone', () => {
    const before = card();
    const after = applyChange(
      before,
      { table: 'desk_card', id: before.id, fields: { title: { v: 'Buy oat milk' } } },
      6000,
    );
    expect(after.fields).toEqual({
      title: { v: 'Buy oat milk', s: 4 },
      description: { v: 'two', s: 2 },
    });
    expect(before.fields.title).toEqual({ v: 'Buy milk', s: 4 });
  });

  it('moves a row by the structure it names, and only that', () => {
    const before = card();
    const to = ID();
    const after = applyChange(
      before,
      { table: 'desk_card', id: before.id, listId: to, position: 'b' },
      1,
    );
    expect(after).toMatchObject({ listId: to, position: 'b' });
    // A checklist item's card is structure too, and moves like the rest.
    const item = applyChange(
      undefined,
      { table: 'desk_check', id: ID(), cardId: to, position: 'a0', fields: { title: { v: 'x' } } },
      1,
    );
    expect(item).toMatchObject({ table: 'desk_check', cardId: to });
  });

  it('deletes with the device’s clock until the server’s time arrives, keeps the first time, and an edit restores', () => {
    const live = card();
    const deleted = applyChange(live, { table: 'desk_card', id: live.id, deleted: true }, 7000);
    expect(deleted.deletedAt).toBe(7000);
    expect(
      applyChange(deleted, { table: 'desk_card', id: live.id, deleted: true }, 9000).deletedAt,
    ).toBe(7000);
    expect(
      applyChange(
        deleted,
        { table: 'desk_card', id: live.id, fields: { description: { v: 'x' } } },
        9000,
      ).deletedAt,
    ).toBeNull();
    expect(
      applyChange(deleted, { table: 'desk_card', id: live.id, deleted: false }, 9000).deletedAt,
    ).toBeNull();
  });
});

describe('a row the server sent, laid over a row the device has', () => {
  it('is the row, if the device has none', () => {
    const row = card();
    expect(mergePulled(undefined, row as PulledRow)).toBe(row);
  });

  it('wins per field by the higher seq: a field with newer news is replaced and one without is kept', () => {
    const have = card({
      fields: {
        title: { v: 'mine', s: 4 },
        description: { v: 'mine too', s: 9 },
        starred: { v: true, s: 1 },
      },
    });
    const sent = {
      ...have,
      seq: 10,
      fields: { title: { v: 'theirs', s: 10 }, description: { v: 'theirs too', s: 3 } },
    } as PulledRow;
    expect(mergePulled(have, sent).fields).toEqual({
      title: { v: 'theirs', s: 10 },
      description: { v: 'mine too', s: 9 },
      starred: { v: true, s: 1 },
    });
  });

  it('takes the structure and the deletion of whichever row was written last, and not an older one', () => {
    const have = card({ seq: 8, position: 'new' });
    const older = { ...have, seq: 5, position: 'old', deletedAt: 1 } as PulledRow;
    expect(mergePulled(have, older)).toMatchObject({ position: 'new', deletedAt: null, seq: 8 });
    const newer = { ...have, seq: 9, position: 'newest', deletedAt: 5 } as PulledRow;
    expect(mergePulled(have, newer)).toMatchObject({ position: 'newest', deletedAt: 5, seq: 9 });
  });

  it('is the same however often it is applied', () => {
    const have = card();
    const sent = {
      ...have,
      seq: 10,
      position: 'z',
      fields: { title: { v: 'x', s: 10 } },
    } as PulledRow;
    const once = mergePulled(have, sent);
    expect(mergePulled(once, sent)).toEqual(once);
  });
});

describe('order in a list', () => {
  it('is by position as bytes, and equal positions by id, never by locale', () => {
    const rows = [
      { position: 'a', id: 'b' },
      { position: 'B', id: 'a' },
      { position: 'a', id: 'a' },
      { position: 'a1', id: 'c' },
      { position: 'Zz', id: 'd' },
    ];
    // Upper case sorts before lower case by bytes, and "a" before "a1" before "b".
    expect([...rows].sort(byPosition).map((r) => `${r.position}/${r.id}`)).toEqual([
      'B/a',
      'Zz/d',
      'a/a',
      'a/b',
      'a1/c',
    ]);
    expect(
      byPosition(
        rows[0] as { position: string; id: string },
        rows[0] as { position: string; id: string },
      ),
    ).toBe(0);
  });
});

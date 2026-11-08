import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { buildDesk, envelope, fileNameOf, serialise } from './format';

/** The export file's pure part (DESIGN.md §20.1): the Desk, from its rows. Deterministic, without what was deleted, and with nothing it cannot read. */
const row = (
  table: string,
  id: string,
  extra: object,
  fields: Record<string, unknown> = {},
): LocalRow =>
  ({
    table,
    id,
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    ...extra,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
  }) as LocalRow;

const rows = () => ({
  lists: [
    row('desk_list', 'l2', { position: 'a1' }, { title: 'Second', color: '#2563eb', sort: 'due' }),
    row('desk_list', 'l1', { position: 'a0' }, { title: 'First' }),
    {
      ...row('desk_list', 'gone', { position: 'a2' }, { title: 'Deleted list' }),
      deletedAt: 9,
    } as LocalRow,
  ],
  cards: [
    row('desk_card', 'c2', { listId: 'l1', position: 'a1' }, { title: 'two', starred: true }),
    row(
      'desk_card',
      'c1',
      { listId: 'l1', position: 'a0' },
      {
        title: 'one',
        description: 'Notes\nmore',
        dueDate: '2026-11-06',
        dueTime: '09:00',
        dueEnd: '10:30',
        seriesId: 's1',
        completedAt: 5,
        startedAt: 3,
      },
    ),
    {
      ...row('desk_card', 'c3', { listId: 'l1', position: 'a2' }, { title: 'deleted' }),
      deletedAt: 4,
    } as LocalRow,
    row('desk_card', 'c4', { listId: 'gone', position: 'a0' }, { title: 'in a deleted list' }),
    row(
      'desk_card',
      'c5',
      { listId: 'l2', position: 'a0' },
      { title: 'pointer', seriesId: 'nope' },
    ),
  ],
  checks: [
    row('desk_check', 'i2', { cardId: 'c1', position: 'a1' }, { title: 'later', completedAt: 7 }),
    row('desk_check', 'i1', { cardId: 'c1', position: 'a0' }, { title: 'first' }),
    {
      ...row('desk_check', 'i3', { cardId: 'c1', position: 'a2' }, { title: 'gone' }),
      deletedAt: 2,
    } as LocalRow,
    row('desk_check', 'i4', { cardId: 'c3', position: 'a0' }, { title: 'of a deleted card' }),
  ],
  series: [
    row('desk_series', 's1', { listId: 'l1' }, { rule: 'FREQ=DAILY', anchor: '2026-11-01' }),
    {
      ...row('desk_series', 's2', { listId: 'l1' }, { rule: 'FREQ=WEEKLY', anchor: '2026-11-02' }),
      deletedAt: 1,
    } as LocalRow,
    row('desk_series', 's3', { listId: 'gone' }, { rule: 'FREQ=DAILY', anchor: '2026-11-02' }),
  ],
});

describe('the Desk in an export', () => {
  it('has its lists in order, each with its cards in order and each card its checklist in order', () => {
    const desk = buildDesk(rows());
    expect(desk.lists.map((list) => list.id)).toEqual(['l1', 'l2']);
    expect(desk.lists[0]?.cards.map((card) => card.id)).toEqual(['c1', 'c2']);
    expect(desk.lists[0]?.cards[0]?.checklist.map((item) => item.title)).toEqual([
      'first',
      'later',
    ]);
    expect(desk.lists[1]).toMatchObject({ title: 'Second', color: '#2563eb', sort: 'due' });
    expect(desk.lists[0]).toMatchObject({ color: null, sort: null });
  });

  it('holds everything of a card: its text, star, date and time, series, start and completion', () => {
    const [one, two] = buildDesk(rows()).lists[0]?.cards ?? [];
    expect(one).toEqual({
      id: 'c1',
      title: 'one',
      description: 'Notes\nmore',
      starred: false,
      dueDate: '2026-11-06',
      dueTime: '09:00',
      dueEnd: '10:30',
      seriesId: 's1',
      startedAt: 3,
      completedAt: 5,
      position: 'a0',
      checklist: [
        { id: 'i1', title: 'first', completedAt: null, position: 'a0' },
        { id: 'i2', title: 'later', completedAt: 7, position: 'a1' },
      ],
    });
    expect(two).toMatchObject({ starred: true, description: '', dueDate: null, seriesId: null });
  });

  it('leaves out what was deleted, and what hangs on a row that is not there: a list’s cards, a card’s items, a series of a deleted list', () => {
    const desk = buildDesk(rows());
    const everything = JSON.stringify(desk);
    for (const gone of [
      'Deleted list',
      '"deleted"',
      'in a deleted list',
      '"gone"',
      'of a deleted card',
      's2',
      's3',
    ])
      expect(everything, gone).not.toContain(gone);
    expect(desk.series).toEqual([
      { id: 's1', listId: 'l1', rule: 'FREQ=DAILY', anchor: '2026-11-01' },
    ]);
    // A pointer to a series that is not in the file would point at nothing.
    expect(desk.lists[1]?.cards[0]?.seriesId).toBeNull();
  });

  it('is the same whatever order the rows come in, and two files of the same data differ in nothing but exportedAt', () => {
    const shuffled = rows();
    const reversed = {
      lists: [...shuffled.lists].reverse(),
      cards: [...shuffled.cards].reverse(),
      checks: [...shuffled.checks].reverse(),
      series: [...shuffled.series].reverse(),
    };
    expect(buildDesk(reversed)).toEqual(buildDesk(rows()));
    const a = serialise(
      envelope('desk', { desk: buildDesk(rows()) }, new Date('2026-11-06T09:00:00Z')),
    );
    const b = serialise(
      envelope('desk', { desk: buildDesk(reversed) }, new Date('2026-11-07T10:30:00Z')),
    );
    expect(a.replace(/"exportedAt": "[^"]+"/, '')).toBe(b.replace(/"exportedAt": "[^"]+"/, ''));
    expect(a).not.toBe(b);
  });

  it('writes a field it cannot read as empty, and reads it through `open` when it is given one', () => {
    const sealed = {
      lists: [row('desk_list', 'l1', { position: 'a0' }, { title: 'L' })],
      cards: [
        {
          ...row('desk_card', 'c1', { listId: 'l1', position: 'a0' }, {}),
          fields: { title: { c: 'SEALED', s: 1 } },
        } as LocalRow,
      ],
      checks: [],
      series: [],
    };
    expect(buildDesk(sealed).lists[0]?.cards[0]?.title).toBe('');
    expect(
      buildDesk(sealed, (field) => (field.c === 'SEALED' ? 'Opened' : undefined)).lists[0]?.cards[0]
        ?.title,
    ).toBe('Opened');
  });
});

describe('the file around it', () => {
  it('says what it is, its version and its scope, and is named tusk-scope-date.json', () => {
    const at = new Date('2026-11-06T09:00:00Z');
    const file = envelope('desk', { desk: { lists: [], series: [] } }, at);
    expect(file).toMatchObject({
      format: 'tusk',
      version: 1,
      exportedAt: '2026-11-06T09:00:00.000Z',
      scope: 'desk',
    });
    expect(fileNameOf('desk', at)).toBe('tusk-desk-2026-11-06.json');
    expect(fileNameOf('everything', at)).toBe('tusk-everything-2026-11-06.json');
    expect(serialise(file).endsWith('}\n')).toBe(true);
  });

  it('holds no key, token, connection or credential: nothing in the builder reads one', () => {
    const text = JSON.stringify(buildDesk(rows()));
    expect(text).not.toMatch(/token|secret|password|apiKey|credential|connection/i);
  });
});

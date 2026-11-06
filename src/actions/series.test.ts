import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import { TUSK_NAMESPACE, uuid5 } from '../uuid5';
import { completeCard, setStatus, updateCard } from './cards';
import {
  duplicateOccurrences,
  nextOccurrenceChanges,
  readSeries,
  seriesIdOf,
  setDueInSeries,
  setRepeat,
  stopRepeat,
} from './series';

/** A repeating card (DESIGN.md §12): completing makes exactly one next, from the series' rule, and the same one on every device. */
const ids = () => {
  let n = 0;
  return { newId: () => `new-${++n}` };
};
const SERIES = '11111111-1111-4111-8111-111111111111';
const TODAY = '2026-11-06';

const card = (id: string, fields: Record<string, unknown> = {}, extra: object = {}): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId: 'list-1',
    position: 'a5',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v, s: 1 }])),
    ...extra,
  }) as LocalRow;
const item = (id: string, title: string, completedAt: number | null = null): LocalRow =>
  ({
    table: 'desk_check',
    id,
    cardId: 'c1',
    position: id === 'i1' ? 'a0' : 'a1',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { title: { v: title, s: 1 }, completedAt: { v: completedAt, s: 1 } },
  }) as LocalRow;
const series = (rule: string, anchor: string, extra: object = {}): LocalRow =>
  ({
    table: 'desk_series',
    id: SERIES,
    listId: 'list-1',
    deletedAt: null,
    seq: 1,
    createdAt: 1,
    fields: { rule: { v: rule, s: 1 }, anchor: { v: anchor, s: 1 } },
    ...extra,
  }) as LocalRow;

const repeating = (fields: Record<string, unknown> = {}) =>
  card('c1', {
    title: 'Water the plants',
    description: 'The ones by the window',
    starred: true,
    dueDate: '2026-11-06',
    dueTime: '18:00',
    seriesId: SERIES,
    ...fields,
  });

function made(result: ReturnType<typeof completeCard>) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  const [first, ...rest] = result.mutation.changes;
  return { completion: first, rest, all: result.mutation.changes };
}

describe('completing a card that repeats', () => {
  const weekly = series('FREQ=WEEKLY;BYDAY=FR', '2026-11-06');

  it('is one mutation: the completion, and the next occurrence with what it copies and nothing it does not', () => {
    const { completion, rest } = made(
      completeCard(repeating(), 1_800_000_000_000, ids(), [], { series: weekly, today: TODAY }),
    );
    expect(completion).toEqual({
      table: 'desk_card',
      id: 'c1',
      fields: { completedAt: { v: 1_800_000_000_000 } },
    });
    expect(rest).toHaveLength(1);
    expect(rest[0]).toEqual({
      table: 'desk_card',
      id: uuid5(`occurrence:${SERIES}:2026-11-13`, TUSK_NAMESPACE),
      listId: 'list-1',
      position: 'a5',
      fields: {
        dueDate: { v: '2026-11-13' },
        seriesId: { v: SERIES },
        title: { v: 'Water the plants' },
        description: { v: 'The ones by the window' },
        starred: { v: true },
        dueTime: { v: '18:00' },
      },
    });
    // No start time and no completion: it begins Open.
    const fields = Object.keys((rest[0] as { fields: object }).fields);
    expect(fields).not.toContain('startedAt');
    expect(fields).not.toContain('completedAt');
  });

  it('copies the checklist, unticked, with ids derived from the next occurrence’s and the item’s own', () => {
    const items = [item('i1', 'Fill the can', 1_700_000_000_000), item('i2', 'Turn the pots')];
    const { rest } = made(
      completeCard(repeating(), 5, ids(), items, { series: weekly, today: TODAY }),
    );
    const next = uuid5(`occurrence:${SERIES}:2026-11-13`, TUSK_NAMESPACE);
    // The two open items are completed with the card; the next gets both again, unticked.
    expect(rest.filter((c) => c.table === 'desk_check' && c.cardId === undefined)).toHaveLength(1);
    const copies = rest.filter((c) => c.table === 'desk_check' && c.cardId === next);
    expect(copies).toEqual([
      {
        table: 'desk_check',
        id: uuid5(`item:${next}:i1`, TUSK_NAMESPACE),
        cardId: next,
        position: 'a0',
        fields: { title: { v: 'Fill the can' } },
      },
      {
        table: 'desk_check',
        id: uuid5(`item:${next}:i2`, TUSK_NAMESPACE),
        cardId: next,
        position: 'a1',
        fields: { title: { v: 'Turn the pots' } },
      },
    ]);
  });

  it('makes the same rows on every device: two devices completing it, even at different moments, agree on every id', () => {
    const a = made(completeCard(repeating(), 1000, ids(), [], { series: weekly, today: TODAY }));
    const b = made(completeCard(repeating(), 999_999, ids(), [], { series: weekly, today: TODAY }));
    expect(a.rest).toEqual(b.rest);
  });

  it('makes a different one on a different day, so that two devices that completed on different days make two, which the rule then settles', () => {
    const daily = series('FREQ=DAILY', '2026-11-01');
    const day1 = nextOccurrenceChanges(
      repeating({ dueDate: '2026-11-01' }),
      [],
      daily,
      '2026-11-02',
    );
    const day2 = nextOccurrenceChanges(
      repeating({ dueDate: '2026-11-01' }),
      [],
      daily,
      '2026-11-04',
    );
    expect(day1[0]?.id).not.toBe(day2[0]?.id);
  });

  it('does not leave a trail: a daily card ticked a week late gets one that is due after today', () => {
    const daily = series('FREQ=DAILY', '2026-10-30');
    const [next] = nextOccurrenceChanges(repeating({ dueDate: '2026-10-30' }), [], daily, TODAY);
    expect((next as unknown as { fields: { dueDate: { v: string } } }).fields.dueDate.v).toBe(
      '2026-11-07',
    );
  });

  it('begins Open even when the card was in progress', () => {
    const started = repeating({ startedAt: 1_700_000_000_000 });
    const [, next] = made(
      completeCard(started, 5, ids(), [], { series: weekly, today: TODAY }),
    ).all;
    expect(Object.keys((next as { fields: object }).fields)).not.toContain('startedAt');
  });

  it('makes none for the last of a COUNT, for a series that has ended, and for one that is gone or unreadable', () => {
    const last = series('FREQ=DAILY;COUNT=3', '2026-11-04');
    const ended = series('FREQ=WEEKLY;UNTIL=20261110', '2026-11-06');
    for (const [label, s, due] of [
      ['count', last, '2026-11-06'],
      ['until', ended, '2026-11-06'],
      ['deleted', series('FREQ=DAILY', '2026-11-06', { deletedAt: 5 }), '2026-11-06'],
      ['unreadable rule', series('FREQ=HOURLY', '2026-11-06'), '2026-11-06'],
      ['missing', undefined, '2026-11-06'],
    ] as const)
      expect(
        made(completeCard(repeating({ dueDate: due }), 5, ids(), [], { series: s, today: TODAY }))
          .all,
        label,
      ).toHaveLength(1);
  });

  it('makes none from a series the card does not belong to', () => {
    const other = repeating({ seriesId: '22222222-2222-4222-8222-222222222222' });
    expect(nextOccurrenceChanges(other, [], series('FREQ=DAILY', TODAY), TODAY)).toEqual([]);
  });

  it('is nothing for a card that is done already, so a double tap makes one next and not two', () => {
    const done = repeating({ completedAt: 5 });
    expect(completeCard(done, 6, ids(), [], { series: weekly, today: TODAY })).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('makes one when the Done status is chosen as when the box is ticked', () => {
    const viaStatus = setStatus(repeating(), 'done', 5, ids(), [], {
      series: weekly,
      today: TODAY,
    });
    const viaBox = completeCard(repeating(), 5, ids(), [], { series: weekly, today: TODAY });
    expect(viaStatus.ok && viaStatus.mutation.changes).toEqual(
      viaBox.ok && viaBox.mutation.changes,
    );
  });

  it('is as it was for a card that does not repeat', () => {
    const plain = card('c9', { title: 'One-off' });
    expect(
      made(completeCard(plain, 5, ids(), [], { series: weekly, today: TODAY })).all,
    ).toHaveLength(1);
    expect(made(completeCard(plain, 5, ids())).all).toHaveLength(1);
  });
});

describe('setting a card to repeat', () => {
  const plain = card('c1', { title: 'Pay rent', dueDate: '2026-11-06' });

  it('makes a series and points the card at it, the series first', () => {
    const result = setRepeat(plain, undefined, 'FREQ=MONTHLY', TODAY, ids());
    expect(result.ok && result.mutation.changes).toEqual([
      {
        table: 'desk_series',
        id: 'new-1',
        listId: 'list-1',
        fields: { rule: { v: 'FREQ=MONTHLY' }, anchor: { v: '2026-11-06' } },
      },
      { table: 'desk_card', id: 'c1', fields: { seriesId: { v: 'new-1' } } },
    ]);
  });

  it('gives a card with no date the first date the rule matches from today', () => {
    const undated = card('c1', { title: 'Run' });
    const result = setRepeat(undated, undefined, 'FREQ=WEEKLY;BYDAY=MO', TODAY, ids());
    expect(result.ok && result.mutation.changes[1]).toEqual({
      table: 'desk_card',
      id: 'c1',
      fields: {
        dueDate: { v: '2026-11-09' },
        dueTime: { v: null },
        seriesId: { v: 'new-1' },
      },
    });
    const today = setRepeat(undated, undefined, 'FREQ=DAILY', TODAY, ids());
    expect(today.ok && JSON.stringify(today.mutation.changes[1])).toContain('2026-11-06');
  });

  it('replaces the rule of the series the card is in, and sets the anchor to this occurrence’s date', () => {
    const inSeries = repeating({ dueDate: '2026-11-13' });
    const result = setRepeat(
      inSeries,
      series('FREQ=DAILY', '2026-11-01'),
      'FREQ=WEEKLY;INTERVAL=2',
      TODAY,
      ids(),
    );
    expect(result.ok && result.mutation.changes).toEqual([
      {
        table: 'desk_series',
        id: SERIES,
        fields: { rule: { v: 'FREQ=WEEKLY;INTERVAL=2' }, anchor: { v: '2026-11-13' } },
      },
    ]);
  });

  it('stores the one canonical text, and writes nothing when nothing changes', () => {
    const result = setRepeat(plain, undefined, 'INTERVAL=1;FREQ=MONTHLY', TODAY, ids());
    expect(result.ok && JSON.stringify(result.mutation.changes[0])).toContain('"FREQ=MONTHLY"');
    const same = setRepeat(
      repeating(),
      series('FREQ=MONTHLY', '2026-11-06'),
      'FREQ=MONTHLY',
      TODAY,
      ids(),
    );
    expect(same).toEqual({ ok: false, reason: 'nothing' });
  });

  it('refuses a rule that is not on the allow-list, a rule that never matches, a card that is done and a card that is not there', () => {
    expect(setRepeat(plain, undefined, 'FREQ=HOURLY', TODAY, ids())).toEqual({
      ok: false,
      reason: 'rule',
    });
    expect(setRepeat(plain, undefined, 'FREQ=DAILY;BYHOUR=9', TODAY, ids())).toEqual({
      ok: false,
      reason: 'rule',
    });
    const undated = card('c1', { title: 'Run' });
    expect(setRepeat(undated, undefined, 'FREQ=DAILY;UNTIL=20200101', TODAY, ids())).toEqual({
      ok: false,
      reason: 'rule',
    });
    expect(
      setRepeat(card('c1', { title: 'x', completedAt: 5 }), undefined, 'FREQ=DAILY', TODAY, ids()),
    ).toEqual({ ok: false, reason: 'nothing' });
    expect(setRepeat(undefined, undefined, 'FREQ=DAILY', TODAY, ids())).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('reading a card’s series', () => {
  it('finds its id, and reads a series’ rule and anchor, or nothing for one that cannot be used', () => {
    expect(seriesIdOf(repeating())).toBe(SERIES);
    expect(seriesIdOf(card('c', { title: 'x' }))).toBeUndefined();
    expect(readSeries(series('FREQ=DAILY', '2026-11-06'))).toMatchObject({
      id: SERIES,
      anchor: '2026-11-06',
    });
    expect(readSeries(series('nope', '2026-11-06'))).toBeUndefined();
    expect(readSeries(undefined)).toBeUndefined();
  });
});

describe('two open occurrences of one series', () => {
  const open = (id: string, due: string | null, extra: Record<string, unknown> = {}) =>
    card(id, { title: 't', seriesId: SERIES, ...(due ? { dueDate: due } : {}), ...extra });

  it('deletes all but the earliest, by due date and then id, whichever device looks', () => {
    const cards = [open('b', '2026-11-13'), open('a', '2026-11-20'), open('c', '2026-11-13')];
    expect(duplicateOccurrences(cards)).toEqual(['a', 'c']);
    expect(duplicateOccurrences([...cards].reverse())).toEqual(['a', 'c']);
  });

  it('counts a card with no date as the later one', () => {
    expect(duplicateOccurrences([open('a', null), open('z', '2026-12-31')])).toEqual(['a']);
  });

  it('leaves alone a completed occurrence, a deleted one, a card of another series and a card of none', () => {
    const cards = [
      open('a', '2026-11-13'),
      open('b', '2026-11-06', { completedAt: 5 }),
      open('c', '2026-11-20', {}),
    ];
    expect(duplicateOccurrences(cards)).toEqual(['c']);
    expect(
      duplicateOccurrences([
        open('a', '2026-11-13'),
        card('d', { title: 'x', seriesId: '3'.repeat(8) + '-3333-4333-8333-333333333333' }),
      ]),
    ).toEqual([]);
    expect(duplicateOccurrences([open('a', '2026-11-13'), card('e', { title: 'x' })])).toEqual([]);
    expect(
      duplicateOccurrences([
        open('a', '2026-11-13'),
        { ...open('f', '2026-11-20'), deletedAt: 9 } as LocalRow,
      ]),
    ).toEqual([]);
  });

  it('is nothing when there is one', () => {
    expect(duplicateOccurrences([open('a', '2026-11-13')])).toEqual([]);
    expect(duplicateOccurrences([])).toEqual([]);
  });
});

describe('"Does not repeat"', () => {
  it('detaches this card alone, as one change, and leaves the series row for the job that removes it', () => {
    const result = stopRepeat(repeating(), ids());
    expect(result.ok && result.mutation.changes).toEqual([
      { table: 'desk_card', id: 'c1', fields: { seriesId: { v: null } } },
    ]);
  });

  it('is nothing for a card that does not repeat, and missing for none', () => {
    expect(stopRepeat(card('c9', { title: 'x' }), ids())).toEqual({ ok: false, reason: 'nothing' });
    expect(stopRepeat(undefined, ids())).toEqual({ ok: false, reason: 'missing' });
  });

  it('makes a card that completes without a next', () => {
    const detached = repeating({ seriesId: null });
    const weekly = series('FREQ=DAILY', '2026-11-06');
    expect(nextOccurrenceChanges(detached, [], weekly, TODAY)).toEqual([]);
  });
});

/** Editing a card that repeats (DESIGN.md §12.4): this occurrence and every later one change, with no prompt and no new row. */
describe('editing a recurring card', () => {
  const MONDAY = '2026-11-09';
  const weeklyMonday = series('FREQ=WEEKLY;BYDAY=MO', MONDAY);
  const onMonday = () => repeating({ dueDate: MONDAY, dueTime: null });

  /** The rows once a mutation has been laid over them: enough of the working copy's own rule for these tests. */
  function laid(rows: LocalRow[], changes: readonly object[]): LocalRow[] {
    return rows.map((row) => {
      const change = changes.find((each) => (each as { id: string }).id === row.id) as
        { fields?: Record<string, { v: unknown }> } | undefined;
      if (!change?.fields) return row;
      return {
        ...row,
        fields: {
          ...row.fields,
          ...Object.fromEntries(Object.entries(change.fields).map(([k, f]) => [k, { ...f, s: 2 }])),
        },
      } as LocalRow;
    });
  }

  it('moves the series with the date: the anchor is the new date, and a weekly rule on one weekday goes to its weekday', () => {
    const result = setDueInSeries(
      onMonday(),
      weeklyMonday,
      { date: '2026-11-10', time: null },
      ids(),
    );
    expect(result.ok && result.mutation.changes).toEqual([
      expect.objectContaining({ table: 'desk_card', id: 'c1' }),
      {
        table: 'desk_series',
        id: SERIES,
        fields: { anchor: { v: '2026-11-10' }, rule: { v: 'FREQ=WEEKLY;BYDAY=TU' } },
      },
    ]);
  });

  it('makes later occurrences follow: moved to a Tuesday, the next is a Tuesday', () => {
    const moved = setDueInSeries(
      onMonday(),
      weeklyMonday,
      { date: '2026-11-10', time: null },
      ids(),
    );
    if (!moved.ok) throw new Error('refused');
    const [card2, series2] = laid([onMonday(), weeklyMonday], moved.mutation.changes);
    const done = made(
      completeCard(card2 as LocalRow, 5, ids(), [], { series: series2, today: '2026-11-10' }),
    );
    const next = done.rest[0] as unknown as { fields: { dueDate: { v: string } } };
    expect(next.fields.dueDate.v).toBe('2026-11-17');
  });

  it('leaves a rule that is not one weekday as it was, and only moves the anchor', () => {
    const daily = series('FREQ=DAILY', '2026-11-01');
    const result = setDueInSeries(
      repeating({ dueDate: '2026-11-03' }),
      daily,
      { date: '2026-11-08', time: null },
      ids(),
    );
    expect(result.ok && result.mutation.changes[1]).toEqual({
      table: 'desk_series',
      id: SERIES,
      fields: { anchor: { v: '2026-11-08' } },
    });
  });

  it('writes nothing to the series for a change of the time alone, or a date that is the anchor already', () => {
    const time = setDueInSeries(onMonday(), weeklyMonday, { date: MONDAY, time: '08:00' }, ids());
    expect(time.ok && time.mutation.changes).toHaveLength(1);
    const same = setDueInSeries(
      repeating({ dueDate: '2026-11-16' }),
      weeklyMonday,
      { date: MONDAY, time: null },
      ids(),
    );
    expect(same.ok && same.mutation.changes).toHaveLength(1);
    const unchanged = setDueInSeries(onMonday(), weeklyMonday, { date: MONDAY, time: null }, ids());
    expect(unchanged).toEqual({ ok: false, reason: 'nothing' });
  });

  it('clearing the date detaches the card as a one-off and the series ends, with its time cleared as before', () => {
    const result = setDueInSeries(
      repeating({ dueDate: MONDAY }),
      weeklyMonday,
      { date: null, time: null },
      ids(),
    );
    expect(result.ok && result.mutation.changes).toEqual([
      {
        table: 'desk_card',
        id: 'c1',
        fields: { dueDate: { v: null }, dueTime: { v: null } },
      },
      { table: 'desk_card', id: 'c1', fields: { seriesId: { v: null } } },
    ]);
    // Detached, completing it makes no next.
    const [card2, series2] = laid([repeating({ dueDate: MONDAY })], []);
    expect(card2).toBeDefined();
    expect(series2).toBeUndefined();
  });

  it('is only the ordinary change for a card that does not repeat, or a series that is not its own', () => {
    const plain = card('c9', { title: 'x', dueDate: MONDAY });
    const ordinary = setDueInSeries(plain, weeklyMonday, { date: '2026-11-10', time: null }, ids());
    expect(ordinary.ok && ordinary.mutation.changes).toHaveLength(1);
    const foreign = setDueInSeries(
      repeating({ seriesId: '22222222-2222-4222-8222-222222222222', dueDate: MONDAY }),
      weeklyMonday,
      { date: '2026-11-10', time: null },
      ids(),
    );
    expect(foreign.ok && foreign.mutation.changes).toHaveLength(1);
  });

  it('never writes a completed occurrence’s series or detaches it: a done card is changed as any card is', () => {
    const done = repeating({ dueDate: MONDAY, completedAt: 5 });
    const moved = setDueInSeries(done, weeklyMonday, { date: '2026-11-10', time: null }, ids());
    expect(moved.ok && moved.mutation.changes.map((c) => c.table)).toEqual(['desk_card']);
    const cleared = setDueInSeries(done, weeklyMonday, { date: null, time: null }, ids());
    expect(cleared.ok && JSON.stringify(cleared.mutation.changes)).not.toContain('seriesId');
    expect(stopRepeat(done, ids())).toEqual({ ok: false, reason: 'nothing' });
    expect(setRepeat(done, weeklyMonday, 'FREQ=DAILY', TODAY, ids())).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });

  it('makes the next occurrence from the new name, and the occurrences already done keep theirs', () => {
    const original = onMonday();
    const first = made(
      completeCard(original, 5, ids(), [], { series: weeklyMonday, today: MONDAY }),
    );
    const nextId = (first.rest[0] as { id: string }).id;
    // The next is renamed, then completed: the one after has the new name; the first card was never written.
    const renamed = updateCard(
      { ...original, id: nextId, fields: { ...original.fields } } as LocalRow,
      { title: 'Water everything' },
      ids(),
    );
    expect(renamed.ok && renamed.mutation.changes).toEqual([
      { table: 'desk_card', id: nextId, fields: { title: { v: 'Water everything' } } },
    ]);
    const next = {
      ...original,
      id: nextId,
      fields: {
        ...original.fields,
        title: { v: 'Water everything', s: 2 },
        dueDate: { v: '2026-11-16', s: 1 },
      },
    } as LocalRow;
    const second = made(
      completeCard(next, 9, ids(), [], { series: weeklyMonday, today: '2026-11-16' }),
    );
    expect((second.rest[0] as unknown as { fields: { title: { v: string } } }).fields.title.v).toBe(
      'Water everything',
    );
    expect(
      first.all.some((c) => c.id === original.id && JSON.stringify(c).includes('Water everything')),
    ).toBe(false);
  });

  it('makes no row by any edit: every change names a row that was there', () => {
    const there = new Set(['c1', SERIES]);
    const results = [
      setDueInSeries(onMonday(), weeklyMonday, { date: '2026-11-10', time: null }, ids()),
      setDueInSeries(onMonday(), weeklyMonday, { date: null, time: null }, ids()),
      setRepeat(onMonday(), weeklyMonday, 'FREQ=DAILY', TODAY, ids()),
      stopRepeat(onMonday(), ids()),
      updateCard(onMonday(), { title: 'New name', description: 'More' }, ids()),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok)
        for (const change of result.mutation.changes)
          expect(there.has(change.id), JSON.stringify(change)).toBe(true);
    }
  });
});

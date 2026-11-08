import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../local/rows';
import {
  CHUNK_DAYS,
  type Entry,
  FOLD_AT,
  boardEntries,
  byDay,
  chunkOf,
  chunkRange,
  dayParts,
  daysOf,
  deskEntries,
  gapLabel,
  groupByDate,
  layout,
  nowIndex,
  slotBetween,
} from './feed';

const card = (id: string, fields: Record<string, unknown>, listId = 'L1'): LocalRow =>
  ({
    table: 'desk_card',
    id,
    listId,
    deletedAt: null,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v }])),
  }) as unknown as LocalRow;
const list = (id: string, fields: Record<string, unknown>): LocalRow =>
  ({
    table: 'desk_list',
    id,
    deletedAt: null,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v }])),
  }) as unknown as LocalRow;
const lists = [list('L1', { title: 'Errands', color: '#16a34a' })];

describe('the chunks the feed is read in', () => {
  it('are four weeks on a fixed grid, so a day is always in the same one', () => {
    for (const date of ['2026-11-08', '2026-01-01', '2027-12-31', '1999-02-28']) {
      const { from, to } = chunkRange(chunkOf(date));
      expect(date >= from && date <= to, date).toBe(true);
      expect(daysOf(from, to)).toHaveLength(CHUNK_DAYS);
      expect(chunkOf(from)).toBe(chunkOf(to));
      expect(chunkOf(daysOf(to, to)[0] as string)).toBe(chunkOf(date));
    }
    const { to } = chunkRange(100);
    expect(chunkOf(to)).toBe(100);
    expect(chunkRange(101).from > to).toBe(true);
    expect(daysOf(to, chunkRange(101).from)).toHaveLength(2);
  });
});

describe('the Desk and the boards as one kind of entry', () => {
  it('takes the Desk cards with a readable date in the range, and leaves out the rest', () => {
    const entries = deskEntries(
      [
        card('a', { title: 'In', dueDate: '2026-11-10', dueTime: '09:30' }),
        card('b', { title: 'Done', dueDate: '2026-11-10', completedAt: 5 }),
        card('c', { title: 'Before', dueDate: '2026-11-01' }),
        card('d', { title: 'After', dueDate: '2026-12-01' }),
        card('e', { title: 'Undated' }),
        card('f', { title: 'Not a date', dueDate: 'soon' }),
        // A date that is ciphertext (a sealed Desk that is not open) cannot be placed.
        { ...card('g', { title: 'x' }), fields: { dueDate: { c: 'AAAA' } } } as unknown as LocalRow,
        card('h', { title: 'Odd time', dueDate: '2026-11-10', dueTime: '25:99' }),
      ],
      lists,
      '2026-11-02',
      '2026-11-30',
    );
    expect(entries.map((e) => e.id)).toEqual(['a', 'b', 'h']);
    expect(entries[0]).toMatchObject({
      key: 'desk:a',
      source: 'desk',
      time: '09:30',
      done: false,
      color: '#16a34a',
      where: 'Errands',
      href: '/planner?card=a',
    });
    expect(entries[1]?.done).toBe(true);
    expect(entries[2]?.time).toBeNull();
  });

  it('takes the boards’ cards as they came, linking to the card on its board', () => {
    expect(
      boardEntries([
        {
          cardId: 'c1',
          boardId: 'b1',
          boardName: 'Roadmap',
          boardColor: '#2563eb',
          listName: 'Backlog',
          title: 'Ship',
          dueDate: '2026-11-12',
          dueTime: null,
        },
      ]),
    ).toEqual([
      {
        key: 'board:c1',
        source: 'board',
        id: 'c1',
        title: 'Ship',
        date: '2026-11-12',
        time: null,
        done: false,
        color: '#2563eb',
        where: 'Roadmap',
        href: '/b/b1/c/c1',
      },
    ]);
  });
});

describe('a day’s order', () => {
  const e = (key: string, over: Partial<Entry>): Entry => ({
    key,
    source: 'desk',
    id: key,
    title: key,
    date: '2026-11-12',
    time: null,
    done: false,
    color: '#000000',
    where: '',
    href: '',
    ...over,
  });
  it('is no time first, then by time, then the Desk’s before a board’s, then by title', () => {
    const day = groupByDate([
      e('late', { time: '15:00' }),
      e('b-notime', { source: 'board' }),
      e('early', { time: '09:00' }),
      e('a-notime', {}),
      e('same-time-board', { time: '09:00', source: 'board' }),
    ]).get('2026-11-12');
    expect(day?.map((x) => x.key)).toEqual([
      'a-notime',
      'b-notime',
      'early',
      'same-time-board',
      'late',
    ]);
    expect(byDay(e('x', {}), e('x', {}))).toBe(0);
  });
});

describe('folding empty days', () => {
  const today = '2026-11-08';
  const days = daysOf('2026-11-01', '2026-11-30');
  const withCards = (...dates: string[]) =>
    new Map(dates.map((date) => [date, [{ key: date } as Entry]]));

  it('folds a run of empty days into one row, and leaves a shorter run as days', () => {
    const rows = layout(days, withCards('2026-11-04', '2026-11-12', '2026-11-14'), today);
    expect(FOLD_AT).toBe(3);
    const shape = rows.map((r) =>
      r.kind === 'day' ? r.date.slice(8) : `gap ${r.from.slice(8)}-${r.to.slice(8)}`,
    );
    expect(shape).toEqual([
      'gap 01-03',
      ...['04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14'],
      'gap 15-30',
    ]);
  });

  it('never folds today or the day either side of it, whatever is on them', () => {
    const rows = layout(days, new Map(), today);
    const dayDates = rows.flatMap((r) => (r.kind === 'day' ? [r.date] : []));
    expect(dayDates).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
    expect(rows[0]).toMatchObject({ kind: 'gap', from: '2026-11-01', to: '2026-11-06', count: 6 });
    expect(rows.at(-1)).toMatchObject({
      kind: 'gap',
      from: '2026-11-10',
      to: '2026-11-30',
      count: 21,
    });
  });

  it('keeps a run open when the window makes it longer, at either end', () => {
    const wider = daysOf('2026-10-20', '2026-12-10');
    const rows = layout(wider, new Map(), today, new Set(['2026-11-10']));
    // Only the run after today was opened; the one before it is still folded.
    expect(rows.filter((r) => r.kind === 'gap')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'gap')[0]).toMatchObject({ from: '2026-10-20' });
    expect(rows.filter((r) => r.kind === 'day')).toHaveLength(3 + 31);
  });

  it('unfolds a gap that is open, naming it by its first day', () => {
    const rows = layout(days, new Map(), today, new Set(['2026-11-10']));
    expect(rows.filter((r) => r.kind === 'gap')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'day')).toHaveLength(3 + 21);
  });
});

describe('how a day and a gap read', () => {
  it('writes the weekday, the day and the month from the date itself, in any zone', () => {
    expect(dayParts('2026-11-04', 'en-US')).toEqual({
      weekday: 'Wed',
      day: '4',
      month: 'Nov',
      year: '2026',
    });
  });
  it('writes a gap with its months, and the year only when it is not this one', () => {
    expect(gapLabel('2026-11-10', '2026-11-21', '2026-11-08', 'en-US')).toBe('Nov 10 – 21');
    expect(gapLabel('2026-11-28', '2026-12-03', '2026-11-08', 'en-US')).toBe('Nov 28 – Dec 3');
    expect(gapLabel('2026-12-28', '2027-01-03', '2026-11-08', 'en-US')).toBe(
      'Dec 28 – Jan 3, 2027',
    );
  });
});

describe('the line for now', () => {
  const at = (time: string | null): Entry => ({
    key: String(time),
    source: 'desk',
    id: String(time),
    title: String(time),
    date: '2026-11-08',
    time,
    done: false,
    color: '#000000',
    where: '',
    href: '',
  });
  const day = [at(null), at('09:00'), at('13:00'), at('13:00'), at('18:30')];

  it('is before the first timed card that is after the time, and after them all once they have gone', () => {
    expect(nowIndex(day, '08:59')).toBe(1);
    expect(nowIndex(day, '12:00')).toBe(2);
    expect(nowIndex(day, '13:00')).toBe(4);
    expect(nowIndex(day, '18:30')).toBe(5);
    expect(nowIndex(day, '23:59')).toBe(5);
  });

  it('is not there when no card has a time, however late it is', () => {
    expect(nowIndex([at(null), at(null)], '12:00')).toBeNull();
    expect(nowIndex([], '12:00')).toBeNull();
  });
});

describe('a free slot between two timed cards', () => {
  it('is an hour after the first, where the next is two hours or more later', () => {
    expect(slotBetween('09:00', '11:00')).toBe('10:00');
    expect(slotBetween('09:30', '15:00')).toBe('10:30');
    expect(slotBetween('13:00', '23:59')).toBe('14:00');
  });
  it('is not there when there is not an hour left over', () => {
    expect(slotBetween('09:00', '10:59')).toBeNull();
    expect(slotBetween('09:00', '09:00')).toBeNull();
    expect(slotBetween('09:00', '10:00')).toBeNull();
  });
});

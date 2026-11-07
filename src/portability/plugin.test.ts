import { describe, expect, it } from 'vitest';
import { parseRule } from '../recurrence';
import { importDesk } from './import-desk';
import { convertTasksPlugin, isPluginFile } from './plugin';
import { describeSummary, summarise, validateFile } from './validate';

/**
 * Reading the tasks plugin's file (DESIGN.md §20.2). The fixture has the shape the plugin's export writes (`app/_lib/portability.ts`) and the kinds of thing its
 * seed makes: ids that are not UUIDs, epoch seconds, an integer order, subtasks, a favourite, notes, dates, a repeat with its history, and what Tusk has no place for.
 */
const t = (day: string) => Math.floor(Date.parse(`${day}T09:00:00Z`) / 1000);
const item = (extra: Record<string, unknown>) => ({
  id: 'x',
  listId: 'seed-list-home',
  parentId: null,
  assigneeId: null,
  title: 'A task',
  notes: null,
  favorite: false,
  dueDate: null,
  dueTime: null,
  reminderSentAt: null,
  completedAt: null,
  sortOrder: 0,
  recurrenceRule: null,
  seriesId: null,
  createdAt: t('2026-10-01'),
  updatedAt: t('2026-10-01'),
  ...extra,
});

const FIXTURE = {
  pluginId: 'fs.sovereign.tasks',
  schemaVersion: 1,
  data: {
    lists: [
      {
        id: 'seed-list-work',
        title: 'Work',
        color: '#2563eb',
        sortOrder: 2000,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'seed-list-home',
        title: 'Home',
        color: 'green',
        sortOrder: 1000,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    userListPrefs: [
      {
        listId: 'seed-list-home',
        showCompleted: false,
        defaultViewId: 'v1',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    views: [
      {
        id: 'v1',
        listId: 'seed-list-home',
        name: 'Board',
        kind: 'board',
        config: '{}',
        isDefault: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    items: [
      item({
        id: 'milk',
        title: '  Buy milk  ',
        notes: 'Oat, not cow\n\nSecond line',
        favorite: true,
        dueDate: '2026-11-08',
        dueTime: '09:30',
        sortOrder: 2000,
      }),
      item({ id: 'bread', title: 'Bread', sortOrder: 1000, completedAt: t('2026-10-30') }),
      item({
        id: 'oat',
        parentId: 'milk',
        title: 'Oat milk',
        sortOrder: 20,
        completedAt: t('2026-11-01'),
      }),
      item({
        id: 'barista',
        parentId: 'milk',
        title: 'Barista edition',
        sortOrder: 10,
        dueDate: '2026-11-09',
        favorite: true,
      }),
      item({ id: 'deeper', parentId: 'oat', title: 'Two litres', sortOrder: 5 }),
      item({ id: 'lost', parentId: 'gone', title: 'Whose subtask?', sortOrder: 3000 }),
      item({
        id: 'bins-1',
        title: 'Take out the bins',
        dueDate: '2026-10-26',
        completedAt: t('2026-10-26'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        seriesId: 'bins',
        sortOrder: 4000,
      }),
      item({
        id: 'bins-2',
        title: 'Take out the bins',
        dueDate: '2026-11-02',
        completedAt: t('2026-11-02'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        seriesId: 'bins',
        sortOrder: 4100,
      }),
      item({
        id: 'bins-3',
        title: 'Take out the bins',
        dueDate: '2026-11-09',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        seriesId: 'bins',
        sortOrder: 4200,
      }),
      item({
        id: 'odd',
        title: 'Odd repeat',
        dueDate: '2026-11-10',
        recurrenceRule: 'RRULE:FREQ=HOURLY',
        seriesId: 'odd',
        sortOrder: 5000,
      }),
      item({
        id: 'two-a',
        title: 'Two open',
        dueDate: '2026-11-11',
        recurrenceRule: 'FREQ=DAILY',
        seriesId: 'two',
        sortOrder: 6000,
      }),
      item({
        id: 'two-b',
        title: 'Two open',
        dueDate: '2026-11-12',
        recurrenceRule: 'FREQ=DAILY',
        seriesId: 'two',
        sortOrder: 6100,
      }),
      item({
        id: 'report',
        listId: 'seed-list-work',
        title: 'Write the report',
        assigneeId: 'someone',
        sortOrder: 1,
      }),
      item({ id: 'ghost', listId: 'no-such-list', title: 'Where does this go' }),
      item({ id: 'blank', listId: 'seed-list-work', title: '   ', sortOrder: 2 }),
    ],
    notificationPrefs: {
      enabled: true,
      morningTime: '08:00',
      timezone: 'Europe/London',
      lastDigestDate: null,
      createdAt: 1,
      updatedAt: 1,
    },
  },
};

const read = (raw: unknown) => {
  const result = validateFile(JSON.stringify(raw));
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('the tasks plugin’s file', () => {
  it('is recognised by its plugin id and by nothing else', () => {
    expect(isPluginFile(FIXTURE)).toBe(true);
    expect(isPluginFile({ ...FIXTURE, pluginId: 'fs.sovereign.kanban' })).toBe(false);
    expect(isPluginFile({ format: 'tusk' })).toBe(false);
    expect(isPluginFile(null)).toBe(false);
    expect(isPluginFile([FIXTURE])).toBe(false);
  });

  it('imports through the ordinary validator, with every list and task as a Desk list and card, in the plugin’s order', () => {
    const { file } = read(FIXTURE);
    expect(file).toMatchObject({ format: 'tusk', version: 1, scope: 'desk' });
    // Lists by their integer order, not the order in the file.
    expect(file.desk?.lists.map((l) => l.title)).toEqual(['Home', 'Work']);
    const [home, work] = file.desk?.lists ?? [];
    expect(home?.cards.map((c) => c.title)).toEqual([
      'Bread',
      'Buy milk',
      'Whose subtask?',
      'Take out the bins',
      'Take out the bins',
      'Take out the bins',
      'Odd repeat',
      'Two open',
      'Two open',
    ]);
    expect(work?.cards.map((c) => c.title)).toEqual(['Write the report', 'Untitled']);
    // Positions sort the way the order did.
    for (const list of file.desk?.lists ?? [])
      expect(list.cards.map((c) => c.position)).toEqual(
        [...list.cards.map((c) => c.position)].sort(),
      );
  });

  it('carries what a card has: the title trimmed, notes as the description, the star, the date and time, and completion in milliseconds', () => {
    const { file } = read(FIXTURE);
    const cards = file.desk?.lists.flatMap((l) => l.cards) ?? [];
    const milk = cards.find((c) => c.title === 'Buy milk');
    expect(milk).toMatchObject({
      description: 'Oat, not cow\n\nSecond line',
      starred: true,
      dueDate: '2026-11-08',
      dueTime: '09:30',
      completedAt: null,
    });
    expect(cards.find((c) => c.title === 'Bread')?.completedAt).toBe(
      Date.parse('2026-10-30T09:00:00Z'),
    );
  });

  it('makes subtasks the card’s checklist in order, with their completion, and notes what a checklist item cannot carry', () => {
    const { file, converted } = read(FIXTURE);
    const milk = file.desk?.lists.flatMap((l) => l.cards).find((c) => c.title === 'Buy milk');
    // By their order (10, 20, and the subtask of a subtask, 5, which goes to the top task).
    expect(milk?.checklist.map((i) => i.title)).toEqual([
      'Two litres',
      'Barista edition',
      'Oat milk',
    ]);
    expect(milk?.checklist.find((i) => i.title === 'Oat milk')?.completedAt).toBe(
      Date.parse('2026-11-01T09:00:00Z'),
    );
    const said = (converted ?? []).join('\n');
    expect(said).toContain('subtask of a subtask');
    expect(said).toContain('a date, a star or a note');
    expect(said).toContain('whose task is not in the file became a card');
  });

  it('makes one series for each repeat, with its rule and its anchor from the open occurrence, and the cards keep it', () => {
    const { file } = read(FIXTURE);
    const bins = file.desk?.series.find((s) => s.rule === 'FREQ=WEEKLY;BYDAY=MO');
    expect(bins).toMatchObject({ anchor: '2026-11-09' });
    expect(parseRule(bins?.rule ?? '').ok).toBe(true);
    const cards = file.desk?.lists.flatMap((l) => l.cards) ?? [];
    const withSeries = cards.filter((c) => c.seriesId === bins?.id);
    expect(withSeries.map((c) => c.dueDate)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    // The list of a series is the one its open occurrence is in.
    expect(file.desk?.lists.some((l) => l.id === bins?.listId)).toBe(true);
  });

  it('imports a repeat whose rule is not read as a one-off, and one open occurrence beyond the first as a one-off, and says so', () => {
    const { file, converted } = read(FIXTURE);
    const cards = file.desk?.lists.flatMap((l) => l.cards) ?? [];
    expect(cards.find((c) => c.title === 'Odd repeat')?.seriesId).toBeNull();
    const two = cards.filter((c) => c.title === 'Two open');
    expect(two.filter((c) => c.seriesId !== null)).toHaveLength(1);
    expect(two.find((c) => c.dueDate === '2026-11-11')?.seriesId).not.toBeNull();
    expect(file.desk?.series).toHaveLength(2);
    const said = (converted ?? []).join('\n');
    expect(said).toContain('repeated by a rule this does not read');
    expect(said).toContain('beyond the first');
  });

  it('names everything it left behind, so that nothing is lost silently', () => {
    const said = (read(FIXTURE).converted ?? []).join('\n');
    expect(said).toContain('belonged to a list that is not in the file');
    expect(said).toContain('list colour was not a colour this reads');
    expect(said).toContain('had no title');
    expect(said).toContain('assigned to someone');
    expect(said).toContain('saved view');
  });

  it('converts to the same file twice, with ids that are UUIDs whatever the plugin’s were', () => {
    const a = convertTasksPlugin(FIXTURE, new Date('2026-11-07T00:00:00Z'));
    const b = convertTasksPlugin(FIXTURE, new Date('2026-11-07T00:00:00Z'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const ids = JSON.stringify(a).match(/"id":"[^"]+"/g) ?? [];
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids)
      expect(id).toMatch(/^"id":"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}"$/);
  });

  it('is described in the line that asks before anything is written, and imports into a Desk as it does any other', () => {
    const { file } = read(FIXTURE);
    expect(describeSummary(summarise(file))).toContain('your Desk: 2 lists');
    const imported = importDesk(
      file.desk ?? { lists: [], series: [] },
      { lists: [], listRows: 0, cardRows: 0, checkRows: 0, seriesRows: 0 },
      { newId: () => crypto.randomUUID() },
    );
    expect(imported).toMatchObject({ ok: true, counts: { lists: 2, series: 2 } });
  });

  it('refuses a file of the plugin that is not whole or is of another version, and says which', () => {
    expect(validateFile(JSON.stringify({ ...FIXTURE, schemaVersion: 2 }))).toMatchObject({
      ok: false,
    });
    expect(validateFile(JSON.stringify({ ...FIXTURE, data: { lists: 'no' } }))).toMatchObject({
      ok: false,
    });
    expect(validateFile(JSON.stringify({ ...FIXTURE, data: undefined }))).toMatchObject({
      ok: false,
    });
    const empty = read({
      ...FIXTURE,
      data: { lists: [], items: [], views: [], userListPrefs: [] },
    });
    expect(empty.file.desk?.lists).toEqual([]);
  });

  it('cuts what is longer than this allows, and says so', () => {
    const long = {
      ...FIXTURE,
      data: {
        ...FIXTURE.data,
        items: [item({ id: 'long', title: 'T'.repeat(600), notes: 'N'.repeat(25_000) })],
        lists: FIXTURE.data.lists.slice(1),
      },
    };
    const { file, converted } = read(long);
    const card = file.desk?.lists[0]?.cards[0];
    expect(card?.title.length).toBe(500);
    expect(card?.description.length).toBe(20_000);
    expect((converted ?? []).join('\n')).toContain('longer than this allows');
  });
});

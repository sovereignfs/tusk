import { describe, expect, it } from 'vitest';
import { LIMITS } from '../sync/format';
import { WORKSPACE_LIMITS } from '../workspaces/format';
import { envelope, serialise } from './format';
import { MAX_FILE_BYTES, describeSummary, summarise, validateFile } from './validate';

/**
 * Reading an export file (DESIGN.md §20.2): each file in the set below is refused, with one error that says where and never what, and nothing is read
 * from it; a good one is read whole and normalised.
 */
let n = 0;
const id = () => {
  n += 1;
  return `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
};

const goodDesk = () => {
  const [list, card, item, series] = [id(), id(), id(), id()];
  return {
    lists: [
      {
        id: list,
        title: 'Home',
        color: '#6b7280',
        position: 'a0',
        sort: 'custom',
        cards: [
          {
            id: card,
            title: 'Water',
            description: 'daily',
            starred: true,
            dueDate: '2026-11-06',
            dueTime: '09:00',
            dueEnd: '10:00',
            seriesId: series,
            startedAt: null,
            completedAt: null,
            position: 'a0',
            checklist: [{ id: item, title: 'Fill', completedAt: null, position: 'a0' }],
          },
        ],
      },
    ],
    series: [{ id: series, listId: list, rule: 'FREQ=DAILY', anchor: '2026-11-01' }],
  };
};
const goodBoard = () => {
  const [board, list, card, label, item] = [id(), id(), id(), id(), id()];
  return {
    id: board,
    name: 'Roadmap',
    color: '#2563eb',
    description: null,
    visibility: 'public',
    archived: false,
    lists: [
      {
        id: list,
        name: 'Doing',
        position: 'a0',
        cards: [
          {
            id: card,
            title: 'Ship',
            description: '',
            dueDate: null,
            dueTime: null,
            position: 'a0',
            archived: false,
            labels: [label],
            assignees: [{ name: 'Ana', email: 'ana@example.com' }],
            checklist: [{ id: item, title: 'tag', completedAt: 5, position: 'a0' }],
            comments: [
              {
                author: { name: 'Ana', email: 'ana@example.com' },
                body: 'hi',
                createdAt: '2026-11-06T09:00:00.000Z',
                editedAt: null,
              },
            ],
          },
        ],
      },
    ],
    labels: [{ id: label, name: 'Bug', color: '#dc2626' }],
    activity: [
      {
        kind: 'card.created',
        actor: { name: 'Ana', email: 'ana@example.com' },
        cardId: card,
        details: { title: 'Ship' },
        createdAt: '2026-11-06T09:00:00.000Z',
      },
    ],
  };
};
const at = new Date('2026-11-06T09:00:00Z');
const everything = () =>
  JSON.parse(
    serialise(
      envelope(
        'everything',
        {
          desk: goodDesk() as never,
          workspaces: [
            {
              id: id(),
              name: 'Acme',
              people: [{ name: 'Ana', email: 'ana@example.com', role: 'owner' }],
              boards: [goodBoard() as never],
            },
          ],
        },
        at,
      ),
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file is a tree of unknown shape that each case edits by path
  ) as Record<string, any>;

const read = (value: unknown) =>
  validateFile(typeof value === 'string' ? value : JSON.stringify(value));

describe('a good file', () => {
  it('is read whole, whatever its scope, and equals what was written', () => {
    const file = everything();
    const result = read(file);
    expect(result.ok).toBe(true);
    expect(result.ok && result.file).toEqual(file);
    for (const scope of ['desk', 'board', 'workspace'] as const) {
      const one: Record<string, unknown> = {
        format: 'tusk',
        version: 1,
        exportedAt: at.toISOString(),
        scope,
      };
      if (scope === 'desk') one.desk = goodDesk();
      if (scope === 'board') one.board = goodBoard();
      if (scope === 'workspace')
        one.workspace = { id: id(), name: 'W', people: [], boards: [goodBoard()] };
      expect(read(one).ok, scope).toBe(true);
    }
  });

  it('is trimmed where a title or a name is, and keeps a description as written', () => {
    const file = everything();
    file.desk.lists[0].title = '  Home  ';
    file.desk.lists[0].cards[0].description = '  keep\nthis  ';
    file.workspaces[0].boards[0].name = ' Roadmap ';
    const result = read(file);
    expect(result.ok && result.file.desk?.lists[0]?.title).toBe('Home');
    expect(result.ok && result.file.desk?.lists[0]?.cards[0]?.description).toBe('  keep\nthis  ');
    expect(result.ok && result.file.workspaces?.[0]?.boards[0]?.name).toBe('Roadmap');
  });

  it('says what it holds, in the words the person is asked in', () => {
    const result = read(everything());
    if (!result.ok) throw new Error('refused');
    expect(summarise(result.file)).toEqual({
      desk: { lists: 1, cards: 1 },
      workspaces: 1,
      boards: 1,
      cards: 1,
      people: 1,
    });
    expect(describeSummary(summarise(result.file))).toBe(
      'your Desk: 1 list, 1 card; 1 workspace, 1 board, 1 card',
    );
    const empty = { desk: null, workspaces: 2, boards: 4, cards: 312, people: 0 };
    expect(describeSummary(empty)).toBe('2 workspaces, 4 boards, 312 cards');
  });
});

/** Each is a good file broken in one way: the error says where, and the file is refused. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a file is a tree of unknown shape that each case edits by path
const MALFORMED: [string, (f: Record<string, any>) => void, RegExp][] = [
  ['another format', (f) => (f.format = 'ical'), /^format:/],
  ['a newer version', (f) => (f.version = 2), /^version: made by a newer Tusk/],
  ['an older or odd version', (f) => (f.version = 'one'), /^version:/],
  ['an unknown scope', (f) => (f.scope = 'galaxy'), /^file\.scope/],
  ['no time of export', (f) => delete f.exportedAt, /^file\.exportedAt/],
  ['a list with no title', (f) => (f.desk.lists[0].title = ''), /^desk\.lists\[0\]\.title/],
  [
    'a title over the limit',
    (f) => (f.desk.lists[0].cards[0].title = 'x'.repeat(LIMITS.titleChars + 1)),
    /^desk\.lists\[0\]\.cards\[0\]\.title/,
  ],
  [
    'a description over the limit',
    (f) => (f.desk.lists[0].cards[0].description = 'x'.repeat(LIMITS.descriptionChars + 1)),
    /description/,
  ],
  ['a colour that is not one', (f) => (f.desk.lists[0].color = 'red'), /^desk\.lists\[0\]\.color/],
  ['a sort that is not one', (f) => (f.desk.lists[0].sort = 'random'), /\.sort/],
  ['a position that is not one', (f) => (f.desk.lists[0].position = 'a 0'), /\.position/],
  ['a date that is not one', (f) => (f.desk.lists[0].cards[0].dueDate = '2026-02-30'), /\.dueDate/],
  [
    'a time with no date',
    (f) => (
      (f.desk.lists[0].cards[0].dueDate = null),
      (f.desk.lists[0].cards[0].dueTime = '09:00')
    ),
    /a time with no date/,
  ],
  ['a time of 25:00', (f) => (f.desk.lists[0].cards[0].dueTime = '25:00'), /\.dueTime/],
  ['an end that is not a time', (f) => (f.desk.lists[0].cards[0].dueEnd = '9'), /\.dueEnd/],
  [
    'an end that is not after the time',
    (f) => (f.desk.lists[0].cards[0].dueEnd = '09:00'),
    /\.dueEnd: an end needs a time, and is after it/,
  ],
  [
    'an end with no time',
    (f) => ((f.desk.lists[0].cards[0].dueTime = null), (f.desk.lists[0].cards[0].dueEnd = '10:00')),
    /\.dueEnd/,
  ],
  [
    'a completion that is not a time',
    (f) => (f.desk.lists[0].cards[0].completedAt = 'yesterday'),
    /\.completedAt/,
  ],
  ['a negative start', (f) => (f.desk.lists[0].cards[0].startedAt = -1), /\.startedAt/],
  [
    'a card of a series that is not in the file',
    (f) => (f.desk.lists[0].cards[0].seriesId = id()),
    /a series that is not in the file/,
  ],
  [
    'a series of a list that is not in the file',
    (f) => (f.desk.series[0].listId = id()),
    /a list that is not in the file/,
  ],
  ['a rule parseRule refuses', (f) => (f.desk.series[0].rule = 'FREQ=HOURLY'), /not a repeat rule/],
  [
    'a rule with a DTSTART',
    (f) => (f.desk.series[0].rule = 'DTSTART=20261106;FREQ=DAILY'),
    /not a repeat rule/,
  ],
  ['an anchor that is not a date', (f) => (f.desk.series[0].anchor = 'soon'), /\.anchor/],
  ['an id that is not one', (f) => (f.desk.lists[0].id = '1234'), /\.id/],
  ['an id used twice', (f) => (f.desk.lists[0].cards[0].id = f.desk.lists[0].id), /used twice/],
  ['a series id used twice', (f) => f.desk.series.push({ ...f.desk.series[0] }), /used twice/],
  [
    'a checklist over its limit',
    (f) =>
      (f.desk.lists[0].cards[0].checklist = Array.from(
        { length: WORKSPACE_LIMITS.itemsPerCard + 1 },
        (_, i) => ({ id: `${i}`, title: 'x', completedAt: null, position: 'a0' }),
      )),
    /more than 200/,
  ],
  [
    'more lists than an account may have',
    (f) => (f.desk.lists = Array.from({ length: LIMITS.listsPerAccount + 1 }, () => ({}))),
    /more than 200/,
  ],
  ['a list that is not a list', (f) => (f.desk.lists = 'none'), /not a list/],
  ['a card that is not an object', (f) => (f.desk.lists[0].cards = [5]), /not an object/],
  ['a title with a NUL', (f) => (f.desk.lists[0].title = 'a\u0000b'), /not allowed/],
  [
    'a label from another board',
    (f) => (f.workspaces[0].boards[0].lists[0].cards[0].labels = [id()]),
    /a label that is not on this board/,
  ],
  [
    'a label name over its limit',
    (f) =>
      (f.workspaces[0].boards[0].labels[0].name = 'x'.repeat(WORKSPACE_LIMITS.labelNameChars + 1)),
    /labels\[0\]\.name/,
  ],
  [
    'more labels than a board may have',
    (f) =>
      (f.workspaces[0].boards[0].labels = Array.from(
        { length: WORKSPACE_LIMITS.labelsPerBoard + 1 },
        () => ({}),
      )),
    /more than 50/,
  ],
  [
    'a visibility that is not one',
    (f) => (f.workspaces[0].boards[0].visibility = 'secret'),
    /\.visibility/,
  ],
  ['a board name that is empty', (f) => (f.workspaces[0].boards[0].name = ' '), /\.name/],
  ['a board colour that is not one', (f) => (f.workspaces[0].boards[0].color = '#fff'), /\.color/],
  [
    'a comment over its limit',
    (f) =>
      (f.workspaces[0].boards[0].lists[0].cards[0].comments[0].body = 'x'.repeat(
        WORKSPACE_LIMITS.commentChars + 1,
      )),
    /\.body/,
  ],
  [
    'an assignee that is not a person',
    (f) => (f.workspaces[0].boards[0].lists[0].cards[0].assignees = ['ana']),
    /not an object/,
  ],
  ['a role that is not one', (f) => (f.workspaces[0].people[0].role = 'king'), /\.role/],
  [
    'more boards than a workspace may have',
    (f) =>
      (f.workspaces[0].boards = Array.from(
        { length: WORKSPACE_LIMITS.boardsPerWorkspace + 1 },
        () => ({}),
      )),
    /more than 500/,
  ],
  [
    'more workspaces than an account may have',
    (f) =>
      (f.workspaces = Array.from(
        { length: WORKSPACE_LIMITS.workspacesPerAccount + 1 },
        () => ({}),
      )),
    /more than 50/,
  ],
  ['no workspaces in "everything"', (f) => delete f.workspaces, /^workspaces: not a list/],
];

describe('a file that is not good', () => {
  for (const [what, break_, where] of MALFORMED) {
    it(`is refused with the place named, for ${what}`, () => {
      const file = everything();
      break_(file);
      const result = read(file);
      expect(result.ok, what).toBe(false);
      expect(!result.ok && result.error, what).toMatch(where);
    });
  }

  it('is refused for text that is not JSON, JSON that is not a file, and a part the scope needs that is missing', () => {
    expect(read('{ not json')).toEqual({ ok: false, error: 'the file is not JSON' });
    expect(read('')).toEqual({ ok: false, error: 'the file is not JSON' });
    expect(read('[]')).toEqual({ ok: false, error: 'file: not an object' });
    expect(read('7')).toEqual({ ok: false, error: 'file: not an object' });
    expect(read('null')).toEqual({ ok: false, error: 'file: not an object' });
    for (const scope of ['desk', 'board', 'workspace']) {
      const result = read({ format: 'tusk', version: 1, exportedAt: at.toISOString(), scope });
      expect(result.ok, scope).toBe(false);
    }
  });

  it('is refused at over 50 MB, before it is read at all', () => {
    const big = ' '.repeat(MAX_FILE_BYTES + 1);
    const result = validateFile(big);
    expect(result).toEqual({ ok: false, error: 'the file is over 50 MB' });
    // The limit itself is a file of that size, and is read (it is not JSON here, which is another refusal).
    expect(validateFile(' '.repeat(MAX_FILE_BYTES))).toEqual({
      ok: false,
      error: 'the file is not JSON',
    });
  });

  it('refuses more cards than an account may have, and more than a board may', () => {
    const file = everything();
    file.desk.lists[0].cards = Array.from(
      { length: LIMITS.cardsPerAccount + 1 },
      () => file.desk.lists[0].cards[0],
    );
    expect(read(file).ok).toBe(false);
    const board = everything();
    const card = board.workspaces[0].boards[0].lists[0].cards[0];
    board.workspaces[0].boards[0].lists[0].cards = Array.from(
      { length: WORKSPACE_LIMITS.cardsPerBoard + 1 },
      () => card,
    );
    expect(read(board).ok).toBe(false);
  });

  it('says where, and never what: a hostile value is not in the reason', () => {
    const file = everything();
    file.desk.lists[0].cards[0].dueDate = '<script>alert("ATTACK-TOKEN")</script>';
    const result = read(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain('ATTACK-TOKEN');
    expect(!result.ok && result.error).not.toContain('script');
  });
});

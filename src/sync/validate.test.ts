import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../db/schema/sqlite';

const sqliteTable = (name: SyncTable) =>
  ({
    desk_list: schema.deskList,
    desk_card: schema.deskCard,
    desk_check: schema.deskCheck,
    desk_series: schema.deskSeries,
  })[name];
import {
  FIELD_NAMES,
  LIMITS,
  type Mutation,
  REQUIRED_FIELDS_ON_CREATE,
  REQUIRED_ON_CREATE,
  STRUCTURE,
  type StoredFields,
  type SyncTable,
  TABLES,
  encodeFields,
} from './format';
import { decodeFields, parseField, parseMutation, parseStructure } from './validate';

const ID = () => crypto.randomUUID();
const CIPHER = 'YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0-IFgyNTUxOSBhYmM';

/** One value that is right for every field there is. A field with no sample fails the first test, so a field cannot be added without its rule. */
const SAMPLE: Record<SyncTable, Record<string, unknown>> = {
  desk_list: { title: 'Home', color: '#16a34a', sort: 'due', showCompleted: true },
  desk_card: {
    title: 'Water the plants',
    description: 'Twice if it is hot.\nNot the cactus.',
    starred: false,
    dueDate: '2026-11-05',
    dueTime: '09:30',
    seriesId: ID(),
    startedAt: 1_792_000_000_000,
    completedAt: 1_793_000_000_000,
  },
  desk_check: { title: 'The fern', completedAt: 1_793_000_000_000 },
  desk_series: { rule: 'FREQ=WEEKLY;BYDAY=MO,WE', anchor: '2026-11-02' },
};

const card = (extra: Record<string, unknown> = {}) => ({
  table: 'desk_card',
  id: ID(),
  listId: ID(),
  position: 'a1',
  fields: { title: { v: 'Buy milk' } },
  ...extra,
});

const mutation = (changes: unknown[] = [card()]) => ({ mutationId: ID(), changes });

describe('the fields', () => {
  it('have a rule each, and a plain sample that passes it, in step with the format', () => {
    for (const table of TABLES) {
      expect(Object.keys(SAMPLE[table]).sort(), table).toEqual([...FIELD_NAMES[table]].sort());
      for (const name of FIELD_NAMES[table]) {
        expect(parseField(table, name, { v: SAMPLE[table][name] }).ok, `${table}.${name}`).toBe(
          true,
        );
      }
    }
  });

  it('refuse a name that is not a field of the table, including what an object inherits', () => {
    for (const name of [
      '',
      'ownerId',
      'seq',
      'rule',
      'toString',
      '__proto__',
      'constructor',
      'hasOwnProperty',
    ]) {
      expect(parseField('desk_card', name, { v: 'x' }).ok, name).toBe(false);
    }
    expect(parseField('desk_list', 'description', { v: 'x' }).ok).toBe(false);
  });

  it('refuse a wrong value for each field, plain', () => {
    const wrong: [SyncTable, string, unknown][] = [
      ['desk_list', 'title', ''],
      ['desk_list', 'title', 'a'.repeat(LIMITS.titleChars + 1)],
      ['desk_list', 'color', 'purple'],
      ['desk_list', 'sort', 'random'],
      ['desk_list', 'showCompleted', 'yes'],
      ['desk_card', 'title', ''],
      ['desk_card', 'title', 5],
      ['desk_card', 'title', 'has\u0000nul'],
      ['desk_card', 'description', 'a'.repeat(LIMITS.descriptionChars + 1)],
      ['desk_card', 'starred', 1],
      ['desk_card', 'dueDate', '2026-02-30'],
      ['desk_card', 'dueDate', '5 November'],
      ['desk_card', 'dueTime', '24:00'],
      ['desk_card', 'seriesId', 'not-an-id'],
      ['desk_card', 'completedAt', -1],
      ['desk_card', 'completedAt', 1.5],
      ['desk_card', 'completedAt', '1793000000000'],
      ['desk_card', 'completedAt', Number.MAX_SAFE_INTEGER],
      ['desk_card', 'startedAt', Number.NaN],
      ['desk_check', 'title', ''],
      ['desk_check', 'completedAt', 'yes'],
      ['desk_series', 'rule', ''],
      ['desk_series', 'rule', 'F'.repeat(LIMITS.ruleChars + 1)],
      ['desk_series', 'anchor', 'tomorrow'],
    ];
    for (const [table, name, value] of wrong) {
      expect(
        parseField(table, name, { v: value }).ok,
        `${table}.${name} = ${String(value).slice(0, 20)}`,
      ).toBe(false);
    }
  });

  it('take null where the field may be empty, and not where it may not', () => {
    for (const name of ['dueDate', 'dueTime', 'seriesId', 'startedAt', 'completedAt']) {
      expect(parseField('desk_card', name, { v: null }).ok, name).toBe(true);
    }
    for (const name of ['title', 'description', 'starred'])
      expect(parseField('desk_card', name, { v: null }).ok, name).toBe(false);
  });

  it('are plain or ciphertext and nothing else', () => {
    for (const value of [
      {},
      { v: 'x', c: CIPHER },
      { c: CIPHER, extra: 1 },
      { x: 'y' },
      { v: { nested: true } },
      { v: ['a'] },
      { v: undefined },
      { c: 5 },
      { c: '' },
      { c: 'not base64 at all!' },
      { c: CIPHER, v: 'x' },
      'plain',
      null,
      [],
      7,
    ]) {
      expect(parseField('desk_card', 'title', value).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it('hold ciphertext to a size by the field it is for, which is more than the text and not unbounded', () => {
    const title = LIMITS.titleChars;
    const longest = Math.ceil(((title * 4 + 256) * 4) / 3);
    expect(parseField('desk_card', 'title', { c: 'A'.repeat(longest) }).ok).toBe(true);
    expect(parseField('desk_card', 'title', { c: 'A'.repeat(longest + 1) }).ok).toBe(false);
    // The same bytes in a field that is a flag are far too many.
    expect(parseField('desk_card', 'starred', { c: 'A'.repeat(longest) }).ok).toBe(false);
    // Notes are the largest field, and ciphertext of the longest description fits.
    expect(parseField('desk_card', 'description', { c: 'A'.repeat(100_000) }).ok).toBe(true);
    expect(parseField('desk_card', 'description', { c: 'A'.repeat(200_000) }).ok).toBe(false);
  });

  it('do not check the content of ciphertext, since nothing of it can be known', () => {
    expect(parseField('desk_card', 'dueDate', { c: CIPHER }).ok).toBe(true);
    expect(parseField('desk_list', 'color', { c: CIPHER }).ok).toBe(true);
  });
});

describe('a change', () => {
  it('is accepted whole, and what comes back is the same, plain and ciphertext alike', () => {
    for (const change of [
      card(),
      card({ fields: { title: { c: CIPHER }, description: { c: CIPHER } } }),
      {
        table: 'desk_check',
        id: ID(),
        cardId: ID(),
        position: 'a0',
        fields: { title: { v: 'The fern' }, completedAt: { v: null } },
      },
      {
        table: 'desk_list',
        id: ID(),
        position: 'Zz',
        fields: { title: { v: 'Home' }, color: { v: '#2563eb' } },
      },
      {
        table: 'desk_series',
        id: ID(),
        listId: ID(),
        fields: { rule: { c: CIPHER }, anchor: { v: '2026-11-02' } },
      },
      { table: 'desk_card', id: ID(), deleted: true },
      { table: 'desk_card', id: ID(), deleted: false },
      { table: 'desk_check', id: ID(), cardId: ID() },
    ]) {
      const parsed = parseStructure(change);
      expect(parsed.ok, JSON.stringify(change)).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual(change);
    }
  });

  it('is refused for every shape that is not one', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'card',
      42,
      [],
      {},
      { table: 'desk_card' },
      { id: ID() },
      { table: 'notes', id: ID(), deleted: true },
      { table: 'DESK_CARD', id: ID(), deleted: true },
      { table: ['desk_card'], id: ID(), deleted: true },
      { table: 'desk_card', id: 'abc', deleted: true },
      { table: 'desk_card', id: ID().toUpperCase(), deleted: true },
      { table: 'desk_card', id: ID(), deleted: 'yes' },
      { table: 'desk_card', id: ID(), listId: 'nope' },
      { table: 'desk_check', id: ID(), cardId: 'nope' },
      { table: 'desk_card', id: ID(), parentId: ID() }, // a card has no parent: an item is a row of its own
      { table: 'desk_card', id: ID(), position: '' },
      { table: 'desk_card', id: ID(), position: 'has space' },
      { table: 'desk_card', id: ID(), position: 'é' },
      { table: 'desk_card', id: ID(), position: 'a'.repeat(LIMITS.positionChars + 1) },
      { table: 'desk_card', id: ID(), position: 5 },
      { table: 'desk_card', id: ID(), fields: [] },
      { table: 'desk_card', id: ID(), fields: 'title' },
      { table: 'desk_card', id: ID(), fields: { nosuch: { v: 1 } } },
      { table: 'desk_card', id: ID(), fields: { title: 'Buy milk' } },
      { table: 'desk_card', id: ID(), fields: {} }, // nothing changes
      { table: 'desk_list', id: ID() }, // nothing changes
      { table: 'desk_list', id: ID(), listId: ID() }, // a list has no list
      { table: 'desk_series', id: ID(), cardId: ID() }, // nor a series a card
      { table: 'desk_check', id: ID(), listId: ID() }, // nor an item a list: it is where its card is
      { table: 'desk_check', id: ID(), fields: { starred: { v: true } } }, // nor a star
      { table: 'desk_series', id: ID(), position: 'a1' },
    ];
    for (const change of bad) expect(parseStructure(change).ok, JSON.stringify(change)).toBe(false);
  });

  it('refuses a device that names an owner, an order, a time, or a key of its own, rather than ignoring it', () => {
    const base = { table: 'desk_card', id: ID(), deleted: false };
    expect(parseStructure(base).ok).toBe(true);
    for (const extra of [
      { ownerId: ID() },
      { owner_id: ID() },
      { seq: 1 },
      { createdAt: 1 },
      { deletedAt: 1 },
      { reminderSentAt: 1 },
      { dueDate: '2026-11-05' }, // a mirror column: the server fills it, from the field
      { s: 5 },
      { constructor: 'x' },
    ]) {
      expect(parseStructure({ ...base, ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
    // A key that JSON can make and an object literal cannot: an own property named `__proto__` is seen, and refused, and pollutes nothing.
    const hostile = JSON.parse(
      `{"table":"desk_card","id":"${ID()}","deleted":true,"__proto__":{"ownerId":"x"}}`,
    );
    expect(parseStructure(hostile).ok).toBe(false);
    expect(({} as Record<string, unknown>).ownerId).toBeUndefined();
  });

  it('is refused when an item says something an item does not have: a date, a time, a star or a repeat', () => {
    const item = (fields: Record<string, unknown>) => ({
      table: 'desk_check',
      id: ID(),
      cardId: ID(),
      position: 'a0',
      fields: { title: { v: 'x' }, ...fields },
    });
    for (const fields of [
      { dueDate: { v: '2026-11-05' } },
      { dueTime: { v: '09:00' } },
      { starred: { v: true } },
      { seriesId: { v: ID() } },
      { description: { v: 'n' } },
    ]) {
      expect(parseStructure(item(fields)).ok, JSON.stringify(fields)).toBe(false);
    }
    for (const fields of [{}, { completedAt: { v: null } }, { completedAt: { c: CIPHER } }]) {
      expect(parseStructure(item(fields)).ok, JSON.stringify(fields)).toBe(true);
    }
    // A card may have all of them.
    expect(
      parseStructure({
        table: 'desk_card',
        id: ID(),
        listId: ID(),
        position: 'a0',
        fields: { title: { v: 'x' }, dueDate: { v: '2026-11-05' }, starred: { v: true } },
      }).ok,
    ).toBe(true);
  });

  it('refuses a new item that does not say which card it is of, or what it is called', () => {
    expect(
      parseStructure(
        { table: 'desk_check', id: ID(), position: 'a0', fields: { title: { v: 'x' } } },
        { creating: true },
      ).ok,
    ).toBe(false);
    expect(
      parseStructure(
        { table: 'desk_check', id: ID(), cardId: ID(), position: 'a0' },
        { creating: true },
      ).ok,
    ).toBe(false);
  });

  it('is rebuilt from what it was allowed to say, so that nothing else rides along', () => {
    const input = card();
    const parsed = parseStructure(input);
    expect(parsed.ok && parsed.value).not.toBe(input);
    expect(parsed.ok && parsed.value.fields).not.toBe(input.fields);
  });

  describe('that makes a row', () => {
    it('needs what its table cannot do without, and says which', () => {
      for (const table of TABLES) {
        const whole: Record<string, unknown> = { table, id: ID() };
        for (const key of REQUIRED_ON_CREATE[table]) whole[key] = key === 'position' ? 'a0' : ID();
        const fields: Record<string, unknown> = {};
        for (const name of REQUIRED_FIELDS_ON_CREATE[table])
          fields[name] = { v: SAMPLE[table][name] };
        whole.fields = fields;
        expect(parseStructure(whole, { creating: true }).ok, table).toBe(true);

        for (const key of REQUIRED_ON_CREATE[table]) {
          const { [key]: _gone, ...without } = whole;
          expect(parseStructure(without, { creating: true }).ok, `${table} without ${key}`).toBe(
            false,
          );
        }
        for (const name of REQUIRED_FIELDS_ON_CREATE[table]) {
          const { [name]: _gone, ...rest } = fields;
          const reduced = { ...whole, fields: rest };
          expect(parseStructure(reduced, { creating: true }).ok, `${table} without ${name}`).toBe(
            false,
          );
        }
      }
    });

    it('is a card with a list and a place and a title', () => {
      expect(parseStructure(card(), { creating: true }).ok).toBe(true);
    });

    it('is not asked for it when the row already exists, so an update may say less', () => {
      expect(
        parseStructure({ table: 'desk_card', id: ID(), fields: { starred: { v: true } } }).ok,
      ).toBe(true);
      expect(
        parseStructure(
          { table: 'desk_card', id: ID(), fields: { starred: { v: true } } },
          { creating: true },
        ).ok,
      ).toBe(false);
    });
  });

  describe('on an account with a key of its own', () => {
    it('takes ciphertext and structure, and turns every plain field away', () => {
      const sealed = card({ fields: { title: { c: CIPHER }, starred: { c: CIPHER } } });
      expect(parseStructure(sealed, { plain: 'refuse' }).ok).toBe(true);
      expect(parseStructure(card(), { plain: 'refuse' }).ok).toBe(false);
      expect(
        parseStructure(card({ fields: { title: { c: CIPHER }, description: { v: 'leak' } } }), {
          plain: 'refuse',
        }).ok,
      ).toBe(false);
      // Structure alone, with no field at all, is fine: moving or deleting a card is no secret.
      expect(
        parseStructure({ table: 'desk_card', id: ID(), deleted: true }, { plain: 'refuse' }).ok,
      ).toBe(true);
    });

    it('does not read what it turns away: a plain value of the wrong kind is refused either way', () => {
      expect(
        parseStructure(card({ fields: { title: { v: { nested: 1 } } } }), { plain: 'refuse' }).ok,
      ).toBe(false);
    });
  });

  it('never repeats the input in why it was refused', () => {
    const secret = 'hunter2-the-secret-title';
    for (const change of [
      { table: secret, id: ID(), deleted: true },
      { table: 'desk_card', id: secret, deleted: true },
      { table: 'desk_card', id: ID(), [secret]: 1 },
      { table: 'desk_card', id: ID(), fields: { [secret]: { v: 1 } } },
      { table: 'desk_card', id: ID(), fields: { title: { v: secret + 'x'.repeat(2000) } } },
      { table: 'desk_card', id: ID(), fields: { dueDate: { v: secret } } },
      { table: 'desk_card', id: ID(), position: secret + ' ' },
    ]) {
      const parsed = parseStructure(change);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).not.toContain(secret);
    }
  });

  it('agrees with the tables on which columns are structural', () => {
    const columnsOf = (table: SyncTable) =>
      getTableConfig(sqliteTable(table)).columns.map((column) => column.name);
    const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    for (const table of TABLES) {
      const columns = columnsOf(table);
      for (const key of STRUCTURE[table]) expect(columns, `${table}.${key}`).toContain(snake(key));
      // What a device may not set is a column the server keeps for itself.
      for (const own of ['owner_id', 'seq', 'created_at', 'deleted_at'])
        expect(columns, `${table}.${own}`).toContain(own);
      expect(columns, `${table}.fields`).toContain('fields');
    }
  });
});

describe('a mutation', () => {
  it('is accepted whole, and a round trip through JSON gives back the same, plain and ciphertext alike', () => {
    const parent = ID();
    const whole = {
      mutationId: ID(),
      changes: [
        card({
          id: parent,
          fields: { title: { v: 'Plan the trip' }, dueDate: { v: '2026-12-01' } },
        }),
        {
          table: 'desk_check',
          id: ID(),
          cardId: parent,
          position: 'a1',
          fields: { title: { c: CIPHER } },
        },
        { table: 'desk_list', id: ID(), deleted: true },
        {
          table: 'desk_series',
          id: ID(),
          listId: ID(),
          fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-11-05' } },
        },
      ],
    };
    const parsed = parseMutation(JSON.parse(JSON.stringify(whole)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual(whole);
      // And once more, from what came back.
      expect(parseMutation(JSON.parse(JSON.stringify(parsed.value)))).toEqual(parsed);
    }
  });

  it('keeps the order of its changes, which is the order they apply in', () => {
    const changes = Array.from({ length: 20 }, () => card());
    const parsed = parseMutation(mutation(changes));
    expect(parsed.ok && (parsed.value as Mutation).changes.map((c) => c.id)).toEqual(
      changes.map((c) => c.id),
    );
  });

  it('is refused for every shape that is not one', () => {
    const bad: unknown[] = [
      null,
      [],
      'm',
      {},
      { mutationId: ID() },
      { changes: [card()] },
      { mutationId: 'abc', changes: [card()] },
      { mutationId: ID(), changes: [] },
      { mutationId: ID(), changes: 'task' },
      { mutationId: ID(), changes: [card(), 5] },
      { mutationId: ID(), changes: [card(), { table: 'desk_card', id: 'bad', deleted: true }] },
      { mutationId: ID(), changes: [card()], protocol: 1 },
      { mutationId: ID(), changes: [card()], ownerId: ID() },
    ];
    for (const value of bad)
      expect(parseMutation(value).ok, JSON.stringify(value)?.slice(0, 80)).toBe(false);
  });

  it('is refused whole for one bad change, since half of an action is a state no action made', () => {
    const parsed = parseMutation(mutation([card(), card(), card({ listId: 'bad' })]));
    expect(parsed.ok).toBe(false);
  });

  it('takes 500 changes and not 501', () => {
    const many = (n: number) =>
      mutation(Array.from({ length: n }, () => ({ table: 'desk_card', id: ID(), deleted: true })));
    expect(parseMutation(many(LIMITS.changes)).ok).toBe(true);
    expect(parseMutation(many(LIMITS.changes + 1)).ok).toBe(false);
  });

  it('is held to a size, by what its fields say, whatever they say it in', () => {
    const description = 'n'.repeat(LIMITS.descriptionChars);
    const withNotes = (count: number) =>
      mutation(
        Array.from({ length: count }, () =>
          card({ fields: { title: { v: 't' }, description: { v: description } } }),
        ),
      );
    // 20,000 characters of description each: 40 fit in a million, 60 do not.
    expect(parseMutation(withNotes(40)).ok).toBe(true);
    expect(parseMutation(withNotes(60)).ok).toBe(false);

    const sealed = (count: number) =>
      mutation(
        Array.from({ length: count }, () => card({ fields: { title: { c: 'A'.repeat(3000) } } })),
      );
    expect(parseMutation(sealed(300)).ok).toBe(true);
    expect(parseMutation(sealed(400)).ok).toBe(false);
  });

  it('takes the account’s mode through to every change', () => {
    expect(parseMutation(mutation([card()]), { plain: 'refuse' }).ok).toBe(false);
    expect(
      parseMutation(mutation([card({ fields: { title: { c: CIPHER } } })]), { plain: 'refuse' }).ok,
    ).toBe(true);
  });
});

describe('the fields of a row, as stored', () => {
  it('come back as they went in, plain and ciphertext alike, with the seq that wrote each', () => {
    const stored: StoredFields = {
      title: { v: 'Water the plants', s: 7 },
      description: { c: CIPHER, s: 9 },
      completedAt: { v: null, s: 12 },
      starred: { v: false, s: 3 },
      dueDate: { v: '2026-11-05', s: 4 },
      reviewedAt: { v: 1_793_000_000_000, s: 5 },
    };
    const decoded = decodeFields(encodeFields(stored));
    expect(decoded).toEqual({ ok: true, value: stored });
    expect(encodeFields(decoded.ok ? decoded.value : {})).toBe(encodeFields(stored));
    expect(decodeFields('{}')).toEqual({ ok: true, value: {} });
  });

  it('are refused when they are not that, so that a bad row cannot crash a pull', () => {
    for (const text of [
      '',
      'null',
      '[]',
      '"x"',
      '{',
      '{"title":"x"}',
      '{"title":{"v":"x"}}',
      '{"title":{"v":"x","s":-1}}',
      '{"title":{"v":"x","s":1.5}}',
      '{"title":{"v":"x","s":"1"}}',
      '{"title":{"v":"x","c":"y","s":1}}',
      '{"title":{"s":1}}',
      '{"title":{"c":5,"s":1}}',
      '{"title":{"v":{"a":1},"s":1}}',
      '{"title":{"v":"x","s":1,"extra":true}}',
    ]) {
      expect(decodeFields(text).ok, text).toBe(false);
    }
  });
});

describe('a due time', () => {
  const card = (fields: Record<string, unknown>) => ({
    table: 'desk_card',
    id: crypto.randomUUID(),
    fields,
  });

  it('comes with a date, in the same change: no time without a date', () => {
    expect(parseStructure(card({ dueDate: { v: '2026-11-07' }, dueTime: { v: '09:30' } })).ok).toBe(
      true,
    );
    expect(parseStructure(card({ dueDate: { v: null }, dueTime: { v: null } })).ok).toBe(true);
    expect(parseStructure(card({ dueDate: { v: '2026-11-07' } })).ok).toBe(true);
    // A date cleared with a time left, a time with no date said, and a time alone.
    expect(parseStructure(card({ dueDate: { v: null }, dueTime: { v: '09:30' } })).ok).toBe(false);
    expect(parseStructure(card({ dueTime: { v: '09:30' } })).ok).toBe(false);
    // A time that is cleared needs no date, and a sealed date is taken to be there.
    expect(parseStructure(card({ dueTime: { v: null } })).ok).toBe(true);
    expect(parseStructure(card({ dueDate: { c: 'YWdl' }, dueTime: { v: '09:30' } })).ok).toBe(true);
  });
});

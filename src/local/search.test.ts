import { describe, expect, it } from 'vitest';
import type { LocalRow } from './rows';
import { searchDesk, snippetOf, textOf } from './search';

/** Search on the Desk (DESIGN.md §10.7): by title, description and checklist item, folded, as text, and newest change first. */
let n = 0;
const card = (
  title: string,
  extra: {
    description?: string;
    seq?: number;
    created?: number;
    id?: string;
    fields?: object;
  } = {},
): LocalRow =>
  ({
    table: 'desk_card',
    id: extra.id ?? `c${++n}`,
    listId: 'l',
    position: 'a0',
    deletedAt: null,
    seq: extra.seq ?? 5,
    createdAt: extra.created ?? 1,
    fields: {
      title: { v: title, s: extra.seq ?? 5 },
      ...(extra.description !== undefined
        ? { description: { v: extra.description, s: extra.seq ?? 5 } }
        : {}),
      ...(extra.fields ?? {}),
    },
  }) as LocalRow;
const item = (cardId: string, title: string, seq = 5): LocalRow =>
  ({
    table: 'desk_check',
    id: `i${++n}`,
    cardId,
    position: 'a0',
    deletedAt: null,
    seq,
    createdAt: 1,
    fields: { title: { v: title, s: seq } },
  }) as LocalRow;
const titles = (hits: ReturnType<typeof searchDesk>) =>
  hits.map((hit) => textOf(hit.card, 'title'));

describe('searching the Desk', () => {
  it('finds a word in a title, a description or a checklist item, and nothing for nothing typed', () => {
    const a = card('Buy milk');
    const b = card('Plan', { description: 'Ask about the milk delivery' });
    const c = card('Shopping');
    const d = card('Unrelated');
    const hits = searchDesk([a, b, c, d], [item(c.id, 'oat milk')], 'milk');
    expect(titles(hits).sort()).toEqual(['Buy milk', 'Plan', 'Shopping']);
    expect(searchDesk([a], [], '')).toEqual([]);
    expect(searchDesk([a], [], '   ')).toEqual([]);
  });

  it('treats the query as text: % and the characters of a pattern match only themselves', () => {
    const cards = [
      card('Save 50% today'),
      card('Fifty percent'),
      card('a.b'),
      card('axb'),
      card('under_score'),
      card('underXscore'),
      card('star*'),
    ];
    for (const [query, expected] of [
      ['%', ['Save 50% today']],
      ['50%', ['Save 50% today']],
      ['.', ['a.b']],
      ['a.b', ['a.b']],
      ['_', ['under_score']],
      ['*', ['star*']],
      ['(', []],
      ['[a-z]', []],
      ['\\', []],
      ['^', []],
    ] as const)
      expect(titles(searchDesk(cards, [], query)), query).toEqual(expected);
  });

  it('folds case and accents: É finds é and e, and straße finds STRASSE', () => {
    const cafes = [card('un café'), card('CAFE'), card('Plain')];
    expect(titles(searchDesk(cafes, [], 'É')).sort()).toEqual(['CAFE', 'un café']);
    expect(titles(searchDesk(cafes, [], 'cafÉ')).sort()).toEqual(['CAFE', 'un café']);
    expect(titles(searchDesk(cafes, [], 'cafe')).sort()).toEqual(['CAFE', 'un café']);
    const strasse = [card('Straße'), card('Plain')];
    expect(titles(searchDesk(strasse, [], 'STRASSE'))).toEqual(['Straße']);
    expect(titles(searchDesk(strasse, [], 'strasse'))).toEqual(['Straße']);
    expect(titles(searchDesk(strasse, [], 'straße'))).toEqual(['Straße']);
  });

  it('wants every word, in any order and in any of the three: title, description and an item together', () => {
    const a = card('Holiday', { description: 'flights to Lisbon' });
    const b = card('Holiday');
    const items = [item(b.id, 'book hotel')];
    expect(titles(searchDesk([a, b], items, 'lisbon holiday'))).toEqual(['Holiday']);
    expect(searchDesk([a, b], items, 'holiday lisbon')[0]?.card.id).toBe(a.id);
    expect(titles(searchDesk([a, b], items, 'hotel holiday'))).toEqual(['Holiday']);
    expect(searchDesk([a, b], items, 'hotel holiday')[0]?.card.id).toBe(b.id);
    expect(searchDesk([a, b], items, 'lisbon hotel')).toEqual([]);
  });

  it('shows a checklist match under its card, and says where else the words were found', () => {
    const a = card('Shopping', { description: 'for the weekend: oat milk, bread and more' });
    const items = [item(a.id, 'oat milk'), item(a.id, 'bread'), item(a.id, 'Milk chocolate')];
    const [hit] = searchDesk([a], items, 'milk');
    expect(hit?.items.map((each) => textOf(each, 'title'))).toEqual(['oat milk', 'Milk chocolate']);
    expect(hit?.in).toEqual(['description']);
    expect(hit?.snippet).toContain('milk');
    const [byTitle] = searchDesk([a], items, 'shopping');
    expect(byTitle?.in).toEqual(['title']);
    expect(byTitle?.items).toEqual([]);
    expect(byTitle?.snippet).toBeNull();
  });

  it('puts the newest change first: by the latest stamp of the card or the item that matched, an unsent row first of all', () => {
    const old = card('milk old', { seq: 3, created: 9 });
    const mid = card('milk mid', { seq: 7, created: 1 });
    const viaItem = card('Shopping', { seq: 2, created: 1 });
    const unsent = card('milk new', { seq: 0, created: 1 });
    const hits = searchDesk([old, mid, viaItem, unsent], [item(viaItem.id, 'milk', 20)], 'milk');
    expect(titles(hits)).toEqual(['milk new', 'Shopping', 'milk mid', 'milk old']);
  });

  it('breaks a tie by when the card was made, then by id, so that the order is one order', () => {
    const [a, b, c] = [
      card('milk', { seq: 5, created: 2, id: 'b' }),
      card('milk', { seq: 5, created: 3, id: 'a' }),
      card('milk', { seq: 5, created: 2, id: 'a2' }),
    ];
    expect(searchDesk([a, b, c], [], 'milk').map((hit) => hit.card.id)).toEqual(['a', 'a2', 'b']);
    expect(searchDesk([c, b, a], [], 'milk').map((hit) => hit.card.id)).toEqual(['a', 'a2', 'b']);
  });

  it('reads a sealed field through open, and finds nothing in one it cannot open', () => {
    const sealed = card('x', { fields: { title: { c: 'SEALED-1', s: 5 } } });
    expect(searchDesk([sealed], [], 'secret')).toEqual([]);
    const opened = searchDesk([sealed], [], 'secret', (field) =>
      field.c === 'SEALED-1' ? 'My secret plan' : undefined,
    );
    expect(opened).toHaveLength(1);
    const unopenable = searchDesk([sealed], [], 'secret', () => undefined);
    expect(unopenable).toEqual([]);
  });

  it('cuts a long description to a piece around the words, with marks where it was cut', () => {
    const long = `${'lorem ipsum '.repeat(30)}the needle is here${' dolor sit amet'.repeat(30)}`;
    const piece = snippetOf(long, ['needle']);
    expect(piece).toContain('needle');
    expect(piece.length).toBeLessThanOrEqual(124);
    expect(piece.startsWith('…') && piece.endsWith('…')).toBe(true);
    expect(snippetOf('short text', ['text'])).toBe('short text');
    expect(snippetOf('a\n\n  b', ['b'])).toBe('a b');
  });

  it('searches ten thousand cards and their items without a visible delay', () => {
    const cards: LocalRow[] = [];
    const items: LocalRow[] = [];
    for (let i = 0; i < 10_000; i++) {
      const c = card(`Task ${i} café ${i % 7 === 0 ? 'needle' : 'hay'}`, {
        description: `Some words about task ${i}. `.repeat(8),
        seq: i + 1,
      });
      cards.push(c);
      items.push(item(c.id, `step one of ${i}`), item(c.id, `step two of ${i}`));
    }
    const started = performance.now();
    const hits = searchDesk(cards, items, 'NEEDLE cafe');
    const took = performance.now() - started;
    expect(hits).toHaveLength(Math.ceil(10_000 / 7));
    // A visible delay is about a tenth of a second; this leaves room for a slow machine and a busy test run.
    expect(took, `took ${took.toFixed(0)} ms`).toBeLessThan(600);
  });
});

import { describe, expect, it } from 'vitest';
import type { CardTile, LabelRow } from '../workspaces/format';
import { filterCards, fold, terms } from './filter';

/** Search on a board (DESIGN.md §14.5), with no screen. */
const card = (id: string, title: string, extra: Partial<CardTile> = {}): CardTile => ({
  id,
  boardId: 'b',
  listId: 'l',
  title,
  position: id,
  dueDate: null,
  dueTime: null,
  hasDescription: false,
  labels: [],
  assignees: [],
  checklist: { done: 0, total: 0 },
  comments: 0,
  ...extra,
});
const labels: LabelRow[] = [
  { id: 'urgent', boardId: 'b', name: 'Urgent', color: '#dc2626' },
  { id: 'blank', boardId: 'b', name: '', color: '#2563eb' },
];
const people = [
  { accountId: 'ana', name: 'Ana Sørensen' },
  { accountId: 'bo', name: 'Bo' },
];
const cards = [
  card('1', 'Fix login'),
  card('2', 'Écrire la spécification', { labels: ['urgent'] }),
  card('3', 'Pay the invoice', { assignees: ['ana'] }),
  card('4', 'Straße planen', { labels: ['blank'], assignees: ['ana', 'bo'] }),
];
const ids = (query: string) =>
  filterCards(cards, query, labels, people)
    .shown.map((c) => c.id)
    .join('');

describe('folding', () => {
  it('drops case and accents, and folds the letters that fold to two', () => {
    expect(fold('École')).toBe('ecole');
    expect(fold('É')).toBe(fold('é'));
    expect(fold('É')).toBe('e');
    expect(fold('STRASSE')).toBe(fold('straße'));
    expect(fold('Ørsted')).toBe('orsted');
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('ΟΔΥΣΣΕΥΣ')).toBe(fold('οδυσσευς'));
  });

  it('splits a query into folded words and ignores space', () => {
    expect(terms('  Fix   LOGIN ')).toEqual(['fix', 'login']);
    expect(terms('   ')).toEqual([]);
  });
});

describe('the cards that match', () => {
  it('shows every card for nothing typed, in the order given, and hides none', () => {
    const all = filterCards(cards, '  ', labels, people);
    expect(all.shown).toBe(cards);
    expect(all.hidden).toBe(0);
  });

  it('finds by title, with case and accents not deciding: É finds é and e', () => {
    expect(ids('LOGIN')).toBe('1');
    // "e" is in three of the four titles: the accent decides nothing.
    expect(ids('É')).toBe('234');
    expect(ids('écrire')).toBe('2');
    expect(ids('ecrire specification')).toBe('2');
    expect(ids('strasse')).toBe('4');
  });

  it('finds by label name and by assignee name, and a label with no name matches nothing by name', () => {
    expect(ids('urgent')).toBe('2');
    expect(ids('sorensen')).toBe('34');
    expect(ids('bo')).toBe('4');
    expect(ids('blank')).toBe('');
  });

  it('wants every word, in any order and from any of the three', () => {
    expect(ids('ana invoice')).toBe('3');
    expect(ids('invoice ana')).toBe('3');
    expect(ids('ana urgent')).toBe('');
    expect(ids('planen sorensen')).toBe('4');
  });

  it('says how many it hides, and does not change what it was given', () => {
    const copy = JSON.stringify(cards);
    const result = filterCards(cards, 'login', labels, people);
    expect(result).toMatchObject({ hidden: 3 });
    expect(JSON.stringify(cards)).toBe(copy);
  });

  it('puts every card back, each in its place, when the query is cleared', () => {
    const before = cards.map((c) => c.id);
    filterCards(cards, 'login', labels, people);
    expect(filterCards(cards, '', labels, people).shown.map((c) => c.id)).toEqual(before);
  });
});

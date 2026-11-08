import { describe as suite, expect, it } from 'vitest';
import { describe, type Details } from './describe';
import { ACTIVITY_KINDS, type ActivityKind } from './format';

/** The sentences of activity (DESIGN.md §15.6), with no screen and no database: each kind from the names its row kept. */
const person = (id: string) => (id === 'p1' ? 'Bo' : 'Deleted account');
const say = (kind: ActivityKind, details: Details = {}) => describe(kind, 'Ana', details, person);

suite('what happened, in words', () => {
  it('says what Ana did to what, for the kinds a card has', () => {
    expect(say('card.created', { title: 'Fix login', list: 'Backlog' })).toBe(
      'Ana added Fix login to Backlog',
    );
    expect(say('card.moved', { title: 'Fix login', from: 'Backlog', to: 'Doing' })).toBe(
      'Ana moved Fix login from Backlog to Doing',
    );
    expect(say('card.renamed', { from: 'Fix login', to: 'Fix sign-in' })).toBe(
      'Ana renamed Fix login to Fix sign-in',
    );
    expect(say('card.archived', { title: 'Fix login' })).toBe('Ana archived Fix login');
    expect(say('card.restored', { title: 'Fix login' })).toBe('Ana restored Fix login');
    expect(say('card.deleted', { title: 'Fix login' })).toBe('Ana deleted Fix login');
    expect(say('card.due_set', { title: 'Fix login', date: '2026-11-07', time: '09:30' })).toBe(
      'Ana set Fix login due 2026-11-07 at 09:30',
    );
    expect(
      say('card.due_set', { title: 'Fix login', date: '2026-11-07', time: '09:30', end: '10:15' }),
    ).toBe('Ana set Fix login due 2026-11-07 at 09:30 until 10:15');
    expect(say('card.due_set', { title: 'Fix login', date: '2026-11-07', time: null })).toBe(
      'Ana set Fix login due 2026-11-07',
    );
    expect(say('card.due_cleared', { title: 'Fix login' })).toBe(
      'Ana cleared the due date of Fix login',
    );
    expect(say('card.label_added', { title: 'Fix login', label: 'Urgent' })).toBe(
      'Ana put the label Urgent on Fix login',
    );
    expect(say('card.label_removed', { title: 'Fix login', label: 'Urgent' })).toBe(
      'Ana took the label Urgent off Fix login',
    );
    expect(say('card.item_added', { title: 'Fix login', item: 'Write test' })).toBe(
      'Ana added the item Write test to Fix login',
    );
    expect(say('card.item_ticked', { title: 'Fix login', item: 'Write test' })).toBe(
      'Ana ticked Write test on Fix login',
    );
    expect(say('card.commented', { title: 'Fix login' })).toBe('Ana commented on Fix login');
  });

  it('names the person it is about, and says Deleted account for one that is gone', () => {
    expect(say('card.assigned', { title: 'Fix login', person: 'p1' })).toBe(
      'Ana assigned Bo to Fix login',
    );
    expect(say('card.unassigned', { title: 'Fix login', person: 'p1' })).toBe(
      'Ana unassigned Bo from Fix login',
    );
    expect(say('card.assigned', { title: 'Fix login', person: 'gone' })).toBe(
      'Ana assigned Deleted account to Fix login',
    );
    expect(say('board.member_added', { person: 'p1' })).toBe('Ana added Bo to the board');
    expect(say('board.member_removed', { person: 'p1' })).toBe('Ana removed Bo from the board');
    expect(say('board.member_owner', { person: 'p1' })).toBe('Ana made Bo an owner of the board');
  });

  it('says what happened to a list and to the board', () => {
    expect(say('list.created', { name: 'Doing' })).toBe('Ana added the list Doing');
    expect(say('list.renamed', { from: 'Doing', to: 'In progress' })).toBe(
      'Ana renamed the list Doing to In progress',
    );
    expect(say('list.moved', { name: 'Doing' })).toBe('Ana moved the list Doing');
    expect(say('list.deleted', { name: 'Doing' })).toBe('Ana deleted the list Doing');
    expect(say('board.created', { name: 'Roadmap' })).toBe('Ana created the board Roadmap');
    expect(say('board.renamed', { from: 'Roadmap', to: 'Plans' })).toBe(
      'Ana renamed the board Roadmap to Plans',
    );
    expect(say('board.visibility', { visibility: 'private' })).toBe('Ana made the board private');
    expect(say('board.visibility', { visibility: 'public' })).toBe('Ana made the board public');
    expect(say('board.archived')).toBe('Ana archived the board');
    expect(say('board.restored')).toBe('Ana restored the board');
    expect(say('board.joined')).toBe('Ana joined the board');
    expect(say('board.left')).toBe('Ana left the board');
  });

  it('has a sentence for every kind there is, with none of its words left undefined, even when the row kept nothing', () => {
    for (const kind of ACTIVITY_KINDS) {
      const text = say(kind);
      expect(text, kind).toMatch(/^Ana /);
      expect(text, kind).not.toMatch(/undefined|null|\[object/);
      expect(text.length, kind).toBeGreaterThan(8);
    }
  });

  it('shows markup in a name as the words it is: the sentence is text', () => {
    expect(say('card.created', { title: '<img src=x onerror=alert(1)>', list: 'Backlog' })).toBe(
      'Ana added <img src=x onerror=alert(1)> to Backlog',
    );
  });
});

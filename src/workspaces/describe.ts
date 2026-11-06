import type { ActivityKind } from './format';

/**
 * What happened, in words (DESIGN.md §15.6): one sentence for each kind of activity, from the kind and the names its row kept as they were, so that it
 * reads the same after a card is renamed or deleted. Pure, and with no screen: "Ana moved Fix login from Backlog to Doing". A person named in the row is
 * an account id, read to a name by `person`, which says "Deleted account" for one that is gone.
 */
export interface Details {
  readonly title?: string;
  readonly from?: string;
  readonly to?: string;
  readonly list?: string;
  readonly name?: string;
  readonly label?: string;
  readonly item?: string;
  readonly person?: string;
  readonly visibility?: string;
  readonly date?: string;
  readonly time?: string | null;
}

/** The names a row needs, by account id: the actor's, and any person it names. */
export type Names = (accountId: string) => string;

const q = (text: string | undefined, fallback: string) => (text && text !== '' ? text : fallback);

export function describe(
  kind: ActivityKind,
  actor: string,
  details: Details,
  person: Names,
): string {
  const card = q(details.title, 'a card');
  const who = details.person ? person(details.person) : 'someone';
  switch (kind) {
    case 'card.created':
      return details.list ? `${actor} added ${card} to ${details.list}` : `${actor} added ${card}`;
    case 'card.renamed':
      return `${actor} renamed ${q(details.from, 'a card')} to ${q(details.to, 'a new title')}`;
    case 'card.moved':
      return `${actor} moved ${card} from ${q(details.from, 'a list')} to ${q(details.to, 'another list')}`;
    case 'card.archived':
      return `${actor} archived ${card}`;
    case 'card.restored':
      return `${actor} restored ${card}`;
    case 'card.deleted':
      return `${actor} deleted ${card}`;
    case 'card.due_set':
      return `${actor} set ${card} due ${details.date ?? ''}${details.time ? ` at ${details.time}` : ''}`.trimEnd();
    case 'card.due_cleared':
      return `${actor} cleared the due date of ${card}`;
    case 'card.label_added':
      return `${actor} put the label ${q(details.label, 'a label')} on ${card}`;
    case 'card.label_removed':
      return `${actor} took the label ${q(details.label, 'a label')} off ${card}`;
    case 'card.assigned':
      return `${actor} assigned ${who} to ${card}`;
    case 'card.unassigned':
      return `${actor} unassigned ${who} from ${card}`;
    case 'card.item_added':
      return `${actor} added the item ${q(details.item, 'an item')} to ${card}`;
    case 'card.item_ticked':
      return `${actor} ticked ${q(details.item, 'an item')} on ${card}`;
    case 'card.commented':
      return `${actor} commented on ${card}`;
    case 'list.created':
      return `${actor} added the list ${q(details.name, 'a list')}`;
    case 'list.renamed':
      return `${actor} renamed the list ${q(details.from, 'a list')} to ${q(details.to, 'a new name')}`;
    case 'list.moved':
      return `${actor} moved the list ${q(details.name, 'a list')}`;
    case 'list.deleted':
      return `${actor} deleted the list ${q(details.name, 'a list')}`;
    case 'board.created':
      return `${actor} created the board ${q(details.name, 'a board')}`;
    case 'board.renamed':
      return `${actor} renamed the board ${q(details.from, 'a board')} to ${q(details.to, 'a new name')}`;
    case 'board.visibility':
      return details.visibility === 'private'
        ? `${actor} made the board private`
        : `${actor} made the board public`;
    case 'board.archived':
      return `${actor} archived the board`;
    case 'board.restored':
      return `${actor} restored the board`;
    case 'board.joined':
      return `${actor} joined the board`;
    case 'board.left':
      return `${actor} left the board`;
    case 'board.member_added':
      return `${actor} added ${who} to the board`;
    case 'board.member_removed':
      return `${actor} removed ${who} from the board`;
    case 'board.member_owner':
      return `${actor} made ${who} an owner of the board`;
    case 'card.moved_out':
      return `${actor} moved ${card} to the board ${q(details.to, 'another board')}`;
    case 'card.moved_in':
      return `${actor} moved ${card} here from the board ${q(details.from, 'another board')}`;
    case 'card.cloned':
      return `${actor} cloned ${q(details.from, 'a card')} as ${card}`;
  }
}

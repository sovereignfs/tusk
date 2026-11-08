/**
 * What the footer's action button offers, by where the person is (DESIGN.md §18). Pure: the screen turns each into a dialog or an event.
 *
 * The Desk offers a new card (into the list on screen), a new list, and the list selector; Today and Review join them with tasks 6.3 and 6.5. Boards offers a
 * new board and a new workspace. Inside a board: a new list and a new card (into the list on screen). Everywhere else, a new card, which is what the Desk is for.
 */
export type Place = 'desk' | 'boards' | 'board' | 'other';

export type Action =
  | 'new-card'
  | 'new-list'
  | 'choose-list'
  | 'new-board'
  | 'new-workspace'
  | 'board-new-list'
  | 'board-new-card';

/** Where an address is: a board is `/b/…`, the Desk `/desk…`, and Boards is Home and a workspace's page. */
export function placeOf(pathname: string): Place {
  if (pathname.startsWith('/b/')) return 'board';
  if (pathname === '/desk' || pathname.startsWith('/desk/')) return 'desk';
  if (pathname === '/' || pathname.startsWith('/w/')) return 'boards';
  return 'other';
}

export const ACTIONS: Record<Place, readonly Action[]> = {
  desk: ['new-card', 'new-list', 'choose-list'],
  boards: ['new-board', 'new-workspace'],
  board: ['board-new-card', 'board-new-list'],
  other: ['new-card'],
};

/** The name of each action, which is what a screen reader says for it. */
export const LABELS: Record<Action, string> = {
  'new-card': 'New card',
  'new-list': 'New list',
  'choose-list': 'Go to a list',
  'new-board': 'New board',
  'new-workspace': 'New workspace',
  'board-new-list': 'New list',
  'board-new-card': 'New card',
};

/** The list the Desk is showing: the one in the address, or the first when it is the Desk's own. */
export function deskListOf(pathname: string): string | undefined {
  return /^\/desk\/([^/]+)/.exec(pathname)?.[1];
}

/** The event a board listens for, for the actions that are the board's (its lists and its columns are its own state). */
export const BOARD_ACTION = 'tusk:board-action';
/** The event a column listens for, to open its own field for a new card. */
export const COLUMN_ADD_CARD = 'tusk:column-add-card';

/**
 * What a device may ask of a workspace, and what it is told (DESIGN.md §7.3): **operations**, sent to `POST /api/ops` one at a time. Each is a closed
 * kind with arguments of its own, validated by `validate.ts` in the browser before it is sent and on the server before it is applied. Nothing here
 * depends on a database or a browser.
 *
 * ```json
 * { "opId": "6f1c…", "op": "workspace.rename", "id": "a3d9…", "name": "Acme" }
 * ```
 *
 * An `opId` makes a retry harmless: the server records it, and an operation it has applied is answered as applied and not done twice. There is no
 * `accountId` in an operation: who is asking is the session's, and the permission is in the statement that does the work (§7.1).
 */
export const OPS = [
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'member.add',
  'member.setRole',
  'member.remove',
  'member.leave',
  'board.create',
  'list.create',
  'list.rename',
  'list.move',
  'list.delete',
  'card.create',
  'card.move',
  'card.archive',
  'card.restore',
  'card.delete',
  'card.rename',
  'card.describe',
  'board.update',
  'board.archive',
  'board.restore',
  'board.delete',
  'board.setVisibility',
  'boardMember.add',
  'boardMember.setRole',
  'boardMember.remove',
  'board.join',
  'board.leave',
  'card.setDue',
  'label.create',
  'label.update',
  'label.delete',
  'card.addLabel',
  'card.removeLabel',
  'card.assign',
  'card.unassign',
  'item.add',
  'item.rename',
  'item.tick',
  'item.untick',
  'item.move',
  'item.delete',
  'comment.add',
  'comment.edit',
  'comment.delete',
  'card.moveToBoard',
  'card.clone',
  'board.publish',
  'board.unpublish',
] as const;
export type OpName = (typeof OPS)[number];

export type Op =
  | { readonly op: 'workspace.create'; readonly id: string; readonly name: string }
  | { readonly op: 'workspace.rename'; readonly id: string; readonly name: string }
  /** `name` is the workspace's name as it is, typed by the person: deleting a shared space is not done by accident (DESIGN.md §13.1). */
  | { readonly op: 'workspace.delete'; readonly id: string; readonly name: string }
  /** `email` is the exact address of an account that already exists here, case aside (DESIGN.md §13.2). The person is added as a member. */
  | { readonly op: 'member.add'; readonly workspaceId: string; readonly email: string }
  | {
      readonly op: 'member.setRole';
      readonly workspaceId: string;
      readonly accountId: string;
      readonly role: Role;
    }
  | { readonly op: 'member.remove'; readonly workspaceId: string; readonly accountId: string }
  /** Whoever asks leaves: there is no `accountId` in it, since nobody else's leaving is theirs to ask. */
  | { readonly op: 'member.leave'; readonly workspaceId: string }
  /** The creator becomes the board's owner and its only member, and it is made with one list, _Backlog_ (DESIGN.md §14.1). Public until its settings say otherwise. */
  | {
      readonly op: 'board.create';
      readonly id: string;
      readonly workspaceId: string;
      readonly name: string;
      readonly color: string;
    }
  /** `position` is chosen by the device between the neighbours it sees (DESIGN.md §10.4): a new list goes at the end. */
  | {
      readonly op: 'list.create';
      readonly id: string;
      readonly boardId: string;
      readonly name: string;
      readonly position: string;
    }
  /** A list is named by its id alone: the board it is on is the row's, and the permission is the board's. */
  | { readonly op: 'list.rename'; readonly id: string; readonly name: string }
  | { readonly op: 'list.move'; readonly id: string; readonly position: string }
  | { readonly op: 'list.delete'; readonly id: string }
  /** A card with only its title, put by the device between the cards it sees (DESIGN.md §15.1): a new one goes at the top of its list. */
  | {
      readonly op: 'card.create';
      readonly id: string;
      readonly listId: string;
      readonly title: string;
      readonly position: string;
    }
  /** To a list of the card's own board and a position among its cards: one row, whatever the distance. */
  | {
      readonly op: 'card.move';
      readonly id: string;
      readonly listId: string;
      readonly position: string;
    }
  | { readonly op: 'card.archive'; readonly id: string }
  /** Back to its list and its position, which archiving did not touch. */
  | { readonly op: 'card.restore'; readonly id: string }
  /** Only an archived card is deleted (§15.8), with its labels, assignees, checklist and comments; its activity stays. */
  | { readonly op: 'card.delete'; readonly id: string }
  | { readonly op: 'card.rename'; readonly id: string; readonly title: string }
  /** Plain text, shown as written with its line breaks; nothing (or only space) is no description. */
  | { readonly op: 'card.describe'; readonly id: string; readonly description: string }
  /** The board's name, colour and description, together: the settings dialog sends all three. Visibility is its own operation (§14.3). */
  | {
      readonly op: 'board.update';
      readonly id: string;
      readonly name: string;
      readonly color: string;
      readonly description: string;
    }
  | { readonly op: 'board.archive'; readonly id: string }
  | { readonly op: 'board.restore'; readonly id: string }
  /** `name` is the board's name as it is, typed by the person: deleting is final and takes everything on the board (DESIGN.md §14.4). */
  | { readonly op: 'board.delete'; readonly id: string; readonly name: string }
  /** Public: everyone in the workspace sees it and can join. Private: its members and the workspace's owners (DESIGN.md §14.3). */
  | { readonly op: 'board.setVisibility'; readonly id: string; readonly visibility: Visibility }
  /** Only someone already in the board's workspace can be added (§13.2: the people of a board come only from its workspace). */
  | { readonly op: 'boardMember.add'; readonly boardId: string; readonly accountId: string }
  | {
      readonly op: 'boardMember.setRole';
      readonly boardId: string;
      readonly accountId: string;
      readonly role: Role;
    }
  | { readonly op: 'boardMember.remove'; readonly boardId: string; readonly accountId: string }
  /** The asker becomes a member: anyone in the workspace on a public board, and a workspace owner on any (§7.2). */
  | { readonly op: 'board.join'; readonly id: string }
  /** The asker leaves it, and is unassigned from its cards. */
  | { readonly op: 'board.leave'; readonly id: string }
  /** A date as written on a calendar, and a time with it if wanted: floating, in no zone (DESIGN.md §11). No time without a date. Both together, so that they cannot disagree. */
  | {
      readonly op: 'card.setDue';
      readonly id: string;
      readonly dueDate: string | null;
      readonly dueTime: string | null;
    }
  /** A label of the board: any colour, and a name that may be empty (DESIGN.md §15.2). */
  | {
      readonly op: 'label.create';
      readonly id: string;
      readonly boardId: string;
      readonly name: string;
      readonly color: string;
    }
  | {
      readonly op: 'label.update';
      readonly id: string;
      readonly name: string;
      readonly color: string;
    }
  /** Takes it off every card, in the same operation. */
  | { readonly op: 'label.delete'; readonly id: string }
  /** The label must be the card's own board's. */
  | { readonly op: 'card.addLabel'; readonly cardId: string; readonly labelId: string }
  | { readonly op: 'card.removeLabel'; readonly cardId: string; readonly labelId: string }
  /** The person must be a member of the card's board (DESIGN.md §15.3). Assigning someone else raises a notice for them; assigning oneself raises none. */
  | { readonly op: 'card.assign'; readonly cardId: string; readonly accountId: string }
  | { readonly op: 'card.unassign'; readonly cardId: string; readonly accountId: string }
  /** An item of a card's checklist (DESIGN.md §15.4): a title, a tick and an order. A new one goes after the last, at a position the device chose. */
  | {
      readonly op: 'item.add';
      readonly id: string;
      readonly cardId: string;
      readonly title: string;
      readonly position: string;
    }
  | { readonly op: 'item.rename'; readonly id: string; readonly title: string }
  | { readonly op: 'item.tick'; readonly id: string }
  | { readonly op: 'item.untick'; readonly id: string }
  /** One row, whatever the distance. */
  | { readonly op: 'item.move'; readonly id: string; readonly position: string }
  | { readonly op: 'item.delete'; readonly id: string }
  /** Plain text, shown as written with its line breaks and never as HTML. Raises a `comment` notice for the card's assignees and its creator, never its author. */
  | {
      readonly op: 'comment.add';
      readonly id: string;
      readonly cardId: string;
      readonly body: string;
    }
  /** Its author's. */
  | { readonly op: 'comment.edit'; readonly id: string; readonly body: string }
  /** Its author's, or a board owner's. */
  | { readonly op: 'comment.delete'; readonly id: string }
  /**
   * To a list of another board of the same workspace that the person is a member of, at a position the device chose (DESIGN.md §15.7). Labels are matched
   * there by name and colour and made if missing; assignees who are not members there are dropped; comments, checklist and history go with the card.
   */
  | {
      readonly op: 'card.moveToBoard';
      readonly id: string;
      readonly boardId: string;
      readonly listId: string;
      readonly position: string;
    }
  /** A copy below it in its list, as a card of its own under `newId`: title, description, due date, checklist unticked, labels and assignees; not comments. */
  | { readonly op: 'card.clone'; readonly id: string; readonly newId: string }
  /** Gives the board an address anyone can open, read-only (DESIGN.md §14.6). Already published: the address it has. */
  | { readonly op: 'board.publish'; readonly id: string }
  /** Takes the address away for good: publishing again makes a different one. */
  | { readonly op: 'board.unpublish'; readonly id: string };

export type Visibility = 'public' | 'private';

/** A person's role in a workspace (DESIGN.md §7.2). */
export type Role = 'owner' | 'member';

export type OpRequest = Op & { readonly opId: string };

/** Limits, so that one account cannot fill the server (DESIGN.md §7.4). */
export const WORKSPACE_LIMITS = {
  nameChars: 100,
  /** Workspaces one account may have made. */
  workspacesPerAccount: 50,
  /** Workspaces an account is in: the sidebar and the boards index read them all. */
  workspacesListed: 200,
  /** People in a workspace (DESIGN.md §7.4). */
  membersPerWorkspace: 100,
  /** Addresses one account may try to add in an hour: it tells an owner whether an address has an account, so it is limited (DESIGN.md §13.2). */
  addsPerHour: 30,
  /** Boards in a workspace, lists on a board (DESIGN.md §7.4). */
  boardsPerWorkspace: 500,
  listsPerBoard: 100,
  cardsPerBoard: 5000,
  /** A card's title, in characters (DESIGN.md §15.1). */
  cardTitleChars: 500,
  /** A card's description, in characters. */
  descriptionChars: 20_000,
  /** A board's description, in characters. */
  boardDescriptionChars: 2000,
  /** Labels on a board, and the length of a label's name (DESIGN.md §7.4). */
  labelsPerBoard: 50,
  labelNameChars: 50,
  /** Checklist items on a card (DESIGN.md §7.4). */
  itemsPerCard: 200,
  /** Comments on a card, and the length of one (DESIGN.md §7.4). */
  commentsPerCard: 1000,
  commentChars: 5000,
  /** A page of comments. */
  commentsPage: 20,
  /** A position key, in characters. */
  positionChars: 64,
  /** A request body, in bytes: an operation is small. */
  bodyBytes: 64 * 1024,
} as const;

/**
 * Why an operation was not applied. None says whether the thing belongs to someone else.
 *
 *  - `not_found`  what it names is not there for this account: it does not exist, or is not theirs to touch, or the board is archived. One answer for all.
 *  - `invalid`    it is not an operation, or a value in it is not allowed.
 *  - `limit`      the account has as many as it may.
 *  - `stale`      it points at something that has gone since the screen last looked.
 */
export type OpRefusal = 'not_found' | 'invalid' | 'limit' | 'stale';

/**
 * Why a refusal was made, when the person who asked is entitled to know (an owner, or a member leaving): it is never given to someone who may not
 * have asked, who is told `not_found` and nothing more.
 *
 *  - `no_account`  no account here has that address (an owner adding someone)
 *  - `already_in`  that account is in the workspace already
 *  - `last_owner`  a workspace keeps at least one owner: they make someone else owner first, or delete it
 *  - `not_in_workspace`  the people of a board come only from its workspace
 *  - `not_on_board`  a card is assigned only to a member of its board
 */
export type OpReason =
  'no_account' | 'already_in' | 'last_owner' | 'not_in_workspace' | 'not_on_board';

/** A workspace as its people see it. */
export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  /** The role of the one asking. */
  readonly role: Role;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One of a workspace's people, as the server now holds it: a name and an avatar are read from the account when they are shown, never copied here. */
export interface MemberRow {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly role: Role;
}

/** A person of a workspace, for its list of people. The address is shown to an owner only. */
export interface Person {
  readonly accountId: string;
  readonly name: string;
  readonly email?: string;
  readonly role: Role;
  /** The one asking. */
  readonly you: boolean;
}

/** A board as the people who can see it do. */
export interface BoardRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly color: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly archived: boolean;
  /** Moved on by every operation on the board, so that an open one can tell it has changed (DESIGN.md §14.7). */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A list on a board, with how many open cards it holds. */
export interface ListRow {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly position: string;
  readonly cards: number;
}

/** A label of a board. */
export interface LabelRow {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly color: string;
}

/** An item of a card's checklist, as the card's dialog shows it. */
export interface ChecklistItem {
  readonly id: string;
  readonly cardId: string;
  readonly title: string;
  readonly done: boolean;
  readonly position: string;
}

/** A card's checklist progress, which its tile shows as "2/5". */
export interface Progress {
  readonly done: number;
  readonly total: number;
}

/** A comment, as the asker may see and use it. The author's name is read from the account when shown. */
export interface CommentRow {
  readonly id: string;
  readonly cardId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: number;
  readonly editedAt: number | null;
  /** The asker wrote it (and the board is open), so they edit it. */
  readonly canEdit: boolean;
  /** The asker wrote it, or owns the board (and it is open), so they delete it. */
  readonly canDelete: boolean;
}

/** A page of a card's comments, newest first, and whether there are older ones. */
export interface CommentPage {
  readonly comments: readonly CommentRow[];
  readonly more: boolean;
}

/** A card as its tile shows it (DESIGN.md §15.1): what the board is sent of every open card. The badges of later tasks join it as they are built. */
export interface CardTile {
  readonly id: string;
  readonly boardId: string;
  readonly listId: string;
  readonly title: string;
  readonly position: string;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  readonly hasDescription: boolean;
  /** The ids of the board's labels it carries, in the order the labels were made. */
  readonly labels: readonly string[];
  /** The accounts it is assigned to, in the order they were assigned. Always members of the board. */
  readonly assignees: readonly string[];
  readonly checklist: Progress;
  /** How many comments it has. */
  readonly comments: number;
}

/** A card whole, for its dialog (DESIGN.md §17.6): what the tile shows and the description, and the list it is in. */
export interface CardDetail extends CardTile {
  readonly listName: string;
  /** Its checklist, in order. */
  readonly items: readonly ChecklistItem[];
  readonly description: string | null;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** An archived card, for the list of them (DESIGN.md §15.8). */
export interface ArchivedCard {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly archivedAt: number;
}

/** A board whole and light (DESIGN.md §14.7): what a person who opens it is sent. Lists now; labels, people and cards arrive with the tasks that make them. */
export interface BoardView {
  readonly board: BoardRow;
  readonly workspace: { readonly id: string; readonly name: string };
  readonly lists: readonly ListRow[];
  /** The board's labels, in the order they were made. */
  readonly labels: readonly LabelRow[];
  /** Every open card, with what its tile shows. */
  readonly cards: readonly CardTile[];
  /** What the one asking may do here: only a member changes the board, and an archived one is read-only (§7.2). */
  readonly can: { readonly edit: boolean; readonly admin: boolean; readonly join: boolean };
}

export interface OpRows {
  readonly workspace?: WorkspaceRow;
  readonly board?: BoardRow;
  readonly list?: ListRow;
  readonly card?: CardTile;
  /** The board's address, as it now is. */
  readonly publication?: { readonly boardId: string; readonly token: string };
  /** The board that is no longer published. */
  readonly unpublished?: string;
  /** A comment that is gone. */
  readonly deletedComment?: string;
  readonly item?: ChecklistItem;
  /** An item that is gone. */
  readonly deletedItem?: string;
  readonly label?: LabelRow;
  /** A label that is gone, and so off every card. */
  readonly deletedLabel?: string;
  readonly boardMember?: {
    readonly boardId: string;
    readonly accountId: string;
    readonly role: Role;
  };
  readonly removedBoardMember?: { readonly boardId: string; readonly accountId: string };
  /** The id of a board that is gone for good. */
  readonly deletedBoard?: string;
  /** The id of a card that is gone for good. */
  readonly deletedCard?: string;
  /** The id of a list that is gone, with the cards that were on it. */
  readonly deletedList?: string;
  /** The board's version after the operation, so that its own change is not mistaken for someone else's. */
  readonly version?: number;
  readonly member?: MemberRow;
  /** Someone who is no longer in the workspace. */
  readonly removed?: { readonly workspaceId: string; readonly accountId: string };
  /** The id of a workspace that is gone. */
  readonly deleted?: string;
}

export type OpResult =
  | { readonly status: 'applied'; readonly replay: boolean; readonly rows: OpRows }
  | { readonly status: 'refused'; readonly code: OpRefusal; readonly reason?: OpReason };

/**
 * How Home sorts a person's own workspaces (DESIGN.md §17.3): by title (A to Z), oldest created first (`oldest`), newest created first (`created`, which
 * it was called before there was another), or most recently updated first.
 */
export const WORKSPACE_SORTS = ['name', 'oldest', 'created', 'updated'] as const;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];

/** A workspace on the boards index: its visible boards, and a few of its people as avatars (names are read from the accounts, never copied). */
export interface IndexWorkspace {
  readonly id: string;
  readonly boards: readonly BoardRow[];
  readonly people: readonly { readonly accountId: string; readonly name: string }[];
  readonly peopleCount: number;
}

export interface BoardsIndex {
  /** The sort the person chose for their own workspaces, the same on every device. */
  readonly sort: WorkspaceSort;
  readonly workspaces: readonly IndexWorkspace[];
}

/** People shown as avatars on a workspace's header; the rest are a count. */
export const INDEX_AVATARS = 5;

/** One of a board's people, for its Share dialog and the avatars in its header. The address is shown to an administrator only. */
export interface BoardPerson {
  readonly accountId: string;
  readonly name: string;
  readonly email?: string;
  readonly role: Role;
  readonly you: boolean;
}

/** A board's people, and for an administrator the workspace's people who are not on it yet (the picker; never a search of the server, §14.3). */
export interface BoardPeople {
  readonly members: readonly BoardPerson[];
  readonly candidates: readonly { readonly accountId: string; readonly name: string }[];
}

/** The kinds of notice there are (DESIGN.md §16): being assigned a card, a comment on a card one is assigned to or made, being added to a workspace, being added to a board, and the person's own backups stopping (§21.4). */
export const NOTICE_KINDS = [
  'assigned',
  'comment',
  'added_to_workspace',
  'added_to_board',
  'backup_stopped',
  'workspace_passed',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** A notice, as the Inbox shows it. The actor's name is read from the account when it is shown; the names of the card and board are as they were then. */
export interface NoticeRow {
  readonly id: string;
  readonly kind: NoticeKind;
  readonly actorName: string | null;
  readonly workspaceId: string | null;
  readonly boardId: string | null;
  readonly cardId: string | null;
  /** What the notice is about, by name: a card's title, a board's or a workspace's name. */
  readonly subject: string;
  readonly createdAt: number;
}

/** An open card assigned to the person, for _Assigned to me_. */
export interface AssignedCard {
  readonly cardId: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly title: string;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
}

export interface Inbox {
  readonly notices: readonly NoticeRow[];
  readonly more: boolean;
  /** Notices newer than the person last opened the Inbox, up to 100 (the screen says "99+"). */
  readonly unread: number;
  readonly assigned: readonly AssignedCard[];
}

/** The most notices one request carries, and the most a person keeps; how long they are kept, in milliseconds (DESIGN.md §16). */
export const NOTICE_LIMITS = {
  page: 50,
  perPerson: 500,
  keptMs: 90 * 24 * 60 * 60 * 1000,
  assignedListed: 200,
} as const;

/** What happened on a board (DESIGN.md §15.6). Each kind has a sentence in `describe.ts`. */
export const ACTIVITY_KINDS = [
  'card.created',
  'card.renamed',
  'card.moved',
  'card.archived',
  'card.restored',
  'card.deleted',
  'card.due_set',
  'card.due_cleared',
  'card.label_added',
  'card.label_removed',
  'card.assigned',
  'card.unassigned',
  'card.item_added',
  'card.item_ticked',
  'card.commented',
  'list.created',
  'list.renamed',
  'list.moved',
  'list.deleted',
  'board.created',
  'board.renamed',
  'board.visibility',
  'board.archived',
  'board.restored',
  'board.joined',
  'board.left',
  'board.member_added',
  'board.member_removed',
  'board.member_owner',
  'card.moved_out',
  'card.moved_in',
  'card.cloned',
  'board.published',
  'board.unpublished',
  'board.imported',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** A row of activity, with its sentence already made (`describe.ts`), the actor's name read from the account when it is shown. */
export interface ActivityRow {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly actorName: string;
  readonly text: string;
  readonly boardId: string;
  readonly boardName?: string;
  readonly cardId: string | null;
  readonly createdAt: number;
}

export interface ActivityPage {
  readonly activity: readonly ActivityRow[];
  readonly more: boolean;
}

/** A page of activity (DESIGN.md §15.6). */
export const ACTIVITY_PAGE = 50;

/** Where a card can be moved to: the boards of the same workspace that the person can change, with their lists and who is on them. */
export interface MoveTargets {
  readonly boards: readonly {
    readonly id: string;
    readonly name: string;
    readonly lists: readonly { readonly id: string; readonly name: string }[];
    readonly members: readonly string[];
  }[];
}

/** A published board, with the address it has: for its owners (Share dialog) and for Settings > Data. */
export interface Publication {
  readonly boardId: string;
  readonly boardName: string;
  readonly token: string;
}

/** The token of a published board: 32 random bytes in base64url is 43 characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

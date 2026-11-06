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
  | { readonly op: 'list.delete'; readonly id: string };

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
 */
export type OpReason = 'no_account' | 'already_in' | 'last_owner';

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
  readonly visibility: 'public' | 'private';
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

/** A board whole and light (DESIGN.md §14.7): what a person who opens it is sent. Lists now; labels, people and cards arrive with the tasks that make them. */
export interface BoardView {
  readonly board: BoardRow;
  readonly workspace: { readonly id: string; readonly name: string };
  readonly lists: readonly ListRow[];
  /** What the one asking may do here: only a member changes the board, and an archived one is read-only (§7.2). */
  readonly can: { readonly edit: boolean; readonly admin: boolean };
}

export interface OpRows {
  readonly workspace?: WorkspaceRow;
  readonly board?: BoardRow;
  readonly list?: ListRow;
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

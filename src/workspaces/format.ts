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
export const OPS = ['workspace.create', 'workspace.rename', 'workspace.delete'] as const;
export type OpName = (typeof OPS)[number];

export type Op =
  | { readonly op: 'workspace.create'; readonly id: string; readonly name: string }
  | { readonly op: 'workspace.rename'; readonly id: string; readonly name: string }
  /** `name` is the workspace's name as it is, typed by the person: deleting a shared space is not done by accident (DESIGN.md §13.1). */
  | { readonly op: 'workspace.delete'; readonly id: string; readonly name: string };

export type OpRequest = Op & { readonly opId: string };

/** Limits, so that one account cannot fill the server (DESIGN.md §7.4). */
export const WORKSPACE_LIMITS = {
  nameChars: 100,
  /** Workspaces one account may have made. */
  workspacesPerAccount: 50,
  /** Workspaces an account is in: the sidebar and the boards index read them all. */
  workspacesListed: 200,
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

/** A workspace as its people see it. */
export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  /** The role of the one asking. */
  readonly role: 'owner' | 'member';
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OpRows {
  readonly workspace?: WorkspaceRow;
  /** The id of a workspace that is gone. */
  readonly deleted?: string;
}

export type OpResult =
  | { readonly status: 'applied'; readonly replay: boolean; readonly rows: OpRows }
  | { readonly status: 'refused'; readonly code: OpRefusal };

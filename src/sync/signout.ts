import { deleteLocal } from '../local/db';
import type { SyncClient } from './client';

/**
 * Leaving a device (DESIGN.md §8.5): **signing out deletes this person's working copy from it**, because a shared computer holds a signed-in person's
 * tasks until they do. But the copy may hold changes the server has not had, and deleting it would lose them, so it first tries to send them, and if
 * it cannot it says how many there are and asks.
 *
 * The order, and why:
 *
 *  1. Try the outbox. Whatever the server takes is safe.
 *  2. If changes are still unsent, ask: the person may stay and wait for a network, or leave and lose them.
 *  3. End the session on the server. **Before** the copy goes: a sign-out that cannot reach the server must leave things as they were, not a person
 *     who thinks they have left, with no data, and a session still open for whoever sits down next.
 *  4. Delete this account's database. Other tabs let go of it when asked (`db.ts`), so this finishes at once and not when the last tab is closed.
 *
 * Everything outside the browser is given, so the whole of it is tested without one.
 */
export interface LeaveOptions {
  accountId: string;
  /** The open working copy, if the app has one open; without it there is nothing to send. */
  client?: SyncClient | undefined;
  /** Asks the person about changes that cannot be sent: true to leave anyway. */
  confirmLosing(unsent: number): Promise<boolean>;
  /** Ends the session on the server (better-auth's sign-out). Rejects if it could not. */
  endSession(): Promise<void>;
  /** Tells other tabs of this account that the person has left. */
  announce?(): void;
  /** Deletes the account's database; by default the one `openLocal` opens for it. A test names its own. */
  deleteDatabase?(): Promise<void>;
}

export type Left =
  | { status: 'left' }
  /** The person chose to stay rather than lose `unsent` changes. */
  | { status: 'cancelled'; unsent: number }
  /** The server could not be reached to end the session, so nothing was changed. */
  | { status: 'offline' };

export async function leaveDevice(options: LeaveOptions): Promise<Left> {
  const { accountId, client } = options;

  if (client) {
    await client.sync();
    const unsent = await client.pending();
    if (unsent > 0 && !(await options.confirmLosing(unsent)))
      return { status: 'cancelled', unsent };
  }

  try {
    await options.endSession();
  } catch {
    return { status: 'offline' };
  }

  options.announce?.();
  client?.close();
  client?.db.close();
  await (options.deleteDatabase ?? (() => deleteLocal(accountId)))();
  return { status: 'left' };
}

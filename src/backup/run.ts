import { sql } from 'drizzle-orm';
import type { Directory } from '../auth/directory';
import { CryptoError } from '../crypto/envelope';
import type { KeyRing } from '../crypto/keys';
import { readCredential } from '../crypto/store';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { GitHubProvider } from '../providers/github';
import { type Provider, ProviderError, type RepositoryRef } from '../providers/types';
import { MAX_FILE_BYTES } from '../portability/validate';
import { serialise } from '../portability/format';
import { readEncryption } from '../encryption/state';
import { webUrlOf } from './address';
import { recordFailure } from './failure';
import { TOKEN_PURPOSE, credentialIdOf, readConnection } from './connection';
import { backupMessage, backupPath } from './path';
import { takeSnapshot } from './snapshot';
import { backupConnectionTable } from './tables';

/**
 * Making a backup (DESIGN.md §21.3, §21.4). The connection is read; the token opened; the repository looked at again, **and the run stops if it has become
 * public**; the rows are read in one short transaction that is over before any call to the host (`takeSnapshot`); the file is refused if it is over 50 MB;
 * and it is put at `tusk/<UTC time>.json` on the default branch in one commit on the head just read, **never forced and nothing else in the repository
 * touched**. A branch that moved is read again and tried once more; **a write whose answer is lost is not repeated** (it is `unreachable`, nothing is
 * recorded, and the next backup is a new file, so the worst case is one file too many). Success is recorded only once the host has confirmed the commit.
 * Failures are given back as a kind, and `runBackup` keeps them and what they stop (`failure.ts`).
 */
export type RunProblem =
  | 'not_connected'
  | 'no_key'
  | 'token_rejected'
  | 'not_visible'
  | 'public'
  | 'read_only'
  | 'empty'
  | 'too_large'
  | 'key_unconfirmed'
  | 'moving'
  | 'head_moved'
  | 'rate_limited'
  | 'unreachable';

/** What to tell a person, for each. Never the host's text, and never the token. */
export const RUN_MESSAGES: Record<RunProblem, string> = {
  not_connected: 'No repository is connected.',
  no_key:
    'This server has no encryption key, so it cannot open the saved token. Ask whoever runs it to set TUSK_ENCRYPTION_KEY.',
  token_rejected:
    'GitHub no longer accepts the saved token (it may have expired or been revoked). Disconnect, and connect again with a new one.',
  not_visible:
    'The repository cannot be seen with the saved token any more (it may have been deleted or renamed). Disconnect, and connect again.',
  public:
    'The repository is public now, and a backup is plain text, so nothing was written. Make it private again, or connect another.',
  read_only:
    'The saved token can no longer write to the repository. Disconnect, and connect again with a token that has “Contents: Read and write”.',
  empty: 'The repository has nothing in it, so there is no branch to put a backup on.',
  too_large: 'Everything together is over 50 MB, which is more than a backup can hold.',
  key_unconfirmed:
    'Your Desk now has a key of its own. Backups carry on with the Desk sealed, but the files already in your repository are plain text and stay readable there. Confirm in Settings that you know, and backups continue.',
  moving:
    'Your Desk is being sealed with your key. Backups wait until that is finished, so that no file has some of it in the clear.',
  head_moved: 'The repository changed while the backup was being written, twice. Try again.',
  rate_limited: 'GitHub asks to be left alone for a while. Try again in a few minutes.',
  unreachable:
    'GitHub could not be reached, or did not confirm the backup. Try again in a little while.',
};

export type Trigger = 'manual' | 'auto';

export type RunResult =
  | {
      readonly ok: true;
      readonly unchanged: false;
      readonly trigger: Trigger;
      readonly path: string;
      readonly sha: string;
      readonly bytes: number;
      readonly at: number;
      /** Where the file is on the web. */
      readonly url: string;
    }
  /** An automatic backup that found nothing changed since the last: it looked, and wrote nothing (§21.4). */
  | {
      readonly ok: true;
      readonly unchanged: true;
      readonly trigger: Trigger;
      readonly at: number;
    }
  | { readonly ok: false; readonly problem: RunProblem; readonly retryAfterMs?: number };

export interface RunDeps {
  readonly database: Database;
  readonly directory: Pick<Directory, 'profiles'>;
  readonly ring: KeyRing | undefined;
  readonly apiUrl: string;
  readonly makeProvider?: (token: string) => Provider;
}

function problemOf(error: unknown): { problem: RunProblem; retryAfterMs?: number } {
  if (!(error instanceof ProviderError)) throw error;
  switch (error.code) {
    case 'unauthorized':
      return { problem: 'token_rejected' };
    case 'forbidden':
      return { problem: 'read_only' };
    case 'not_found':
      return { problem: 'not_visible' };
    case 'empty_repository':
      return { problem: 'empty' };
    case 'too_large':
      return { problem: 'too_large' };
    case 'head_moved':
      return { problem: 'head_moved' };
    case 'rate_limited':
      return {
        problem: 'rate_limited',
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      };
    default:
      return { problem: 'unreachable' };
  }
}

export async function runBackup(
  deps: RunDeps,
  accountId: string,
  now: number,
  trigger: Trigger,
): Promise<RunResult> {
  const result = await attempt(deps, accountId, now, trigger);
  // What came of it is kept (`failure.ts`): a failure is counted and may stop automatic backups and tell the person, once; a success ends all of that.
  if (!result.ok)
    await recordFailure(deps.database, accountId, result.problem, now, {
      ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
    });
  return result;
}

async function attempt(
  deps: RunDeps,
  accountId: string,
  now: number,
  trigger: Trigger,
): Promise<RunResult> {
  const connection = await readConnection(deps.database, accountId);
  if (!connection) return { ok: false, problem: 'not_connected' };
  if (!deps.ring) return { ok: false, problem: 'no_key' };

  let token: string | undefined;
  try {
    token = await readCredential(deps.database, deps.ring, {
      id: credentialIdOf(accountId),
      accountId,
      purpose: TOKEN_PURPOSE,
    });
  } catch (error) {
    // A token that cannot be opened (a key that is not the one it was sealed under) is as good as none; the error says what it must not, so it is not kept.
    if (!(error instanceof CryptoError)) throw error;
  }
  if (token === undefined) return { ok: false, problem: 'token_rejected' };

  const [owner, name] = connection.repository.split('/');
  if (!owner || !name) return { ok: false, problem: 'not_visible' };
  const ref: RepositoryRef = { owner, name };
  const provider = (
    deps.makeProvider ?? ((t) => new GitHubProvider({ token: t, apiUrl: deps.apiUrl }))
  )(token);
  // A Desk with a key of its own: not while it is being moved, and not before the person has confirmed what stays readable (§9.3).
  const encryption = await readEncryption(deps.database, accountId);
  if (encryption.mode === 'moving') return { ok: false, problem: 'moving' };
  if (encryption.mode === 'personal' && connection.keyConfirmedAt === null)
    return { ok: false, problem: 'key_unconfirmed' };

  const when = new Date(now);
  const path = backupPath(when);

  try {
    // Looked at again every time: a repository that was made public since it was connected gets nothing.
    const repository = await provider.getRepository(ref);
    if (!repository.private) return { ok: false, problem: 'public' };

    // The rows, in a transaction that is over before the host is called again.
    const snapshot = await takeSnapshot(deps.database, deps.directory, accountId, when);
    // An automatic backup writes only when something changed since the last one; Back up now always writes.
    if (trigger === 'auto' && snapshot.fingerprint === connection.lastFingerprint) {
      await dbAll(
        deps.database,
        sql`UPDATE ${backupConnectionTable(deps.database)} SET last_checked_at = ${now}, failure_kind = NULL, failures = 0, stopped_at = NULL
            WHERE account_id = ${accountId} RETURNING account_id`,
      );
      return { ok: true, unchanged: true, trigger, at: now };
    }
    const content = serialise(snapshot.file);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) return { ok: false, problem: 'too_large' };

    let commit: Awaited<ReturnType<Provider['commit']>> | undefined;
    for (let attempt = 1; commit === undefined; attempt += 1) {
      const head = await provider.getHead(ref, repository.defaultBranch);
      try {
        commit = await provider.commit(ref, {
          branch: repository.defaultBranch,
          expectedHead: head,
          message: backupMessage(when),
          changes: [{ path, content }],
        });
      } catch (error) {
        // The branch is not where it was read: read it again and try once more, and no more.
        if (!(error instanceof ProviderError && error.code === 'head_moved') || attempt >= 2)
          throw error;
      }
    }

    // Recorded only now that the host has confirmed it.
    await dbAll(
      deps.database,
      sql`UPDATE ${backupConnectionTable(deps.database)}
          SET last_backup_at = ${now}, last_checked_at = ${now}, last_backup_path = ${path}, last_fingerprint = ${snapshot.fingerprint},
              failure_kind = NULL, failures = 0, stopped_at = NULL
          WHERE account_id = ${accountId} RETURNING account_id`,
    );
    return {
      ok: true,
      unchanged: false,
      trigger,
      path,
      sha: commit.sha,
      bytes,
      at: now,
      url: `${webUrlOf(deps.apiUrl, connection.repository)}/blob/${repository.defaultBranch}/${path}`,
    };
  } catch (error) {
    return { ok: false, ...problemOf(error) };
  }
}

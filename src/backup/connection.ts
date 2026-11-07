import { sql } from 'drizzle-orm';
import { deleteCredential, putCredential } from '../crypto/store';
import type { KeyRing } from '../crypto/keys';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { GitHubProvider } from '../providers/github';
import { type Provider, ProviderError, type RepositoryRef } from '../providers/types';
import { parseAddress, webHostsFor } from './address';
import { DEFAULT_FREQUENCY, type Frequency, type Mode, isFrequency, isMode } from './schedule';
import { readEncryption } from '../encryption/state';
import { backupConnectionTable } from './tables';

/**
 * The repository an account backs up to, and the token for it (DESIGN.md §21.2). **A connection is checked before anything is kept**, in the order a person
 * would fix things: the token is accepted; it can see the repository; **the repository is private**; its default branch has something in it; and the token can
 * write. Each refusal is a `ConnectProblem`, with a message of ours that says what to do: **never GitHub's text, never the token.** A token that fails leaves
 * nothing behind. The token is sealed by `src/crypto/` under an id made from the account, so that one account has one and a repeat is a replacement, and the
 * row beside it holds no secret. A token that can reach more repositories than this one is accepted, with a warning that says how many.
 */
export type ConnectProblem =
  | 'address'
  | 'host'
  | 'password'
  | 'no_key'
  | 'token'
  | 'token_rejected'
  | 'not_visible'
  | 'public'
  | 'empty'
  | 'read_only'
  | 'rate_limited'
  | 'unreachable';

/** What to tell a person, for each. */
export const PROBLEM_MESSAGES: Record<ConnectProblem, string> = {
  address:
    'That is not the address of a repository. Paste its address (https://github.com/owner/name), or write it as owner/name.',
  host: 'Only repositories on GitHub can be connected, and that address is on another host.',
  password:
    'That address has a user name or password in it. Paste the address without it: the token goes in the next box.',
  no_key:
    'This server has no encryption key, so it cannot keep a token safely. Ask whoever runs it to set TUSK_ENCRYPTION_KEY.',
  token: 'Paste the token you made on GitHub.',
  token_rejected:
    'GitHub did not accept that token. It may have a typo, have expired or have been revoked. Make a new one and paste it.',
  not_visible:
    'The token cannot see that repository. Check the address, and that the token was made for this repository.',
  public:
    'That repository is public, and a backup is plain text that anyone could read. Only a private repository can be connected: make it private, or connect another.',
  empty:
    'That repository has nothing in it yet. Add a file (a README will do) on GitHub, then connect it again.',
  read_only:
    'The token can read that repository but not write to it. Make a token for it with “Contents: Read and write”.',
  rate_limited: 'GitHub asks to be left alone for a while. Try again in a few minutes.',
  unreachable: 'GitHub could not be reached. Try again in a little while.',
};

/** What is known of a connection, with nothing secret in it: this is what is shown, and what a response carries. */
export interface Connection {
  readonly accountId: string;
  readonly kind: 'token';
  /** `owner/name`. */
  readonly repository: string;
  readonly branch: string;
  readonly credentialId: string;
  readonly createdAt: number;
  /** The last backup confirmed written: when, to which file, and the fingerprint of what it held. Null until there is one. */
  readonly lastBackupAt: number | null;
  readonly lastBackupPath: string | null;
  readonly lastFingerprint: string | null;
  /** When an automatic backup last looked, whether it wrote or found nothing changed. */
  readonly lastCheckedAt: number | null;
  readonly mode: Mode;
  readonly frequency: Frequency;
  /** When `auto` is next due; null for `manual`. */
  readonly nextBackupAt: number | null;
  /** When the person confirmed that backups go on after their Desk got a key: older files stay plain. Null until they have. */
  readonly keyConfirmedAt: number | null;
  /** Why the last backup failed, and how many in a row; null and 0 after one that worked. */
  readonly failureKind: string | null;
  readonly failures: number;
  /** When automatic backups were stopped by a failure that will not mend itself; null while they run. */
  readonly stoppedAt: number | null;
}

/** What the credential is for, in the store. */
export const TOKEN_PURPOSE = 'github-token';

/** The credential's id: made from the account, so that an account has one and connecting again replaces it. */
export const credentialIdOf = (accountId: string): string => `backup:${accountId}`;

export interface ConnectDeps {
  readonly database: Database;
  /** The instance key, or none: nothing can be kept without one. */
  readonly ring: KeyRing | undefined;
  /** `TUSK_GITHUB_API_URL`, as checked. */
  readonly apiUrl: string;
  readonly now: () => number;
  /** A provider that speaks as this token. The server's is GitHub; a test may give another. */
  readonly makeProvider?: (token: string) => Provider;
}

export type ConnectResult =
  | {
      readonly ok: true;
      readonly connection: Connection;
      /** How many repositories the token can reach besides this one, when it is more than none. */
      readonly alsoReaches: number;
    }
  | { readonly ok: false; readonly problem: ConnectProblem };

/** A token as a person pastes one: printable, no spaces inside, not long. Anything else is not sent anywhere. */
function cleanToken(raw: string): string | undefined {
  const token = raw.trim();
  return /^[\x21-\x7e]{8,512}$/.test(token) ? token : undefined;
}

/** What a failure of a call means to a person, by what it was and not by anything the host said. */
function problemOf(error: unknown, notFound: ConnectProblem): ConnectProblem {
  if (!(error instanceof ProviderError)) throw error;
  switch (error.code) {
    case 'unauthorized':
      return 'token_rejected';
    case 'not_found':
    case 'forbidden':
      return notFound;
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_request':
      return 'address';
    default:
      return 'unreachable';
  }
}

export async function readConnection(
  database: Database,
  accountId: string,
): Promise<Connection | undefined> {
  const row = await dbGet<{
    accountId: string;
    kind: string;
    repository: string;
    branch: string;
    credentialId: string;
    createdAt: number | string;
    lastBackupAt: number | string | null;
    lastBackupPath: string | null;
    lastFingerprint: string | null;
    lastCheckedAt: number | string | null;
    mode: string;
    frequency: string;
    nextBackupAt: number | string | null;
    keyConfirmedAt: number | string | null;
    failureKind: string | null;
    failures: number | string;
    stoppedAt: number | string | null;
  }>(
    database,
    sql`SELECT account_id AS "accountId", kind, repository, branch, credential_id AS "credentialId", created_at AS "createdAt",
        last_backup_at AS "lastBackupAt", last_backup_path AS "lastBackupPath", last_fingerprint AS "lastFingerprint",
        last_checked_at AS "lastCheckedAt", mode, frequency, next_backup_at AS "nextBackupAt", key_confirmed_at AS "keyConfirmedAt",
        failure_kind AS "failureKind", failures, stopped_at AS "stoppedAt"
        FROM ${backupConnectionTable(database)} WHERE account_id = ${accountId}`,
  );
  return row
    ? {
        accountId: row.accountId,
        kind: 'token',
        repository: row.repository,
        branch: row.branch,
        credentialId: row.credentialId,
        createdAt: Number(row.createdAt),
        lastBackupAt: row.lastBackupAt === null ? null : Number(row.lastBackupAt),
        lastBackupPath: row.lastBackupPath,
        lastFingerprint: row.lastFingerprint,
        lastCheckedAt: row.lastCheckedAt === null ? null : Number(row.lastCheckedAt),
        mode: isMode(row.mode) ? row.mode : 'manual',
        frequency: isFrequency(row.frequency) ? row.frequency : DEFAULT_FREQUENCY,
        nextBackupAt: row.nextBackupAt === null ? null : Number(row.nextBackupAt),
        keyConfirmedAt: row.keyConfirmedAt === null ? null : Number(row.keyConfirmedAt),
        failureKind: row.failureKind,
        failures: Number(row.failures),
        stoppedAt: row.stoppedAt === null ? null : Number(row.stoppedAt),
      }
    : undefined;
}

/**
 * Connects `address` with `token` for `accountId`, or says why not. Nothing is written until every check has passed; if keeping it fails halfway, the token
 * that was sealed is removed again and the error is the caller's.
 */
export async function connectRepository(
  deps: ConnectDeps,
  accountId: string,
  address: string,
  rawToken: string,
): Promise<ConnectResult> {
  const parsed = parseAddress(address, webHostsFor(deps.apiUrl));
  if (!parsed.ok) return { ok: false, problem: parsed.problem };
  if (!deps.ring) return { ok: false, problem: 'no_key' };
  const token = cleanToken(rawToken);
  if (token === undefined) return { ok: false, problem: 'token' };

  const provider = (
    deps.makeProvider ?? ((t) => new GitHubProvider({ token: t, apiUrl: deps.apiUrl }))
  )(token);
  const ref: RepositoryRef = parsed.ref;

  let branch: string;
  try {
    const repository = await provider.getRepository(ref);
    if (!repository.private) return { ok: false, problem: 'public' };
    branch = repository.defaultBranch;
    try {
      await provider.getHead(ref, branch);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'empty_repository')
        return { ok: false, problem: 'empty' };
      throw error;
    }
    if (!(await provider.canWrite(ref, branch))) return { ok: false, problem: 'read_only' };
  } catch (error) {
    return { ok: false, problem: problemOf(error, 'not_visible') };
  }

  // A token that reaches more than it needs is accepted; not being able to count is not a reason to refuse one.
  const alsoReaches = await provider.reachable().then(
    (count) => Math.max(0, count - 1),
    () => 0,
  );

  const now = deps.now();
  // A repository connected to a Desk that already has a key has no plain file in it to be told about; one connected before has.
  const sealed = (await readEncryption(deps.database, accountId)).mode !== 'none';
  const credentialId = credentialIdOf(accountId);
  await putCredential(
    deps.database,
    deps.ring,
    { id: credentialId, accountId, purpose: TOKEN_PURPOSE },
    token,
    now,
  );
  try {
    await dbAll(
      deps.database,
      sql`INSERT INTO ${backupConnectionTable(deps.database)} AS c (account_id, kind, repository, branch, credential_id, created_at, key_confirmed_at)
          VALUES (${accountId}, 'token', ${`${ref.owner}/${ref.name}`}, ${branch}, ${credentialId}, ${now}, ${sealed ? now : null})
          ON CONFLICT (account_id) DO UPDATE SET
            kind = 'token', repository = ${`${ref.owner}/${ref.name}`}, branch = ${branch}, credential_id = ${credentialId}, created_at = ${now},
            last_backup_at = NULL, last_backup_path = NULL, last_fingerprint = NULL, last_checked_at = NULL,
            key_confirmed_at = ${sealed ? now : null},
            failure_kind = NULL, failures = 0, stopped_at = NULL
          RETURNING account_id`,
    );
  } catch (error) {
    // The token was sealed and the row was not written: it is not kept, so that "a token that fails leaves nothing behind" holds for this too.
    if ((await readConnection(deps.database, accountId)) === undefined)
      await deleteCredential(deps.database, {
        id: credentialId,
        accountId,
        purpose: TOKEN_PURPOSE,
      });
    throw error;
  }
  const connection = await readConnection(deps.database, accountId);
  if (!connection) throw new Error('a connection that was just written is not there');
  return { ok: true, connection, alsoReaches };
}

/** Disconnects: the connection and its credential go, the repository is left as it is. False when there was nothing to disconnect. Safe to run twice. */
export async function disconnectRepository(
  database: Database,
  accountId: string,
): Promise<boolean> {
  const gone = await dbAll<{ credentialId: string }>(
    database,
    sql`DELETE FROM ${backupConnectionTable(database)} WHERE account_id = ${accountId} RETURNING credential_id AS "credentialId"`,
  );
  const credentialId = gone[0]?.credentialId ?? credentialIdOf(accountId);
  await deleteCredential(database, { id: credentialId, accountId, purpose: TOKEN_PURPOSE });
  return gone.length > 0;
}

/** Records that the person knows what stays readable after their Desk got a key. False when nothing is connected. */
export async function confirmKey(
  database: Database,
  accountId: string,
  now: number,
): Promise<boolean> {
  const rows = await dbAll(
    database,
    sql`UPDATE ${backupConnectionTable(database)}
        SET key_confirmed_at = ${now},
            stopped_at = CASE WHEN failure_kind = 'key_unconfirmed' THEN NULL ELSE stopped_at END,
            failure_kind = CASE WHEN failure_kind = 'key_unconfirmed' THEN NULL ELSE failure_kind END,
            failures = CASE WHEN failure_kind = 'key_unconfirmed' THEN 0 ELSE failures END
        WHERE account_id = ${accountId} RETURNING account_id`,
  );
  return rows.length > 0;
}

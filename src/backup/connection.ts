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
import { type ConnectProblem, PROBLEM_MESSAGES } from './problems';

export { type ConnectProblem, PROBLEM_MESSAGES };

/** What is known of a connection, with nothing secret in it: this is what is shown, and what a response carries. */
export interface Connection {
  readonly accountId: string;
  /** `token` (a token the person made) or `app` (the GitHub App's installation). */
  readonly kind: 'token' | 'app';
  /** The installation, for `app`; null for a token. */
  readonly installationId: number | null;
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

/**
 * The checks of a connection, in the order a person would fix things, whichever way it was made: the host accepts the credential and the repository is
 * visible to it, **the repository is private**, its default branch has something in it, and the credential can write.
 */
export async function checkRepository(
  provider: Provider,
  ref: RepositoryRef,
): Promise<{ ok: true; branch: string } | { ok: false; problem: ConnectProblem }> {
  try {
    const repository = await provider.getRepository(ref);
    if (!repository.private) return { ok: false, problem: 'public' };
    try {
      await provider.getHead(ref, repository.defaultBranch);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'empty_repository')
        return { ok: false, problem: 'empty' };
      throw error;
    }
    if (!(await provider.canWrite(ref, repository.defaultBranch)))
      return { ok: false, problem: 'read_only' };
    return { ok: true, branch: repository.defaultBranch };
  } catch (error) {
    return { ok: false, problem: problemOf(error, 'not_visible') };
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
    installationId: number | string | null;
  }>(
    database,
    sql`SELECT account_id AS "accountId", kind, repository, branch, credential_id AS "credentialId", created_at AS "createdAt",
        last_backup_at AS "lastBackupAt", last_backup_path AS "lastBackupPath", last_fingerprint AS "lastFingerprint",
        last_checked_at AS "lastCheckedAt", mode, frequency, next_backup_at AS "nextBackupAt", key_confirmed_at AS "keyConfirmedAt",
        failure_kind AS "failureKind", failures, stopped_at AS "stoppedAt", installation_id AS "installationId"
        FROM ${backupConnectionTable(database)} WHERE account_id = ${accountId}`,
  );
  return row
    ? {
        accountId: row.accountId,
        kind: row.kind === 'app' ? 'app' : 'token',
        installationId: row.installationId === null ? null : Number(row.installationId),
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

  const checked = await checkRepository(provider, ref);
  if (!checked.ok) return checked;
  const branch = checked.branch;

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

/** What connecting through the App needs: the database, the address of the API, and a provider that speaks as the installation. */
export interface InstallationDeps {
  readonly database: Database;
  readonly now: () => number;
  /** A provider that speaks as the installation (a token asked for, kept in memory). */
  readonly providerFor: (installationId: number) => Promise<Provider>;
}

/**
 * Connects `ref` through the App's installation (DESIGN.md §21.2). **The caller has already shown that this installation is the person's** (the
 * repositories it can reach for them, `src/github-app/user.ts`); the checks of every connection then apply with the installation's own token. Nothing secret is
 * kept: the row says which installation, and the token is asked for each time it is wanted.
 */
export async function connectInstallation(
  deps: InstallationDeps,
  accountId: string,
  installationId: number,
  ref: RepositoryRef,
): Promise<ConnectResult> {
  let provider: Provider;
  try {
    provider = await deps.providerFor(installationId);
  } catch (error) {
    return { ok: false, problem: problemOf(error, 'app_not_yours') };
  }
  const checked = await checkRepository(provider, ref);
  if (!checked.ok) return checked;
  const now = deps.now();
  const sealed = (await readEncryption(deps.database, accountId)).mode !== 'none';
  // Connecting again replaces: a token that was kept before goes, since this connection has none.
  await deleteCredential(deps.database, {
    id: credentialIdOf(accountId),
    accountId,
    purpose: TOKEN_PURPOSE,
  });
  await dbAll(
    deps.database,
    sql`INSERT INTO ${backupConnectionTable(deps.database)} AS c (account_id, kind, repository, branch, credential_id, created_at, key_confirmed_at, installation_id)
        VALUES (${accountId}, 'app', ${`${ref.owner}/${ref.name}`}, ${checked.branch}, ${credentialIdOf(accountId)}, ${now}, ${sealed ? now : null}, ${installationId})
        ON CONFLICT (account_id) DO UPDATE SET
          kind = 'app', repository = ${`${ref.owner}/${ref.name}`}, branch = ${checked.branch}, credential_id = ${credentialIdOf(accountId)}, created_at = ${now},
          installation_id = ${installationId},
          last_backup_at = NULL, last_backup_path = NULL, last_fingerprint = NULL, last_checked_at = NULL,
          key_confirmed_at = ${sealed ? now : null},
          failure_kind = NULL, failures = 0, stopped_at = NULL
        RETURNING account_id`,
  );
  const connection = await readConnection(deps.database, accountId);
  if (!connection) throw new Error('a connection that was just written is not there');
  return { ok: true, connection, alsoReaches: 0 };
}

/**
 * GitHub says an installation was removed, or a repository taken from it: disconnects what that left without access. `repositories` are `owner/name`s that were
 * removed; omitted, the whole installation went. Safe to run twice. Returns how many connections it removed.
 */
export async function disconnectInstallation(
  database: Database,
  installationId: number,
  repositories?: readonly string[],
): Promise<number> {
  const rows = await dbAll<{ accountId: string; repository: string }>(
    database,
    sql`SELECT account_id AS "accountId", repository FROM ${backupConnectionTable(database)} WHERE installation_id = ${installationId} AND kind = 'app'`,
  );
  const lost = new Set((repositories ?? []).map((each) => each.toLowerCase()));
  let removed = 0;
  for (const row of rows) {
    if (repositories !== undefined && !lost.has(row.repository.toLowerCase())) continue;
    if (await disconnectRepository(database, row.accountId)) removed += 1;
  }
  return removed;
}

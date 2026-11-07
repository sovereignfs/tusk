import type { Limiter, Rule } from '../limits/rate';
import { readCapped } from '../sync/endpoint';
import type { Directory } from '../auth/directory';
import { webUrlOf } from './address';
import {
  type ConnectDeps,
  PROBLEM_MESSAGES,
  confirmKey,
  connectRepository,
  disconnectRepository,
  readConnection,
} from './connection';
import { setSchedule } from './auto';
import { RUN_MESSAGES, runBackup } from './run';
import { type Frequency, type Mode, isFrequency, isMode } from './schedule';

/**
 * `/api/backup/connection` (DESIGN.md §21.2): what is connected, connecting a repository with a token, and disconnecting. The route is wrapped in
 * `accountRoute`, which has found the session and checked `Origin`; this runs for the account it names. **The token is in one request body and in no
 * response, log or error:** the body is read here, handed to `connectRepository` and not kept, and an answer says what the connection is, never what it was
 * made with. A connection is the account's, found by the account and not by anything a request says, so there is no other account's to ask for.
 */
export interface ConnectionDeps extends ConnectDeps {
  readonly limiter: Limiter;
  /** The GitHub App is set up: a repository can be connected by installing it (§21.2). */
  readonly appAvailable?: boolean;
}

/** Each try is a call to GitHub with a token the person typed, so it is counted. */
export const CONNECT_RATE: Rule = { limit: 10, windowMs: 60_000 };
const BODY_BYTES = 4096;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/** What a response says of a connection: nothing secret, and not even the id of the credential. */
function shown(
  connection: {
    repository: string;
    branch: string;
    kind: string;
    createdAt: number;
    lastBackupAt: number | null;
    lastBackupPath: string | null;
    lastCheckedAt: number | null;
    keyConfirmedAt: number | null;
    failureKind: string | null;
    failures: number;
    stoppedAt: number | null;
    mode: Mode;
    frequency: Frequency;
    nextBackupAt: number | null;
  },
  apiUrl: string,
) {
  const url = webUrlOf(apiUrl, connection.repository);
  return {
    repository: connection.repository,
    url,
    branch: connection.branch,
    kind: connection.kind,
    connectedAt: connection.createdAt,
    mode: connection.mode,
    frequency: connection.frequency,
    nextBackupAt: connection.nextBackupAt,
    lastCheckedAt: connection.lastCheckedAt,
    keyConfirmedAt: connection.keyConfirmedAt,
    // Why the last backup failed, in our words, and whether automatic backups have stopped for it: Settings always shows it, with what to do.
    failure:
      connection.failureKind !== null
        ? {
            code: connection.failureKind,
            message:
              (RUN_MESSAGES as Record<string, string>)[connection.failureKind] ??
              'The last backup could not be made.',
            failures: connection.failures,
            stoppedAt: connection.stoppedAt,
          }
        : null,
    lastBackup:
      connection.lastBackupAt !== null && connection.lastBackupPath !== null
        ? {
            at: connection.lastBackupAt,
            path: connection.lastBackupPath,
            url: `${url}/blob/${connection.branch}/${connection.lastBackupPath}`,
          }
        : null,
  };
}

/** `GET`: whether this server can keep a token at all, and the connection if there is one. */
export async function connectionStatus(accountId: string, deps: ConnectionDeps): Promise<Response> {
  const connection = await readConnection(deps.database, accountId);
  return json(200, {
    canConnect: deps.ring !== undefined,
    canConnectApp: deps.appAvailable === true,
    connection: connection ? shown(connection, deps.apiUrl) : null,
  });
}

/** `POST`: `{ repository, token }`. 200 with the connection (and a warning when the token reaches more), or 422 with our words for what to fix. */
export async function connectionConnect(
  request: Request,
  accountId: string,
  deps: ConnectionDeps,
): Promise<Response> {
  const body = await readCapped(request, BODY_BYTES);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  const taken = await deps.limiter.take(`backup-connect:${accountId}`, CONNECT_RATE);
  if (!taken.ok) {
    return json(
      429,
      { code: 'RATE_LIMITED' },
      { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  const given = parsed as { repository?: unknown; token?: unknown } | null;
  if (typeof given?.repository !== 'string' || typeof given.token !== 'string')
    return json(400, { code: 'BAD_REQUEST' });

  const result = await connectRepository(deps, accountId, given.repository, given.token);
  if (!result.ok)
    return json(422, { code: result.problem, message: PROBLEM_MESSAGES[result.problem] });
  return json(200, {
    connection: shown(result.connection, deps.apiUrl),
    ...(result.alsoReaches > 0
      ? {
          warning: {
            alsoReaches: result.alsoReaches,
            message: `This token can also reach ${result.alsoReaches} other ${result.alsoReaches === 1 ? 'repository' : 'repositories'}. Tusk only uses the one you connected, but a token made for that repository alone is safer.`,
          },
        }
      : {}),
  });
}

/**
 * `PATCH { mode?, frequency? }`: `manual` or `auto`, and how often `auto` looks (`hourly`, `6h`, `daily`, `weekly`). 200 with the connection; 400 for what is
 * not one of those; 404 when this account has nothing connected.
 */
export async function connectionSchedule(
  request: Request,
  accountId: string,
  deps: ConnectionDeps,
): Promise<Response> {
  const body = await readCapped(request, BODY_BYTES);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  const given = parsed as { mode?: unknown; frequency?: unknown } | null;
  if (typeof given !== 'object' || given === null || Array.isArray(given))
    return json(400, { code: 'BAD_REQUEST' });
  const patch: { mode?: Mode; frequency?: Frequency } = {};
  if (given.mode !== undefined) {
    if (!isMode(given.mode)) return json(400, { code: 'BAD_REQUEST' });
    patch.mode = given.mode;
  }
  if (given.frequency !== undefined) {
    if (!isFrequency(given.frequency)) return json(400, { code: 'BAD_REQUEST' });
    patch.frequency = given.frequency;
  }
  if (patch.mode === undefined && patch.frequency === undefined)
    return json(400, { code: 'BAD_REQUEST' });
  const connection = await setSchedule(deps.database, accountId, patch, deps.now());
  if (!connection) return new Response(null, { status: 404 });
  return json(200, { connection: shown(connection, deps.apiUrl) });
}

/**
 * `POST`: the person confirms that backups go on now that their Desk has a key of its own, and that the files already in the repository stay plain (§21.3).
 * 204; 404 where nothing is connected.
 */
export async function connectionConfirmKey(
  accountId: string,
  deps: ConnectionDeps,
): Promise<Response> {
  if (!(await confirmKey(deps.database, accountId, deps.now())))
    return new Response(null, { status: 404 });
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/** `DELETE`: disconnects. 404 when there is nothing connected for this account, as for anything that is not theirs. */
export async function connectionDisconnect(
  accountId: string,
  deps: ConnectionDeps,
): Promise<Response> {
  return (await disconnectRepository(deps.database, accountId))
    ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    : new Response(null, { status: 404 });
}

/** Back up now: at most once a minute, whatever came of the last, since each is a read of everything and a call to GitHub. */
export const RUN_RATE: Rule = { limit: 1, windowMs: 60_000 };

export interface RunEndpointDeps extends ConnectionDeps {
  readonly directory: Pick<Directory, 'profiles'>;
}

/**
 * `POST /api/backup/run` (DESIGN.md §21.4): **Back up now** always commits. 200 with where the file is; 422 with our words for what went wrong (`{ code,
 * message }`, never the host's text); 404 when nothing is connected for this account; 429 when it was done a minute ago. The account is the session's.
 */
export async function runNow(accountId: string, deps: RunEndpointDeps): Promise<Response> {
  if ((await readConnection(deps.database, accountId)) === undefined)
    return new Response(null, { status: 404 });
  const taken = await deps.limiter.take(`backup-run:${accountId}`, RUN_RATE);
  if (!taken.ok) {
    return json(
      429,
      { code: 'RATE_LIMITED' },
      { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
    );
  }
  const result = await runBackup(deps, accountId, deps.now(), 'manual');
  if (!result.ok) {
    return json(
      422,
      { code: result.problem, message: RUN_MESSAGES[result.problem] },
      result.retryAfterMs === undefined
        ? {}
        : { 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
    );
  }
  // A manual run always writes.
  if (result.unchanged) return json(200, { unchanged: true, at: result.at });
  return json(200, { path: result.path, url: result.url, at: result.at });
}

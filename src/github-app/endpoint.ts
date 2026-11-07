import type { Limiter, Rule } from '../limits/rate';
import {
  type ConnectProblem,
  type InstallationDeps,
  PROBLEM_MESSAGES,
  connectInstallation,
  disconnectInstallation,
} from '../backup/connection';
import { parseAddress, webHostsFor } from '../backup/address';
import { type Provider, ProviderError } from '../providers/types';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { webOrigin, exchangeCode, installationRepositories, type UserOptions } from './user';
import { REDIRECT_PATH, type GitHubAppSettings } from './config';
import {
  STATE_COOKIE,
  clearedStateCookie,
  cookieValue,
  newState,
  stateCookie,
  stateMatches,
} from './state';

/**
 * Connecting through the GitHub App (DESIGN.md §21.2), as three routes. **`install`** sends the person to GitHub to install the App on one repository, with a
 * `state` that is also in a cookie. **`callback`** is where GitHub sends them back: the `state` must be the cookie's; the `code` is traded for a token that is
 * the person's own, and asked which repositories of **that installation** they can reach (the `installation_id` in the address is anyone's to write, so only
 * this proves it is theirs); exactly one must be reachable; then it is connected under the checks of every connection. **`webhook`** is what GitHub tells Tusk
 * when an installation, or a repository in it, is removed: authenticated by its signature alone.
 */
export interface AppDeps extends InstallationDeps {
  readonly app: GitHubAppSettings;
  /** `TUSK_URL`: where GitHub sends the person back to. */
  readonly url: string;
  readonly apiUrl: string;
  readonly limiter: Limiter;
  readonly fetch?: typeof fetch;
  /** Makes a provider for a token the person gave; not used here, but a connection of the other kind shares the deps. */
  readonly makeProvider?: (token: string) => Provider;
}

const secure = (url: string) => url.startsWith('https:');

/** Each return is a call to GitHub with a code the person was handed, so it is counted. */
export const APP_RATE: Rule = { limit: 10, windowMs: 60_000 };

const redirect = (location: string, cookie?: string): Response =>
  new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    },
  });

/** Back to Settings with what came of it: `connected`, or the code of what to fix (our words are in `PROBLEM_MESSAGES`). */
const settings = (result: string) => `/account?section=data&github=${encodeURIComponent(result)}`;

/** `GET`: to GitHub, to install the App. */
export function appInstall(deps: AppDeps): Response {
  const state = newState();
  const location = `${webOrigin(deps.apiUrl)}/apps/${encodeURIComponent(deps.app.slug)}/installations/new?state=${encodeURIComponent(state)}`;
  return redirect(location, stateCookie(state, secure(deps.url)));
}

/** `GET ?installation_id&code&state`: where GitHub sends the person back. Always clears the state cookie. */
export async function appCallback(
  request: Request,
  accountId: string,
  deps: AppDeps,
): Promise<Response> {
  const clear = clearedStateCookie(secure(deps.url));
  const query = new URL(request.url).searchParams;
  const fail = (problem: ConnectProblem | 'rate_limited') => redirect(settings(problem), clear);

  // First: the same browser that started it, and not a link someone else made.
  if (!stateMatches(cookieValue(request.headers.get('cookie'), STATE_COOKIE), query.get('state')))
    return fail('app_state');

  const taken = await deps.limiter.take(`backup-app:${accountId}`, APP_RATE);
  if (!taken.ok) return fail('rate_limited');

  const code = query.get('code');
  const rawInstallation = query.get('installation_id');
  if (!code) return fail('app_authorize');
  if (!rawInstallation || !/^\d{1,15}$/.test(rawInstallation)) return fail('app_not_yours');
  const installationId = Number(rawInstallation);

  const options: UserOptions = {
    apiUrl: deps.apiUrl,
    clientId: deps.app.clientId,
    clientSecret: deps.app.clientSecret,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  try {
    const userToken = await exchangeCode(options, code, `${deps.url}${REDIRECT_PATH}`);
    if (userToken === undefined) return fail('app_authorize');
    // What proves the installation is the person's: they can reach it, and these are the repositories they can reach in it.
    const reachable = await installationRepositories(options, userToken, installationId);
    if (!reachable.ok) return fail('app_not_yours');
    if (reachable.repositories.length === 0) return fail('app_no_repository');
    if (reachable.repositories.length > 1) return fail('app_choose_one');
    const parsed = parseAddress(
      (reachable.repositories[0] as { fullName: string }).fullName,
      webHostsFor(deps.apiUrl),
    );
    if (!parsed.ok) return fail('app_no_repository');
    const result = await connectInstallation(deps, accountId, installationId, parsed.ref);
    return result.ok ? redirect(settings('connected'), clear) : fail(result.problem);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return fail(error.code === 'rate_limited' ? 'rate_limited' : 'unreachable');
  }
}

// --- The webhook ----------------------------------------------------------------------------------------------------------------------

/** An event is a few hundred bytes to a few kilobytes; a body above this is not one. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export interface WebhookDeps {
  readonly database: InstallationDeps['database'];
  readonly secret: string;
  readonly log?: (line: string) => void;
  /** Told when an installation is gone, so that a token held for it is dropped. */
  readonly forget?: (installationId: number) => void;
}

/** Whether `header` (`sha256=<hex>`) is the HMAC of exactly these bytes under the secret, compared in constant time. */
export function signatureHolds(secret: string, body: Buffer, header: string | null): boolean {
  const match = /^sha256=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(match[1] as string, 'hex'));
}

async function readBytes(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * `POST`: GitHub's event. **Authenticated by the signature over the exact bytes received, and by nothing else**; checked before the body is read as anything.
 * 401 for a signature that does not hold (or none), 413 for a body that is too big, 400 for one that is not JSON, 200 otherwise (an event that is not ours is
 * accepted and ignored). `installation` `deleted` or `suspend`, and `installation_repositories` `removed`, disconnect what they left without access.
 */
export async function webhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const bytes = await readBytes(request, MAX_WEBHOOK_BYTES);
  if (bytes === null) return new Response(null, { status: 413 });
  if (!signatureHolds(deps.secret, bytes, request.headers.get('x-hub-signature-256')))
    return new Response(null, { status: 401 });
  let payload: {
    action?: unknown;
    installation?: { id?: unknown };
    repositories_removed?: { full_name?: unknown }[];
  };
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = request.headers.get('x-github-event');
  const id = payload.installation?.id;
  if (typeof id === 'number' && Number.isSafeInteger(id)) {
    if (
      event === 'installation' &&
      (payload.action === 'deleted' || payload.action === 'suspend')
    ) {
      const removed = await disconnectInstallation(deps.database, id);
      deps.forget?.(id);
      deps.log?.(`[tusk] github app: installation gone, ${removed} connection(s) removed`);
    } else if (event === 'installation_repositories' && payload.action === 'removed') {
      const names = (payload.repositories_removed ?? []).flatMap((each) =>
        typeof each.full_name === 'string' ? [each.full_name] : [],
      );
      const removed = await disconnectInstallation(deps.database, id, names);
      deps.log?.(`[tusk] github app: repositories removed, ${removed} connection(s) removed`);
    }
  }
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export { PROBLEM_MESSAGES };

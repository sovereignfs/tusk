import { ProviderError } from '../providers/types';

/**
 * Asking GitHub who the person is, on the way back from installing the App (DESIGN.md §21.2). **The `installation_id` in the address they come back with is
 * anyone's to type**, so it proves nothing: what proves that the installation is the person's is a token made for them (the `code` the return carries, traded
 * here) that is asked which repositories **of that installation** they can reach. A person who cannot reach it is told no, and nothing is connected. That token
 * is used for this one question and dropped: it is not kept, and not logged.
 */
export interface UserOptions {
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
}

/** GitHub's web address, where its OAuth lives: `github.com`, or an Enterprise Server's own origin (which serves its API and pages from one host). */
export function webOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  return url.hostname === 'api.github.com' ? 'https://github.com' : url.origin;
}

const TIMEOUT = 20_000;

/** The person's token for the `code`, or undefined when GitHub does not accept it (used already, expired, not ours). */
export async function exchangeCode(
  options: UserOptions,
  code: string,
  redirectUri: string,
): Promise<string | undefined> {
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${webOrigin(options.apiUrl)}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'tusk',
      },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    throw new ProviderError('unavailable');
  }
  if (response.status === 429) throw new ProviderError('rate_limited');
  if (!response.ok) throw new ProviderError('unavailable');
  const body = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  return typeof body?.access_token === 'string' && body.access_token !== ''
    ? body.access_token
    : undefined;
}

export type Reachable =
  | { readonly ok: true; readonly repositories: { fullName: string; private: boolean }[] }
  /** The installation is not one this person can reach: not theirs, or not there. */
  | { readonly ok: false };

/** The repositories of one installation that the person can reach. */
export async function installationRepositories(
  options: UserOptions,
  userToken: string,
  installationId: number,
): Promise<Reachable> {
  const fetcher = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `${options.apiUrl}/user/installations/${encodeURIComponent(String(installationId))}/repositories?per_page=100`,
      {
        headers: {
          authorization: `Bearer ${userToken}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'tusk',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
  } catch {
    throw new ProviderError('unavailable');
  }
  if (response.status === 404 || response.status === 403 || response.status === 401)
    return { ok: false };
  if (response.status === 429) throw new ProviderError('rate_limited');
  if (!response.ok) throw new ProviderError('unavailable');
  const body = (await response.json().catch(() => null)) as {
    repositories?: { full_name?: unknown; private?: unknown }[];
  } | null;
  const repositories = (body?.repositories ?? []).flatMap((each) =>
    typeof each.full_name === 'string'
      ? [{ fullName: each.full_name, private: each.private === true }]
      : [],
  );
  return { ok: true, repositories };
}

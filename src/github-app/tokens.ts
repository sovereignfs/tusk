import { createSign } from 'node:crypto';
import { ProviderError } from '../providers/types';

/**
 * Installation tokens (DESIGN.md §21.2). Tusk keeps no token for a repository connected through the App: it keeps which installation, and signs for a token
 * when it needs one. **The JWT** is RS256, made with the App's private key, valid for nine minutes (GitHub allows ten) and dated a minute back for clocks that
 * differ; it is used for one call, to ask for **an installation token**, which GitHub makes good for an hour. That token is held in memory, per installation,
 * until five minutes before it expires, and asked for again after; it is never written anywhere, logged, or put in an error.
 */
export interface TokenOptions {
  readonly appId: string;
  /** The App's private key, PEM. */
  readonly privateKey: string;
  /** GitHub's API address, as `TUSK_GITHUB_API_URL` was checked. */
  readonly apiUrl: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
}

const NINE_MINUTES = 9 * 60;
const MARGIN_MS = 5 * 60_000;

const b64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

export class InstallationTokens {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private readonly sign: (input: string) => string;

  constructor(private readonly options: TokenOptions) {
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch ?? fetch;
    // The key is held in this closure and not in a field that a printout of the object would show.
    const key = options.privateKey;
    this.sign = (input) => createSign('RSA-SHA256').update(input).sign(key, 'base64url');
  }

  /** The App's JWT, for a call that is the App's own. */
  jwt(): string {
    const issued = Math.floor(this.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iat: issued - 60,
        exp: issued - 60 + NINE_MINUTES + 60,
        iss: this.options.appId,
      }),
    );
    return `${head}.${claims}.${this.sign(`${head}.${claims}`)}`;
  }

  /** A token that works for the installation now: the one held, or a new one. Throws `ProviderError` (`not_found` when the installation is gone). */
  async forInstallation(installationId: number): Promise<string> {
    const id = String(installationId);
    const held = this.cache.get(id);
    if (held && held.expiresAt - MARGIN_MS > this.now()) return held.token;

    let response: Response;
    try {
      response = await this.fetcher(
        `${this.options.apiUrl}/app/installations/${encodeURIComponent(id)}/access_tokens`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.jwt()}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'tusk',
          },
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new ProviderError('unavailable');
    }
    if (response.status === 404) {
      this.cache.delete(id);
      throw new ProviderError('not_found');
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('unauthorized');
    if (response.status === 429) throw new ProviderError('rate_limited');
    if (!response.ok) throw new ProviderError('unavailable');
    const body = (await response.json().catch(() => null)) as {
      token?: unknown;
      expires_at?: unknown;
    } | null;
    const expires = typeof body?.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN;
    if (typeof body?.token !== 'string' || !Number.isFinite(expires))
      throw new ProviderError('unavailable');
    this.cache.set(id, { token: body.token, expiresAt: expires });
    return body.token;
  }

  /** Forgets what is held for an installation (it was removed). */
  forget(installationId: number): void {
    this.cache.delete(String(installationId));
  }
}

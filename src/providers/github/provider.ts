import {
  type Commit,
  type CommitRequest,
  type Provider,
  ProviderError,
  type Repository,
  type RepositoryRef,
  checkBranch,
  checkCommit,
  checkRepository,
} from '../types';

/**
 * GitHub, through its REST API (DESIGN.md §21.2). **A commit is made as git makes one:** the files as blobs, a tree on the head's tree, a commit on the head,
 * and a ref update that is a fast-forward and **never forced**, so a branch that moved in the meantime is `head_moved` and nothing visible was written.
 * **A read is retried** after a network failure or a 502, 503 or 504, a few times with a pause; **a write is never retried**, since an answer that was lost
 * may have been applied, and the caller's next backup is a new file. Everything has a timeout. **What is said is ours:** an error is one of
 * `ProviderError`'s codes, built from the status and never from what the host wrote, and neither it nor anything logged here holds the token.
 *
 * `apiUrl` is `https://api.github.com`, or an Enterprise Server's (`TUSK_GITHUB_API_URL`): https, except on localhost, where a test's fake listens.
 */
export interface GitHubOptions {
  readonly token: string;
  readonly apiUrl?: string;
  /** Replaces `fetch`, for a test of what is sent. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** Reads are tried at most this many more times (2 by default). */
  readonly retries?: number;
  /** Waits, for a test that does not want to. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_API_URL = 'https://api.github.com';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Checks an API address: https, or http on this machine, with no credentials, query or fragment. Returns it with no trailing slash. */
export function checkApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('invalid_request');
  }
  const local = LOCAL.has(url.hostname) || url.hostname.endsWith('.localhost');
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProviderError('invalid_request');
  return url.toString().replace(/\/$/, '');
}

const repo = (ref: RepositoryRef) =>
  `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
/** A branch in a ref address: each segment encoded, the slashes kept. */
const branchPath = (branch: string) => branch.split('/').map(encodeURIComponent).join('/');

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

export class GitHubProvider implements Provider {
  private readonly apiUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Held in a closure and not a field, so that it is in no printout of this object and no error. */
  private readonly authorization: () => string;

  constructor(options: GitHubOptions) {
    this.apiUrl = checkApiUrl(options.apiUrl ?? DEFAULT_API_URL);
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const token = options.token;
    this.authorization = () => `Bearer ${token}`;
  }

  /** One request, once. A failure of the network, or a timeout, is `unavailable`. */
  private async once(method: string, path: string, body?: unknown): Promise<Answer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.apiUrl}${path}`, {
        method,
        signal: controller.signal,
        redirect: 'error',
        headers: {
          authorization: this.authorization(),
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'tusk',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        parsed = undefined;
      }
      return { status: response.status, body: parsed, headers: response.headers };
    } catch {
      // Not the error itself: what a transport says can name the address, and an address can hold what it should not.
      throw new ProviderError('unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** A read: tried again after a network failure or a 502, 503 or 504. */
  private async read(path: string): Promise<Answer> {
    for (let attempt = 0; ; attempt++) {
      let answer: Answer | undefined;
      try {
        answer = await this.once('GET', path);
      } catch (error) {
        if (attempt >= this.retries) throw error;
      }
      if (answer && ![502, 503, 504].includes(answer.status)) return this.checked(answer);
      if (answer && attempt >= this.retries) throw new ProviderError('unavailable');
      await this.sleep(200 * 2 ** attempt);
    }
  }

  /** A write: once. */
  private async write(method: string, path: string, body: unknown): Promise<Answer> {
    return this.checked(await this.once(method, path, body));
  }

  /** What an answer is, in our words, from its status and nothing it says. */
  private checked(answer: Answer): Answer {
    const { status, headers } = answer;
    if (status >= 200 && status < 300) return answer;
    const message = messageOf(answer.body);
    if (status === 401) throw new ProviderError('unauthorized');
    if (status === 403 || status === 429) {
      const wait = retryAfter(headers);
      if (status === 429 || wait !== undefined || /rate limit/i.test(message))
        throw new ProviderError('rate_limited', wait ?? 60_000);
      throw new ProviderError('forbidden');
    }
    if (status === 404) throw new ProviderError('not_found');
    if (status === 409)
      throw new ProviderError(/empty/i.test(message) ? 'empty_repository' : 'head_moved');
    if (status === 413) throw new ProviderError('too_large');
    if (status === 422)
      throw new ProviderError(/fast.?forward/i.test(message) ? 'head_moved' : 'invalid_request');
    if (status >= 500) throw new ProviderError('unavailable');
    throw new ProviderError('invalid_request');
  }

  async getRepository(ref: RepositoryRef): Promise<Repository> {
    checkRepository(ref);
    const { body } = await this.read(repo(ref));
    const data = asRecord(body);
    const owner = asRecord(data.owner);
    if (
      typeof data.private !== 'boolean' ||
      typeof data.default_branch !== 'string' ||
      typeof data.name !== 'string'
    )
      throw new ProviderError('unavailable');
    return {
      owner: typeof owner.login === 'string' ? owner.login : ref.owner,
      name: data.name,
      private: data.private,
      defaultBranch: data.default_branch,
    };
  }

  async canWrite(ref: RepositoryRef, branch: string): Promise<boolean> {
    checkRepository(ref);
    checkBranch(branch);
    const data = asRecord((await this.read(repo(ref))).body);
    // An archived repository takes no push, whatever the token may do.
    return asRecord(data.permissions).push === true && data.archived !== true;
  }

  async getHead(ref: RepositoryRef, branch: string): Promise<string> {
    checkRepository(ref);
    checkBranch(branch);
    const { body } = await this.read(`${repo(ref)}/git/ref/heads/${branchPath(branch)}`);
    const sha = asRecord(asRecord(body).object).sha;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha))
      throw new ProviderError('unavailable');
    return sha;
  }

  async commit(ref: RepositoryRef, request: CommitRequest): Promise<Commit> {
    checkRepository(ref);
    checkCommit(request);
    // Where the branch is, from the host: not where the caller last saw it, which is what is being checked.
    const head = await this.getHead(ref, request.branch);
    if (head !== request.expectedHead) throw new ProviderError('head_moved');
    const base = asRecord(
      asRecord((await this.read(`${repo(ref)}/git/commits/${head}`)).body).tree,
    ).sha;
    if (typeof base !== 'string') throw new ProviderError('unavailable');

    const entries: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const change of request.changes) {
      const blob = await this.write('POST', `${repo(ref)}/git/blobs`, {
        content: Buffer.from(change.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      const sha = asRecord(blob.body).sha;
      if (typeof sha !== 'string') throw new ProviderError('unavailable');
      entries.push({ path: change.path, mode: '100644', type: 'blob', sha });
    }
    const tree = asRecord(
      (await this.write('POST', `${repo(ref)}/git/trees`, { base_tree: base, tree: entries })).body,
    ).sha;
    if (typeof tree !== 'string') throw new ProviderError('unavailable');
    const made = asRecord(
      (
        await this.write('POST', `${repo(ref)}/git/commits`, {
          message: request.message,
          tree,
          parents: [head],
        })
      ).body,
    ).sha;
    if (typeof made !== 'string') throw new ProviderError('unavailable');
    // A fast-forward, and never forced: if the branch moved since the head was read, this is refused and nothing of ours is on it.
    await this.write('PATCH', `${repo(ref)}/git/refs/heads/${branchPath(request.branch)}`, {
      sha: made,
      force: false,
    });
    return { sha: made, paths: request.changes.map((change) => change.path) };
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const messageOf = (body: unknown): string => {
  const message = asRecord(body).message;
  return typeof message === 'string' ? message : '';
};

/** When the host asks to be left alone until, in milliseconds from now, from `retry-after` or the limit's reset time. */
function retryAfter(headers: Headers): number | undefined {
  const after = Number(headers.get('retry-after'));
  if (headers.get('retry-after') !== null && Number.isFinite(after))
    return Math.max(0, after) * 1000;
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - Date.now());
    return 60_000;
  }
  return undefined;
}

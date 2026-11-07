import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, createVerify, randomBytes } from 'node:crypto';
import { processEnv } from '../../config/env';
import type { RepositoryRef } from '../types';

/**
 * A GitHub for tests (DESIGN.md §21.2): **an HTTP server whose storage is a real git repository**, one bare repository for each one it is given, driven by
 * the `git` command. It speaks the part of the REST API that `GitHubProvider` uses, as GitHub answers it (a repository with no commit is `409 Git Repository is
 * empty`, a ref update that is not a fast-forward is `422`), so that what is tested is a commit as git makes one, and the result can be looked at with git.
 * It can be told to fail, to be slow, to ask to be left alone, and to **apply a write and then lose the answer**, which is how a provider's rule about not
 * repeating a write is tested. Listens on 127.0.0.1.
 */
const run = (
  gitDir: string,
  args: string[],
  options: { input?: string | Buffer; env?: Record<string, string> } = {},
) =>
  new Promise<{ code: number; out: string }>((resolve, reject) => {
    const child = execFile(
      'git',
      ['--git-dir', gitDir, ...args],
      {
        // The process's own environment (NODE_ENV is among it), with git told to read no system configuration.
        env: {
          ...processEnv(),
          ...options.env,
          GIT_CONFIG_NOSYSTEM: '1',
        } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      },
      (error, stdout) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        if (error && !(typeof (error as { code?: unknown }).code === 'number'))
          return reject(error);
        resolve({ code, out: stdout.toString() });
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Fake',
  GIT_AUTHOR_EMAIL: 'fake@example.test',
  GIT_COMMITTER_NAME: 'Fake',
  GIT_COMMITTER_EMAIL: 'fake@example.test',
};

interface Failure {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  method: string | undefined;
  times: number;
}

export class FakeGitHub {
  readonly requests: { method: string; path: string }[] = [];
  private readonly tokens = new Map<
    string,
    {
      write: boolean;
      only: ReadonlySet<string> | undefined;
      installation?: number;
      expiresAt?: number;
    }
  >();
  private readonly repositories = new Map<
    string,
    { gitDir: string; private: boolean; defaultBranch: string; archived: boolean }
  >();
  /** The GitHub App (§21.2): its key and OAuth client, the installations, and the people who have authorised and the tokens that made. */
  private app:
    { appId: string; publicKey: string; clientId: string; clientSecret: string } | undefined;
  private readonly installations = new Map<
    number,
    { repositories: Set<string>; users: Set<string> }
  >();
  private readonly codes = new Map<string, string>();
  private readonly userTokens = new Map<string, string>();
  /** How many installation tokens have been made, and the lifetime the next gets: a test of what is kept in memory reads and sets these. */
  installationTokensIssued = 0;
  installationTokenLifetimeMs = 60 * 60_000;
  private failures: Failure[] = [];
  private lost: { method: string; times: number }[] = [];
  private slow = 0;

  private constructor(
    private readonly server: Server,
    private readonly directory: string,
    readonly url: string,
  ) {}

  /** Listens on `wanted`, or on any free one: a browser test names it, since the app under test is told the address before the test runs. */
  static async start(wanted = 0): Promise<FakeGitHub> {
    const directory = await mkdtemp(join(tmpdir(), 'fake-github-'));
    const holder: { fake?: FakeGitHub } = {};
    const server = createServer((request, response) => void holder.fake?.handle(request, response));
    await new Promise<void>((resolve) => server.listen(wanted, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    holder.fake = new FakeGitHub(server, directory, `http://127.0.0.1:${port}`);
    return holder.fake;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await rm(this.directory, { recursive: true, force: true });
  }

  /**
   * A token the server accepts, whether it may write, and which repositories it can see: all of them, or only these (what a fine-grained token limited to a
   * repository is). A repository it cannot see is a 404, as GitHub answers it.
   */
  addToken(
    token: string,
    options: { write?: boolean; only?: readonly RepositoryRef[] } = {},
  ): void {
    this.tokens.set(token, {
      write: options.write ?? true,
      only: options.only ? new Set(options.only.map(key)) : undefined,
    });
  }

  /** A repository, with an initial commit of `files` on its default branch, or empty with `files: null`. */
  async createRepository(
    ref: RepositoryRef,
    options: {
      private?: boolean;
      defaultBranch?: string;
      files?: Record<string, string> | null;
      archived?: boolean;
    } = {},
  ): Promise<void> {
    const defaultBranch = options.defaultBranch ?? 'main';
    const gitDir = join(this.directory, ref.owner.toLowerCase(), `${ref.name.toLowerCase()}.git`);
    await mkdir(gitDir, { recursive: true });
    await run(gitDir, ['init', '--bare', '--quiet', `--initial-branch=${defaultBranch}`]);
    this.repositories.set(key(ref), {
      gitDir,
      private: options.private ?? true,
      defaultBranch,
      archived: options.archived ?? false,
    });
    if (options.files !== null)
      await this.commitFiles(
        ref,
        defaultBranch,
        options.files ?? { 'README.md': '# A repository\n' },
        'Initial commit',
      );
  }

  /** Registers the App: its public key (what the JWTs are checked against), its id, and the OAuth client the person is identified through. */
  registerApp(options: {
    appId: string;
    publicKey: string;
    clientId: string;
    clientSecret: string;
  }): void {
    this.app = options;
  }

  /** An installation of the App, on these repositories, which these users (by login) can reach. */
  addInstallation(
    id: number,
    options: { repositories: readonly RepositoryRef[]; users: readonly string[] },
  ): void {
    this.installations.set(id, {
      repositories: new Set(options.repositories.map(key)),
      users: new Set(options.users),
    });
  }

  /** The installation is removed: it makes no more tokens and no one reaches it. The tokens already made stop working too. */
  removeInstallation(id: number): void {
    this.installations.delete(id);
    for (const [token, grant] of this.tokens)
      if (grant.installation === id) this.tokens.delete(token);
  }

  /** A `code` that GitHub would hand back after this user authorised the App: good once. */
  authorizeCode(code: string, user: string): void {
    this.codes.set(code, user);
  }

  setPrivate(ref: RepositoryRef, value: boolean): void {
    const repository = this.repositories.get(key(ref));
    if (repository) repository.private = value;
  }

  /** A commit made by someone else, directly in the repository: the branch is then not where a caller read it. */
  async advance(
    ref: RepositoryRef,
    branch: string,
    files: Record<string, string>,
  ): Promise<string> {
    return this.commitFiles(ref, branch, files, 'Someone else');
  }

  private async commitFiles(
    ref: RepositoryRef,
    branch: string,
    files: Record<string, string>,
    message: string,
  ): Promise<string> {
    const { gitDir } = this.must(ref);
    const head = await run(gitDir, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]);
    const parent = head.code === 0 ? head.out.trim() : undefined;
    const index = join(this.directory, `index-${crypto.randomUUID()}`);
    const env = { GIT_INDEX_FILE: index, ...AUTHOR };
    try {
      if (parent) await run(gitDir, ['read-tree', parent], { env });
      const lines: string[] = [];
      for (const [path, content] of Object.entries(files)) {
        const blob = await run(gitDir, ['hash-object', '-w', '--stdin'], { input: content });
        lines.push(`100644 ${blob.out.trim()}\t${path}`);
      }
      await run(gitDir, ['update-index', '--add', '--index-info'], {
        input: `${lines.join('\n')}\n`,
        env,
      });
      const tree = (await run(gitDir, ['write-tree'], { env })).out.trim();
      const made = (
        await run(gitDir, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], {
          env,
        })
      ).out.trim();
      await run(gitDir, ['update-ref', `refs/heads/${branch}`, made]);
      return made;
    } finally {
      await rm(index, { force: true });
    }
  }

  /** The files a branch has, read with git. */
  async files(ref: RepositoryRef, branch = 'main'): Promise<Record<string, string>> {
    const { gitDir } = this.must(ref);
    const listed = await run(gitDir, ['ls-tree', '-r', '-z', `refs/heads/${branch}`]);
    const out: Record<string, string> = {};
    for (const entry of listed.out.split('\0').filter(Boolean)) {
      const [meta, path] = entry.split('\t') as [string, string];
      const sha = meta.split(' ')[2] as string;
      out[path] = (await run(gitDir, ['cat-file', 'blob', sha])).out;
    }
    return out;
  }

  /** The commit messages of a branch, newest first. */
  async log(ref: RepositoryRef, branch = 'main'): Promise<string[]> {
    const { gitDir } = this.must(ref);
    return (await run(gitDir, ['log', '--format=%s', `refs/heads/${branch}`])).out
      .split('\n')
      .filter(Boolean);
  }

  async head(ref: RepositoryRef, branch = 'main'): Promise<string> {
    return (await run(this.must(ref).gitDir, ['rev-parse', `refs/heads/${branch}`])).out.trim();
  }

  /** Whether the repository is sound, by git's own check. */
  async fsck(ref: RepositoryRef): Promise<boolean> {
    return (await run(this.must(ref).gitDir, ['fsck', '--strict'])).code === 0;
  }

  /** The next `times` requests (of `method`, if given) are answered with this, and do nothing. */
  failNext(
    status: number,
    times = 1,
    options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
  ): void {
    this.failures.push({
      status,
      times,
      method: options.method,
      headers: options.headers ?? {},
      body: options.body ?? { message: 'failure' },
    });
  }

  /** The next `times` requests of `method` are applied, and the connection is cut before the answer: what a provider must not answer by writing again. */
  loseAnswerNext(method: string, times = 1): void {
    this.lost.push({ method, times });
  }

  /** The next request is answered after this many milliseconds. */
  delayNext(ms: number): void {
    this.slow = ms;
  }

  reset(): void {
    this.failures = [];
    this.lost = [];
    this.slow = 0;
    this.requests.length = 0;
  }

  private must(ref: RepositoryRef) {
    const repository = this.repositories.get(key(ref));
    if (!repository) throw new Error('no such repository');
    return repository;
  }

  private send(
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    this.requests.push({ method, path });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    let body: Record<string, unknown>;
    try {
      body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        : {};
    } catch {
      return this.send(response, 400, { message: 'Problems parsing JSON' });
    }
    if (this.slow > 0) {
      const ms = this.slow;
      this.slow = 0;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    const failure = this.failures.find(
      (each) => each.times > 0 && (each.method === undefined || each.method === method),
    );
    if (failure) {
      failure.times -= 1;
      return this.send(response, failure.status, failure.body, failure.headers);
    }

    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];

    // The App's side: the person is identified (a code for a token), the App asks for an installation's token (with its JWT), and the person is asked which
    // repositories of an installation they can reach (with the token they were given).
    if (path === '/login/oauth/access_token' && method === 'POST') {
      const user =
        this.app &&
        body.client_id === this.app.clientId &&
        body.client_secret === this.app.clientSecret
          ? this.codes.get(String(body.code))
          : undefined;
      this.codes.delete(String(body.code));
      if (!user) return this.send(response, 200, { error: 'bad_verification_code' });
      const userToken = `ghu_${randomBytes(12).toString('hex')}`;
      this.userTokens.set(userToken, user);
      return this.send(response, 200, { access_token: userToken, token_type: 'bearer' });
    }
    const minting = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
    if (minting && method === 'POST') {
      if (!token || !this.app || !jwtHolds(token, this.app))
        return this.send(response, 401, { message: 'A JSON web token could not be decoded' });
      const installation = this.installations.get(Number(minting[1]));
      if (!installation) return this.send(response, 404, { message: 'Not Found' });
      const minted = `ghs_${randomBytes(16).toString('hex')}`;
      const expiresAt = Date.now() + this.installationTokenLifetimeMs;
      this.tokens.set(minted, {
        write: true,
        only: installation.repositories,
        installation: Number(minting[1]),
        expiresAt,
      });
      this.installationTokensIssued += 1;
      return this.send(response, 201, {
        token: minted,
        expires_at: new Date(expiresAt).toISOString(),
      });
    }
    const reachable = /^\/user\/installations\/(\d+)\/repositories$/.exec(path);
    if (reachable && method === 'GET') {
      const login = token ? this.userTokens.get(token) : undefined;
      if (!login) return this.send(response, 401, { message: 'Bad credentials' });
      const installation = this.installations.get(Number(reachable[1]));
      if (!installation || !installation.users.has(login))
        return this.send(response, 404, { message: 'Not Found' });
      return this.send(response, 200, {
        total_count: installation.repositories.size,
        repositories: [...installation.repositories].map((name) => ({
          full_name: name,
          name: name.split('/')[1],
          private: this.repositories.get(name)?.private ?? true,
        })),
      });
    }

    const grant = token ? this.tokens.get(token) : undefined;
    if (!grant || (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()))
      return this.send(response, 401, { message: 'Bad credentials' });

    // The repositories the token can reach, as `GET /user/repos` lists them (one page of a hundred).
    if (path === '/user/repos' && method === 'GET') {
      const reachable = [...this.repositories.entries()]
        .filter(([name]) => grant.only === undefined || grant.only.has(name))
        .slice(0, 100)
        .map(([name, each]) => ({
          full_name: name,
          name: name.split('/')[1],
          private: each.private,
        }));
      return this.send(response, 200, reachable);
    }

    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    const asked = match
      ? {
          owner: decodeURIComponent(match[1] as string),
          name: decodeURIComponent(match[2] as string),
        }
      : undefined;
    const repository = asked ? this.repositories.get(key(asked)) : undefined;
    if (!match || !asked || !repository || (grant.only && !grant.only.has(key(asked))))
      return this.send(response, 404, { message: 'Not Found' });
    const rest = match[3] ?? '';
    const { gitDir } = repository;

    const lose = this.lost.find((each) => each.times > 0 && each.method === method);
    const answer = (status: number, payload: unknown) => {
      if (lose) {
        lose.times -= 1;
        // Applied, and the connection is cut before it is said.
        request.socket.destroy();
        return;
      }
      this.send(response, status, payload);
    };

    if (rest === '' && method === 'GET')
      return this.send(response, 200, {
        name: match[2],
        full_name: `${match[1]}/${match[2]}`,
        owner: { login: match[1] },
        private: repository.private,
        default_branch: repository.defaultBranch,
        archived: repository.archived,
        permissions: { admin: false, maintain: false, push: grant.write, pull: true },
      });

    const hasCommits = (await run(gitDir, ['rev-list', '-n1', '--all'])).out.trim() !== '';
    const ref = /^\/git\/(?:ref\/)?heads\/(.+)$/.exec(rest)?.[1];
    if (ref && method === 'GET') {
      if (!hasCommits) return this.send(response, 409, { message: 'Git Repository is empty.' });
      const sha = await run(gitDir, [
        'rev-parse',
        '--verify',
        '-q',
        `refs/heads/${decodeURIComponent(ref)}`,
      ]);
      return sha.code === 0
        ? this.send(response, 200, {
            ref: `refs/heads/${ref}`,
            object: { sha: sha.out.trim(), type: 'commit' },
          })
        : this.send(response, 404, { message: 'Not Found' });
    }
    const commit = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)?.[1];
    if (commit && method === 'GET') {
      const tree = await run(gitDir, ['rev-parse', '--verify', '-q', `${commit}^{tree}`]);
      return tree.code === 0
        ? this.send(response, 200, { sha: commit, tree: { sha: tree.out.trim() } })
        : this.send(response, 404, { message: 'Not Found' });
    }

    // Everything below writes, and a token that may not is told so, as GitHub tells it.
    if (!grant.write)
      return this.send(response, 403, {
        message: 'Resource not accessible by personal access token',
      });
    if (!hasCommits) return this.send(response, 409, { message: 'Git Repository is empty.' });

    if (rest === '/git/blobs' && method === 'POST') {
      const content = Buffer.from(
        String(body.content ?? ''),
        body.encoding === 'base64' ? 'base64' : 'utf8',
      );
      const blob = await run(gitDir, ['hash-object', '-w', '--stdin'], { input: content });
      return answer(201, { sha: blob.out.trim() });
    }
    if (rest === '/git/trees' && method === 'POST') {
      const index = join(this.directory, `index-${crypto.randomUUID()}`);
      const env = { GIT_INDEX_FILE: index };
      try {
        if (typeof body.base_tree === 'string')
          await run(gitDir, ['read-tree', body.base_tree], { env });
        const entries = (body.tree as { path: string; mode: string; sha: string }[]) ?? [];
        await run(gitDir, ['update-index', '--add', '--index-info'], {
          input: `${entries.map((e) => `${e.mode} blob ${e.sha}\t${e.path}`).join('\n')}\n`,
          env,
        });
        const tree = (await run(gitDir, ['write-tree'], { env })).out.trim();
        return answer(201, { sha: tree });
      } finally {
        await rm(index, { force: true });
      }
    }
    if (rest === '/git/commits' && method === 'POST') {
      const parents = (body.parents as string[]) ?? [];
      const made = await run(
        gitDir,
        [
          'commit-tree',
          String(body.tree),
          ...parents.flatMap((p) => ['-p', p]),
          '-m',
          String(body.message ?? ''),
        ],
        { env: AUTHOR },
      );
      return made.code === 0
        ? answer(201, { sha: made.out.trim() })
        : this.send(response, 422, { message: 'Invalid tree' });
    }
    const update = /^\/git\/refs\/heads\/(.+)$/.exec(rest)?.[1];
    if (update && method === 'PATCH') {
      const name = `refs/heads/${decodeURIComponent(update)}`;
      const old = await run(gitDir, ['rev-parse', '--verify', '-q', name]);
      if (old.code !== 0) return this.send(response, 422, { message: 'Reference does not exist' });
      const target = String(body.sha);
      if (body.force !== true) {
        const ancestor = await run(gitDir, ['merge-base', '--is-ancestor', old.out.trim(), target]);
        if (ancestor.code !== 0)
          return this.send(response, 422, { message: 'Update is not a fast forward' });
      }
      // Compare-and-swap, as git's own: a second writer between the check and here is refused.
      const set = await run(gitDir, ['update-ref', name, target, old.out.trim()]);
      return set.code === 0
        ? answer(200, { ref: name, object: { sha: target } })
        : this.send(response, 422, { message: 'Update is not a fast forward' });
    }
    return this.send(response, 404, { message: 'Not Found' });
  }
}

/** Whether a JWT is the App's: RS256 under its key, issued by its id, and valid for no more than ten minutes, as GitHub requires. */
function jwtHolds(jwt: string, app: { appId: string; publicKey: string }): boolean {
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;
  const [head, claims, signature] = parts as [string, string, string];
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'RS256') return false;
    const verified = createVerify('RSA-SHA256')
      .update(`${head}.${claims}`)
      .verify(createPublicKey(app.publicKey), Buffer.from(signature, 'base64url'));
    if (!verified) return false;
    const body = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as {
      iss?: unknown;
      iat?: number;
      exp?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    return (
      String(body.iss) === app.appId &&
      typeof body.iat === 'number' &&
      typeof body.exp === 'number' &&
      body.exp > now &&
      body.exp - body.iat <= 10 * 60
    );
  } catch {
    return false;
  }
}

const key = (ref: RepositoryRef) => `${ref.owner}/${ref.name}`.toLowerCase();

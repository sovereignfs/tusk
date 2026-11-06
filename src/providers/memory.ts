import { createHash } from 'node:crypto';
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
} from './types';

/**
 * A git host in memory (DESIGN.md §21.2): what the app is tested against, and the first of the two providers the contract is run on. It keeps repositories
 * with their commits, each commit a complete tree, and answers as a host does: a branch that is not where the caller read it is `head_moved` and nothing is
 * written; a repository with no commit is `empty_repository`; one that cannot be seen is `not_found`. Commit ids are made from what is committed, as git's
 * are, so the same history is the same ids. Its `token` is checked as a real host checks it, so that a test of a bad one is a test of a real path.
 */
interface StoredCommit {
  readonly sha: string;
  readonly parent: string | null;
  readonly message: string;
  readonly tree: ReadonlyMap<string, string>;
}

interface StoredRepository {
  readonly info: Repository;
  /** Whether this host's credential may push. */
  writable: boolean;
  readonly commits: Map<string, StoredCommit>;
  readonly branches: Map<string, string>;
}

const key = (ref: RepositoryRef) => `${ref.owner}/${ref.name}`.toLowerCase();

const shaOf = (parent: string | null, message: string, tree: ReadonlyMap<string, string>): string =>
  createHash('sha1')
    .update(`commit\n${parent ?? ''}\n${message}\n`)
    .update(JSON.stringify([...tree.entries()].sort(([a], [b]) => (a < b ? -1 : 1))))
    .digest('hex');

export class MemoryProvider implements Provider {
  private readonly repositories: Map<string, StoredRepository>;
  /** The next calls to fail with these, in order: for the tests of what a caller does when a host is unwell. */
  failNext: ProviderError[] = [];
  /** Calls made, by name, so that a test can see that a write was not repeated. */
  readonly calls: string[] = [];

  /**
   * `token` is the credential the host accepts and `presented` the one this provider offers; with no `token` every credential is accepted. A `readOnly` one
   * sees what the host has and may not write.
   */
  constructor(
    private readonly options: {
      token?: string;
      presented?: string;
      readOnly?: boolean;
      only?: ReadonlySet<string>;
    } = {},
    repositories: Map<string, StoredRepository> = new Map(),
  ) {
    this.repositories = repositories;
  }

  /** The same host, reached with another credential: for the tests of one that is not accepted and one that may only read. */
  view(options: {
    presented?: string;
    readOnly?: boolean;
    only?: readonly RepositoryRef[];
  }): MemoryProvider {
    const { only, ...rest } = options;
    return new MemoryProvider(
      { ...this.options, ...rest, ...(only ? { only: new Set(only.map(key)) } : {}) },
      this.repositories,
    );
  }

  /** The messages of a branch's commits, newest first, for a test to look at. */
  messages(ref: RepositoryRef, branch = 'main'): string[] {
    const repository = this.repositories.get(key(ref));
    const out: string[] = [];
    let sha = repository?.branches.get(branch) ?? null;
    while (sha) {
      const commit = repository?.commits.get(sha);
      if (!commit) break;
      out.push(commit.message);
      sha = commit.parent;
    }
    return out;
  }

  /** Makes a repository, with an initial commit of `files` on its default branch unless it is to be empty. */
  create(
    ref: RepositoryRef,
    options: {
      private?: boolean;
      defaultBranch?: string;
      files?: Record<string, string> | null;
      writable?: boolean;
    } = {},
  ): void {
    const defaultBranch = options.defaultBranch ?? 'main';
    const repository: StoredRepository = {
      info: { owner: ref.owner, name: ref.name, private: options.private ?? true, defaultBranch },
      writable: options.writable ?? true,
      commits: new Map(),
      branches: new Map(),
    };
    if (options.files !== null) {
      const tree = new Map(Object.entries(options.files ?? { 'README.md': '# A repository\n' }));
      const sha = shaOf(null, 'Initial commit', tree);
      repository.commits.set(sha, { sha, parent: null, message: 'Initial commit', tree });
      repository.branches.set(defaultBranch, sha);
    }
    this.repositories.set(key(ref), repository);
  }

  /** The files a branch has, for a test to look at. */
  files(ref: RepositoryRef, branch = 'main'): Record<string, string> {
    const repository = this.repositories.get(key(ref));
    const head = repository?.branches.get(branch);
    const commit = head ? repository?.commits.get(head) : undefined;
    return Object.fromEntries(commit?.tree ?? []);
  }

  /** A commit made by someone else, so that the branch is no longer where a caller read it. */
  advance(ref: RepositoryRef, branch: string, files: Record<string, string>): string {
    const repository = this.must(ref);
    const parent = repository.branches.get(branch) ?? null;
    const tree = new Map([
      ...(parent ? (repository.commits.get(parent)?.tree ?? []) : []),
      ...Object.entries(files),
    ]);
    const sha = shaOf(parent, 'Someone else', tree);
    repository.commits.set(sha, { sha, parent, message: 'Someone else', tree });
    repository.branches.set(branch, sha);
    return sha;
  }

  /** The repository made public, as a person may do after connecting it. */
  makePublic(ref: RepositoryRef): void {
    const repository = this.must(ref);
    this.repositories.set(key(ref), {
      ...repository,
      info: { ...repository.info, private: false },
    });
  }

  private must(ref: RepositoryRef): StoredRepository {
    const repository = this.repositories.get(key(ref));
    // A repository this credential was not made for is not there, as a host says it.
    if (!repository || (this.options.only && !this.options.only.has(key(ref))))
      throw new ProviderError('not_found');
    return repository;
  }

  /** What every call does first: the credential, then a failure the test asked for. */
  private enter(call: string): void {
    this.calls.push(call);
    if (this.options.token !== undefined && this.options.presented !== this.options.token)
      throw new ProviderError('unauthorized');
    const failure = this.failNext.shift();
    if (failure) throw failure;
  }

  async getRepository(ref: RepositoryRef): Promise<Repository> {
    this.enter('getRepository');
    checkRepository(ref);
    return { ...this.must(ref).info };
  }

  async canWrite(ref: RepositoryRef, branch: string): Promise<boolean> {
    this.enter('canWrite');
    checkRepository(ref);
    checkBranch(branch);
    return this.must(ref).writable && this.options.readOnly !== true;
  }

  async reachable(): Promise<number> {
    this.enter('reachable');
    const only = this.options.only;
    return Math.min(
      100,
      [...this.repositories.keys()].filter((name) => only === undefined || only.has(name)).length,
    );
  }

  async getHead(ref: RepositoryRef, branch: string): Promise<string> {
    this.enter('getHead');
    checkRepository(ref);
    checkBranch(branch);
    const repository = this.must(ref);
    if (repository.commits.size === 0) throw new ProviderError('empty_repository');
    const head = repository.branches.get(branch);
    if (!head) throw new ProviderError('not_found');
    return head;
  }

  async commit(ref: RepositoryRef, request: CommitRequest): Promise<Commit> {
    this.enter('commit');
    checkRepository(ref);
    checkCommit(request);
    const repository = this.must(ref);
    if (!repository.writable || this.options.readOnly === true)
      throw new ProviderError('forbidden');
    if (repository.commits.size === 0) throw new ProviderError('empty_repository');
    const head = repository.branches.get(request.branch);
    if (!head) throw new ProviderError('not_found');
    if (head !== request.expectedHead) throw new ProviderError('head_moved');
    const tree = new Map(repository.commits.get(head)?.tree ?? []);
    for (const change of request.changes) tree.set(change.path, change.content);
    const sha = shaOf(head, request.message, tree);
    repository.commits.set(sha, { sha, parent: head, message: request.message, tree });
    repository.branches.set(request.branch, sha);
    return { sha, paths: request.changes.map((change) => change.path) };
  }
}

/**
 * A git host, reached only through this (DESIGN.md §21.2): the app never speaks to GitHub itself, so that a host can be replaced and the app is tested against
 * `MemoryProvider` and a fake whose storage is a real git repository. It is small on purpose: what a backup needs, which is to look at a repository, to know
 * whether it may write, to read where a branch is, and to put files on it. **A commit is made as git makes one and is never forced; a write is never retried.**
 * Errors are ours (`ProviderError`), and **no error, log or URL carries a token**.
 */
export interface RepositoryRef {
  readonly owner: string;
  readonly name: string;
}

export interface Repository {
  readonly owner: string;
  readonly name: string;
  /** Whether only invited people can see it: the one thing a backup insists on (DESIGN.md §21.5). */
  readonly private: boolean;
  readonly defaultBranch: string;
}

export type ProviderErrorCode =
  /** The credential is not accepted. */
  | 'unauthorized'
  /** The credential is accepted and may not do this. */
  | 'forbidden'
  /** There is no such repository or branch, or the credential cannot see it: the host says one thing for both. */
  | 'not_found'
  /** The repository has no commit, so there is no branch to put a commit on. */
  | 'empty_repository'
  /** The branch is not where the caller last read it, so nothing was written. */
  | 'head_moved'
  /** What was to be written is more than the host takes. */
  | 'too_large'
  /** The host asks to be left alone for a while: `retryAfterMs` says how long. */
  | 'rate_limited'
  /** The host did not answer, or answered that it is not well. */
  | 'unavailable'
  /** What was asked is not a request this makes (a path that is not one, a branch that is not named). */
  | 'invalid_request';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    /** For `rate_limited`: when to try again, in milliseconds from now. */
    readonly retryAfterMs?: number,
  ) {
    super(`provider: ${code}`);
    this.name = 'ProviderError';
  }
}

/** A file to put on a branch, by its path from the repository's root. */
export interface FileChange {
  readonly path: string;
  readonly content: string;
}

export interface CommitRequest {
  readonly branch: string;
  /** Where the branch was when the caller last read it: the commit is a fast-forward from here, or nothing is written. */
  readonly expectedHead: string;
  readonly message: string;
  readonly changes: readonly FileChange[];
}

export interface Commit {
  /** The new head of the branch. */
  readonly sha: string;
  /** The paths written, as they were asked. */
  readonly paths: readonly string[];
}

export interface Provider {
  /** The repository, if the credential can see it. */
  getRepository(ref: RepositoryRef): Promise<Repository>;
  /** Whether the credential may put a commit on this branch. */
  canWrite(ref: RepositoryRef, branch: string): Promise<boolean>;
  /** The commit a branch is at. `empty_repository` if there is none, `not_found` if the branch is not there. */
  getHead(ref: RepositoryRef, branch: string): Promise<string>;
  /**
   * How many repositories the credential can reach, up to a hundred: a token that was made for one repository reaches one, and a person is told when it
   * reaches more than they meant to give (DESIGN.md §21.2).
   */
  reachable(): Promise<number>;
  /** Puts the files on the branch in one commit on top of `expectedHead`. `head_moved` and nothing written if the branch is elsewhere. */
  commit(ref: RepositoryRef, request: CommitRequest): Promise<Commit>;
}

/** The most a commit's files may come to, in bytes: the size of an export (DESIGN.md §20), with room. */
export const MAX_COMMIT_BYTES = 60 * 1024 * 1024;

/**
 * A path in a repository, checked before it is sent anywhere: relative, with no `..`, no empty or `.` segment, no `.git` segment, no backslash or control
 * character, and not long. A path that is not one is refused as `invalid_request` by every provider, so that a caller cannot reach what it did not mean to.
 */
export function checkPath(path: string): void {
  const segments = path.split('/');
  const bad =
    path === '' ||
    path.length > 255 ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    // eslint-disable-next-line no-control-regex -- a control character in a path is exactly what this refuses
    /[\\\u0000-\u001f\u007f]/.test(path) ||
    segments.some(
      (segment) =>
        segment === '' || segment === '.' || segment === '..' || segment.toLowerCase() === '.git',
    );
  if (bad) throw new ProviderError('invalid_request');
}

/** A repository's owner and name as GitHub allows them, so that nothing else can be put in the address of a request. */
export function checkRepository(ref: RepositoryRef): void {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(ref.owner) ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(ref.name) ||
    ref.name === '.' ||
    ref.name === '..'
  )
    throw new ProviderError('invalid_request');
}

/** A branch name, checked the way git does in the cases that matter here. */
export function checkBranch(branch: string): void {
  const bad =
    branch === '' ||
    branch.length > 255 ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    // eslint-disable-next-line no-control-regex -- as above
    /[\\\u0000- \u007f~^:?*[]/.test(branch);
  if (bad) throw new ProviderError('invalid_request');
}

export function checkCommit(request: CommitRequest): void {
  checkBranch(request.branch);
  if (request.changes.length === 0) throw new ProviderError('invalid_request');
  const seen = new Set<string>();
  let bytes = 0;
  for (const change of request.changes) {
    checkPath(change.path);
    if (seen.has(change.path)) throw new ProviderError('invalid_request');
    seen.add(change.path);
    bytes += Buffer.byteLength(change.content, 'utf8');
  }
  if (!/^[0-9a-f]{40}$/.test(request.expectedHead)) throw new ProviderError('invalid_request');
  if (bytes > MAX_COMMIT_BYTES) throw new ProviderError('too_large');
}

import { describe, expect, it } from 'vitest';
import {
  MAX_COMMIT_BYTES,
  type Provider,
  ProviderError,
  type ProviderErrorCode,
  type RepositoryRef,
} from '../types';

/**
 * What every `Provider` does the same (DESIGN.md §21.2), run against `MemoryProvider` and against `GitHubProvider` over `FakeGitHub`, a real git
 * repository. A host is given as a `Harness`: a provider that is signed in, one that is not, and ways to make a repository, to look inside it, and to move a
 * branch from behind the provider's back. **Each case says what a backup relies on**, and one passing for the memory provider and failing for GitHub's (or the
 * other way about) is a fault in whichever is wrong.
 */
export interface Harness {
  /** A provider whose credential is accepted and may write. */
  readonly provider: Provider;
  /** One whose credential is not accepted. */
  readonly unauthorized: Provider;
  /** One whose credential is accepted and may only read. */
  readonly readOnly: Provider;
  /** What the credential is: it must be in no error. */
  readonly secret: string;
  repository(options?: {
    private?: boolean;
    defaultBranch?: string;
    files?: Record<string, string> | null;
    archived?: boolean;
  }): Promise<RepositoryRef>;
  files(ref: RepositoryRef, branch?: string): Promise<Record<string, string>>;
  messages(ref: RepositoryRef, branch?: string): Promise<string[]>;
  /** A commit by someone else, behind the provider's back. */
  advance(ref: RepositoryRef, branch: string, files: Record<string, string>): Promise<void>;
  makePublic(ref: RepositoryRef): Promise<void>;
}

const code = async (promise: Promise<unknown>): Promise<ProviderError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error('it did not fail');
};
const failsWith = async (promise: Promise<unknown>, expected: ProviderErrorCode) =>
  expect((await code(promise)).code).toBe(expected);

export function describeProviderContract(name: string, harness: () => Harness): void {
  describe(`the provider contract: ${name}`, () => {
    it('says what a repository is: its owner, name, whether it is private, and its default branch', async () => {
      const h = harness();
      const secret = await h.repository({ private: true });
      expect(await h.provider.getRepository(secret)).toEqual({
        owner: secret.owner,
        name: secret.name,
        private: true,
        defaultBranch: 'main',
      });
      const open = await h.repository({ private: false, defaultBranch: 'trunk' });
      expect(await h.provider.getRepository(open)).toMatchObject({
        private: false,
        defaultBranch: 'trunk',
      });
      await h.makePublic(secret);
      expect((await h.provider.getRepository(secret)).private).toBe(false);
    });

    it('is not_found for a repository that is not there, and unauthorized for a credential that is not accepted', async () => {
      const h = harness();
      const real = await h.repository();
      await failsWith(
        h.provider.getRepository({ owner: real.owner, name: 'not-there' }),
        'not_found',
      );
      await failsWith(
        h.provider.getHead({ owner: real.owner, name: 'not-there' }, 'main'),
        'not_found',
      );
      await failsWith(h.unauthorized.getRepository(real), 'unauthorized');
      await failsWith(h.unauthorized.getHead(real, 'main'), 'unauthorized');
      await failsWith(h.unauthorized.canWrite(real, 'main'), 'unauthorized');
    });

    it('says whether the credential may write: it may, and a read-only one may not', async () => {
      const h = harness();
      const ref = await h.repository();
      expect(await h.provider.canWrite(ref, 'main')).toBe(true);
      expect(await h.readOnly.canWrite(ref, 'main')).toBe(false);
      const archived = await h.repository({ archived: true });
      expect(await h.provider.canWrite(archived, 'main')).toBe(false);
    });

    it('tells where a branch is, that a branch is not there, and that a repository with nothing in it has no head', async () => {
      const h = harness();
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      expect(head).toMatch(/^[0-9a-f]{40}$/);
      expect(await h.provider.getHead(ref, 'main')).toBe(head);
      await failsWith(h.provider.getHead(ref, 'nope'), 'not_found');
      const empty = await h.repository({ files: null });
      await failsWith(h.provider.getHead(empty, 'main'), 'empty_repository');
    });

    it('puts files on the branch in one commit on top of the head, and nothing else of the tree changes', async () => {
      const h = harness();
      const ref = await h.repository({
        files: { 'README.md': '# Mine\n', 'notes/a.txt': 'a', 'tusk/old.json': '{"old":true}' },
      });
      const head = await h.provider.getHead(ref, 'main');
      const result = await h.provider.commit(ref, {
        branch: 'main',
        expectedHead: head,
        message: 'Tusk backup 2026-11-06 14:30:00 UTC',
        changes: [
          { path: 'tusk/2026-11-06_14-30-00.json', content: '{"a":"naïve — 日本語 🔐"}\n' },
        ],
      });
      expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(result.sha).not.toBe(head);
      expect(result.paths).toEqual(['tusk/2026-11-06_14-30-00.json']);
      expect(await h.provider.getHead(ref, 'main')).toBe(result.sha);
      expect(await h.files(ref)).toEqual({
        'README.md': '# Mine\n',
        'notes/a.txt': 'a',
        'tusk/old.json': '{"old":true}',
        'tusk/2026-11-06_14-30-00.json': '{"a":"naïve — 日本語 🔐"}\n',
      });
      expect((await h.messages(ref))[0]).toBe('Tusk backup 2026-11-06 14:30:00 UTC');
      expect(await h.messages(ref)).toHaveLength(2);
    });

    it('can put several files in one commit, replace one that is there, and make folders as it goes', async () => {
      const h = harness();
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      await h.provider.commit(ref, {
        branch: 'main',
        expectedHead: head,
        message: 'two',
        changes: [
          { path: 'a/b/c.json', content: '1' },
          { path: 'README.md', content: 'replaced' },
        ],
      });
      expect(await h.files(ref)).toEqual({ 'a/b/c.json': '1', 'README.md': 'replaced' });
      expect(await h.messages(ref)).toHaveLength(2);
    });

    it('is head_moved, with nothing written, when the branch is not where the caller read it: it is never forced', async () => {
      const h = harness();
      const ref = await h.repository();
      const seen = await h.provider.getHead(ref, 'main');
      await h.advance(ref, 'main', { 'theirs.txt': 'theirs' });
      const before = await h.files(ref);
      await failsWith(
        h.provider.commit(ref, {
          branch: 'main',
          expectedHead: seen,
          message: 'mine',
          changes: [{ path: 'tusk/x.json', content: 'x' }],
        }),
        'head_moved',
      );
      expect(await h.files(ref)).toEqual(before);
      expect(await h.messages(ref)).not.toContain('mine');
      // Read again, it goes on top of what is there, theirs kept.
      const now = await h.provider.getHead(ref, 'main');
      await h.provider.commit(ref, {
        branch: 'main',
        expectedHead: now,
        message: 'mine',
        changes: [{ path: 'tusk/x.json', content: 'x' }],
      });
      expect(await h.files(ref)).toMatchObject({ 'theirs.txt': 'theirs', 'tusk/x.json': 'x' });
    });

    it('is empty_repository for a commit to a repository with nothing in it, and forbidden, with nothing written, for a credential that may not write', async () => {
      const h = harness();
      const empty = await h.repository({ files: null });
      await failsWith(
        h.provider.commit(empty, {
          branch: 'main',
          expectedHead: '0'.repeat(40),
          message: 'm',
          changes: [{ path: 'a.txt', content: 'a' }],
        }),
        'empty_repository',
      );
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      const before = await h.files(ref);
      await failsWith(
        h.readOnly.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'a.txt', content: 'a' }],
        }),
        'forbidden',
      );
      expect(await h.files(ref)).toEqual(before);
      await failsWith(
        h.provider.commit(
          { owner: ref.owner, name: 'not-there' },
          {
            branch: 'main',
            expectedHead: head,
            message: 'm',
            changes: [{ path: 'a.txt', content: 'a' }],
          },
        ),
        'not_found',
      );
      await failsWith(
        h.provider.commit(ref, {
          branch: 'nope',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'a.txt', content: 'a' }],
        }),
        'not_found',
      );
    });

    it('refuses a request that is not one before it is sent anywhere: a path that leaves the repository or names git’s own, a branch that is not a name, nothing to write', async () => {
      const h = harness();
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      const before = await h.files(ref);
      const change = (path: string) => ({
        branch: 'main',
        expectedHead: head,
        message: 'm',
        changes: [{ path, content: 'x' }],
      });
      for (const path of [
        '',
        '/etc/passwd',
        '../outside',
        'a/../../b',
        'a//b',
        'a/./b',
        '.git/config',
        'a/.GIT/hooks',
        'a\\b',
        'trail/',
        'ctl\u0007char',
        'x'.repeat(300),
      ])
        await failsWith(h.provider.commit(ref, change(path)), 'invalid_request');
      await failsWith(
        h.provider.commit(ref, { ...change('ok.txt'), branch: '' }),
        'invalid_request',
      );
      await failsWith(
        h.provider.commit(ref, { ...change('ok.txt'), branch: 'a..b' }),
        'invalid_request',
      );
      await failsWith(
        h.provider.commit(ref, { ...change('ok.txt'), branch: 'has space' }),
        'invalid_request',
      );
      await failsWith(
        h.provider.commit(ref, { ...change('ok.txt'), changes: [] }),
        'invalid_request',
      );
      await failsWith(
        h.provider.commit(ref, {
          ...change('ok.txt'),
          changes: [
            { path: 'a', content: '1' },
            { path: 'a', content: '2' },
          ],
        }),
        'invalid_request',
      );
      await failsWith(
        h.provider.commit(ref, { ...change('ok.txt'), expectedHead: 'not a sha' }),
        'invalid_request',
      );
      await failsWith(h.provider.getHead(ref, 'a..b'), 'invalid_request');
      await failsWith(h.provider.getRepository({ owner: '../x', name: 'y' }), 'invalid_request');
      await failsWith(h.provider.getRepository({ owner: 'x', name: '..' }), 'invalid_request');
      expect(await h.files(ref)).toEqual(before);
    });

    it('is too_large for more than a commit may hold, and writes nothing', async () => {
      const h = harness();
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      await failsWith(
        h.provider.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'big.json', content: ' '.repeat(MAX_COMMIT_BYTES + 1) }],
        }),
        'too_large',
      );
      expect(await h.provider.getHead(ref, 'main')).toBe(head);
    });

    it('has the credential in no error, whichever way it fails', async () => {
      const h = harness();
      const ref = await h.repository();
      const head = await h.provider.getHead(ref, 'main');
      const errors = await Promise.all([
        code(h.provider.getRepository({ owner: ref.owner, name: 'not-there' })),
        code(h.unauthorized.getRepository(ref)),
        code(
          h.readOnly.commit(ref, {
            branch: 'main',
            expectedHead: head,
            message: 'm',
            changes: [{ path: 'a', content: 'a' }],
          }),
        ),
        code(
          h.provider.commit(ref, {
            branch: 'main',
            expectedHead: head,
            message: 'm',
            changes: [{ path: '../a', content: 'a' }],
          }),
        ),
        code(h.provider.getHead(ref, 'nope')),
      ]);
      for (const error of errors) {
        const text = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
        expect(text).not.toContain(h.secret);
        expect(text).not.toContain('Bearer');
      }
    });
  });
}

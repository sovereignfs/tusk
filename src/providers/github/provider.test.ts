import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GitHubProvider, checkApiUrl } from './provider';
import { FakeGitHub } from '../testing/fake-github';
import { type Harness, describeProviderContract } from '../testing/contract';
import { ProviderError, type RepositoryRef } from '../types';

/**
 * `GitHubProvider` over `FakeGitHub`, whose storage is a real git repository: it passes the contract the memory provider passes, and then the things that are
 * GitHub's own (DESIGN.md §21.2): a read is tried again and a write never is, a host that asks to be left alone says for how long, and the token is in no error.
 */
const WRITE = 'ghp_PLANTED_write_token_0123456789';
const READ = 'ghp_PLANTED_read_token_0123456789';
const BAD = 'ghp_PLANTED_wrong_token_0123456789';
let fake: FakeGitHub;
let counter = 0;

const make = (
  token: string,
  extra: Partial<ConstructorParameters<typeof GitHubProvider>[0]> = {},
) => new GitHubProvider({ token, apiUrl: fake.url, sleep: async () => undefined, ...extra });

beforeAll(async () => {
  fake = await FakeGitHub.start();
  fake.addToken(WRITE, { write: true });
  fake.addToken(READ, { write: false });
});
afterAll(async () => fake.stop());
beforeEach(() => fake.reset());

const newRef = async (
  options: Parameters<FakeGitHub['createRepository']>[1] = {},
): Promise<RepositoryRef> => {
  const ref = { owner: 'ada', name: `repo-${(counter += 1)}` };
  await fake.createRepository(ref, options);
  return ref;
};

function harness(): Harness {
  return {
    provider: make(WRITE),
    unauthorized: make(BAD),
    readOnly: make(READ),
    secret: WRITE,
    repository: (options) => newRef(options),
    files: (ref, branch) => fake.files(ref, branch),
    messages: (ref, branch) => fake.log(ref, branch),
    advance: async (ref, branch, files) => {
      await fake.advance(ref, branch, files);
    },
    makePublic: async (ref) => fake.setPrivate(ref, false),
  };
}

describeProviderContract('GitHubProvider over FakeGitHub', harness);

const codeOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof ProviderError ? error : String(error)),
  );

describe('GitHubProvider', () => {
  it('leaves a repository that git itself can check, after a commit', async () => {
    const ref = await newRef();
    const provider = make(WRITE);
    const head = await provider.getHead(ref, 'main');
    await provider.commit(ref, {
      branch: 'main',
      expectedHead: head,
      message: 'm',
      changes: [{ path: 'a/b.json', content: '{}' }],
    });
    expect(await fake.fsck(ref)).toBe(true);
    expect(await fake.head(ref)).toBe(await provider.getHead(ref, 'main'));
  });

  it('puts a file that is not text, and one that is large, on the branch whole', async () => {
    const ref = await newRef();
    const provider = make(WRITE);
    const content = 'é'.repeat(200_000) + '\u0000 null and \r\n line ends\n';
    await provider.commit(ref, {
      branch: 'main',
      expectedHead: await provider.getHead(ref, 'main'),
      message: 'm',
      changes: [{ path: 'big.json', content }],
    });
    expect((await fake.files(ref))['big.json']).toBe(content);
  });

  it('tries a read again after a host that is unwell, and says unavailable when it stays so', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { retries: 2 });
    fake.failNext(503, 2, { method: 'GET' });
    expect((await provider.getRepository(ref)).name).toBe(ref.name);
    fake.reset();
    fake.failNext(502, 10, { method: 'GET' });
    expect(await codeOf(provider.getRepository(ref))).toMatchObject({ code: 'unavailable' });
    expect(fake.requests.filter((r) => r.method === 'GET')).toHaveLength(3);
  });

  it('tries a read again after a connection that was cut', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { retries: 2 });
    fake.loseAnswerNext('GET', 1);
    expect((await provider.getRepository(ref)).name).toBe(ref.name);
  });

  it('never repeats a write whose answer was lost: it says unavailable and the caller reads the branch to see', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { retries: 3 });
    const head = await provider.getHead(ref, 'main');
    fake.reset();
    fake.loseAnswerNext('PATCH', 1);
    expect(
      await codeOf(
        provider.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'lost',
          changes: [{ path: 'x.json', content: 'x' }],
        }),
      ),
    ).toMatchObject({ code: 'unavailable' });
    expect(fake.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    expect(
      fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git/commits')),
    ).toHaveLength(1);
    // The write did land, once, and the caller can find that out by reading.
    expect(await fake.log(ref)).toEqual(['lost', 'Initial commit']);
    expect(await provider.getHead(ref, 'main')).not.toBe(head);
  });

  it('does not retry a write that the host refused for being unwell either', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { retries: 3 });
    const head = await provider.getHead(ref, 'main');
    fake.reset();
    fake.failNext(503, 5, { method: 'POST' });
    expect(
      await codeOf(
        provider.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'x', content: 'x' }],
        }),
      ),
    ).toMatchObject({ code: 'unavailable' });
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    expect(await fake.log(ref)).toEqual(['Initial commit']);
  });

  it('is head_moved when the branch moves during the commit, and the branch is never forced', async () => {
    const ref = await newRef();
    const provider = make(WRITE);
    const head = await provider.getHead(ref, 'main');
    // The ref update is refused as GitHub refuses a non-fast-forward.
    fake.reset();
    fake.failNext(422, 1, { method: 'PATCH', body: { message: 'Update is not a fast forward' } });
    expect(
      await codeOf(
        provider.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'x', content: 'x' }],
        }),
      ),
    ).toMatchObject({ code: 'head_moved' });
    expect(await fake.head(ref)).toBe(head);
    for (const request of fake.requests) expect(request.path).not.toContain('force');
  });

  it('never asks for a forced update', async () => {
    const ref = await newRef();
    const provider = make(WRITE);
    const bodies: string[] = [];
    const spying = make(WRITE, {
      fetch: async (input, init) => {
        if (init?.method === 'PATCH') bodies.push(String(init.body));
        return fetch(input, init);
      },
    });
    await spying.commit(ref, {
      branch: 'main',
      expectedHead: await provider.getHead(ref, 'main'),
      message: 'm',
      changes: [{ path: 'x', content: 'x' }],
    });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ force: false });
  });

  it('says how long to wait when the host asks to be left alone', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { retries: 0 });
    fake.failNext(429, 1, { headers: { 'retry-after': '37' } });
    expect(await codeOf(provider.getRepository(ref))).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 37_000,
    });
    const reset = Math.floor(Date.now() / 1000) + 90;
    fake.failNext(403, 1, {
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const limited = await codeOf(provider.getRepository(ref));
    expect(limited).toMatchObject({ code: 'rate_limited' });
    expect((limited as ProviderError).retryAfterMs).toBeGreaterThan(60_000);
    expect((limited as ProviderError).retryAfterMs).toBeLessThanOrEqual(90_000);
  });

  it('is unavailable, not stuck, when the host is slow', async () => {
    const ref = await newRef();
    const provider = make(WRITE, { timeoutMs: 100, retries: 0 });
    fake.delayNext(600);
    expect(await codeOf(provider.getRepository(ref))).toMatchObject({ code: 'unavailable' });
  });

  it('is unavailable when nothing is listening, and says nothing of the address or the token', async () => {
    const provider = new GitHubProvider({
      token: WRITE,
      apiUrl: 'http://127.0.0.1:1',
      retries: 0,
      sleep: async () => undefined,
    });
    const error = await codeOf(provider.getRepository({ owner: 'ada', name: 'r' }));
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(JSON.stringify(error) + String((error as Error).stack)).not.toContain(WRITE);
  });

  it('does not follow a redirect, which would carry the token somewhere else', async () => {
    const ref = await newRef();
    let seen: string | undefined;
    const provider = make(WRITE, {
      retries: 0,
      fetch: async (input, init) => {
        seen = init?.redirect;
        return fetch(input, init);
      },
    });
    await provider.getRepository(ref);
    expect(seen).toBe('error');
  });

  it('has a planted token in no error, no string of the provider, and no request but its own header', async () => {
    const ref = await newRef();
    const provider = make(WRITE);
    const seenAuth: string[] = [];
    const spying = make(WRITE, {
      fetch: async (input, init) => {
        const url = String(input);
        expect(url).not.toContain(WRITE);
        expect(String(init?.body ?? '')).not.toContain(WRITE);
        seenAuth.push(new Headers(init?.headers).get('authorization') ?? '');
        return fetch(input, init);
      },
    });
    await spying.getRepository(ref);
    expect(seenAuth).toEqual([`Bearer ${WRITE}`]);
    for (const text of [
      String(provider),
      JSON.stringify(provider),
      JSON.stringify(Object.entries(provider)),
      JSON.stringify(Object.getOwnPropertyNames(provider)),
    ])
      expect(text).not.toContain(WRITE);
    const errors = [
      await codeOf(make(BAD).getRepository(ref)),
      await codeOf(provider.getRepository({ owner: 'ada', name: 'nope' })),
    ];
    for (const error of errors)
      expect(JSON.stringify(error) + String((error as Error).stack)).not.toContain('PLANTED');
  });
});

describe('checkApiUrl', () => {
  it('takes https, and http only for this machine, with nothing in it but a host and a path', () => {
    expect(checkApiUrl('https://api.github.com')).toBe('https://api.github.com');
    expect(checkApiUrl('https://ghe.example.com/api/v3/')).toBe('https://ghe.example.com/api/v3');
    expect(checkApiUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(checkApiUrl('http://127.0.0.1:9')).toBe('http://127.0.0.1:9');
    for (const bad of [
      'http://api.github.com',
      'http://example.com:80',
      'ftp://x.example.com',
      'https://user:pass@api.github.com',
      'https://api.github.com?x=1',
      'https://api.github.com#frag',
      'not a url',
      '',
    ])
      expect(() => checkApiUrl(bad), bad).toThrow(ProviderError);
  });
});

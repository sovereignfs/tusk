import { describe, expect, it } from 'vitest';
import { MemoryProvider } from './memory';
import { type Harness, describeProviderContract } from './testing/contract';
import { ProviderError } from './types';

/** The provider the app is tested against passes the contract every provider passes, and has the handles a test of the app needs. */
const SECRET = 'memory-token-PLANTED-SECRET';
let counter = 0;

function harness(): Harness {
  const host = new MemoryProvider({ token: SECRET, presented: SECRET });
  return {
    provider: host,
    unauthorized: host.view({ presented: 'not-the-token' }),
    readOnly: host.view({ readOnly: true }),
    only: (ref) => host.view({ only: [ref] }),
    secret: SECRET,
    async repository(options = {}) {
      const ref = { owner: 'ada', name: `repo-${(counter += 1)}` };
      host.create(ref, {
        ...(options.private === undefined ? {} : { private: options.private }),
        ...(options.defaultBranch === undefined ? {} : { defaultBranch: options.defaultBranch }),
        ...(options.files === undefined ? {} : { files: options.files }),
        writable: !options.archived,
      });
      return ref;
    },
    async files(ref, branch = 'main') {
      return host.files(ref, branch);
    },
    async messages(ref, branch = 'main') {
      return host.messages(ref, branch);
    },
    async advance(ref, branch, files) {
      host.advance(ref, branch, files);
    },
    async makePublic(ref) {
      host.makePublic(ref);
    },
  };
}

describeProviderContract('MemoryProvider', harness);

describe('MemoryProvider on its own', () => {
  const ref = { owner: 'ada', name: 'r' };

  it('can be told to fail the next calls, in order, and counts what was called', async () => {
    const host = new MemoryProvider();
    host.create(ref);
    host.failNext = [new ProviderError('rate_limited', 5000), new ProviderError('unavailable')];
    const first = await host.getRepository(ref).catch((e: unknown) => e as ProviderError);
    expect(first).toMatchObject({ code: 'rate_limited', retryAfterMs: 5000 });
    const second = await host.getRepository(ref).catch((e: unknown) => e as ProviderError);
    expect(second).toMatchObject({ code: 'unavailable' });
    expect((await host.getRepository(ref)).name).toBe('r');
    expect(host.calls).toEqual(['getRepository', 'getRepository', 'getRepository']);
  });

  it('makes the same commit ids for the same history, as git does', async () => {
    const make = async () => {
      const host = new MemoryProvider();
      host.create(ref);
      const head = await host.getHead(ref, 'main');
      return (
        await host.commit(ref, {
          branch: 'main',
          expectedHead: head,
          message: 'm',
          changes: [{ path: 'x', content: 'y' }],
        })
      ).sha;
    };
    expect(await make()).toBe(await make());
  });
});

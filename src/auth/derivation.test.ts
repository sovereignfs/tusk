import { signInDerivation } from '@sovereignfs/auth/client';
import { localVault } from '@sovereignfs/sdk/local-vault';
import { AppVault } from '@sovereignfs/sdk/vault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testTarget } from '../db/test-support';
import { type TestAuth, makeAuth } from './test-support';

/**
 * The seed (`scripts/seed.ts`) makes the sign-in value on the server, with the SDK's `localVault`; the page makes it in the browser, with
 * `@sovereignfs/auth`'s `signInDerivation` and the salt `/api/sign-in-salt` serves. **They must be the same value**, or a seeded account
 * would not sign in by hand.
 */
const { leg } = testTarget();
let t: TestAuth;
beforeAll(async () => {
  t = await makeAuth();
  // The page lets itself paint before Argon2id runs; there is no frame to wait for here.
  globalThis.requestAnimationFrame ??= (done: FrameRequestCallback) =>
    Number(setTimeout(() => done(0), 0));
});
afterAll(async () => t.close());

describe(`the sign-in value (${leg})`, () => {
  it('is the same made by the seed and by the page, for the same password, address and vault id', async () => {
    const vaultId = await new AppVault(t.store).vaultId();
    const none = {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
    };
    const seed = await localVault({ clientId: 'tusk', vaultId, backend: none }).derive(
      'the same password',
      'ada@example.test',
    );
    const page = signInDerivation(() =>
      Promise.resolve(new Uint8Array(Buffer.from(vaultId, 'base64url'))),
    );
    expect(await page.signInValue('the same password', 'ada@example.test')).toBe(seed.signIn);
  }, 30_000);
});

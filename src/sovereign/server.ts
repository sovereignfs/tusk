import { coreNotices, type CoreNoticeOptions } from '@sovereignfs/auth/core';
import type { Database as AuthStore } from '@sovereignfs/auth/database';
import { authSettings, getAuth } from '../auth/server';
import type { Database } from '../db/client';
import { getAuthStore, getDatabase } from '../db/boot';
import { type Limiter, RateLimiter } from '../limits/rate';
import { accountOfSub } from './identity';
import { guarded } from './notices';
import { deletePerson } from './people';

export type Notices = {
  backChannelLogout(request: Request): Promise<Response>;
  accountDeleted(request: Request): Promise<Response>;
};

/** What the notices act on: the stores, the sign-in, core's address and Tusk's own deletion. */
export type NoticeWiring = {
  auth: CoreNoticeOptions['auth'];
  authStore: AuthStore;
  database: Database;
  coreUrl: string;
  clientId: string;
  limiter?: Limiter | undefined;
  fetch?: typeof fetch;
};

/**
 * Core's notices for Tusk (`notices.ts`): the package's `coreNotices` on the auth store, with Tusk's deletion of a person (DESIGN.md
 * §28), behind Tusk's guards. Tusk keeps no refresh token of core's (`src/auth/sdk-stores.ts`), so there is none to drop. The server
 * makes it once (`noticeHandlers`); a test makes its own.
 */
export function buildNotices(wiring: NoticeWiring): Notices {
  const { authStore, database } = wiring;
  const handlers = coreNotices({
    database: authStore,
    auth: wiring.auth,
    coreUrl: wiring.coreUrl,
    clientId: wiring.clientId,
    ...(wiring.fetch ? { fetch: wiring.fetch } : {}),
    // Everything of the person here goes, before the notice is answered. A person nobody here knows (never signed in, or already deleted:
    // core sends a deletion until it is answered) is done.
    onAccountDeleted: async (sub) => {
      const accountId = await accountOfSub(authStore, sub);
      if (accountId !== null)
        await deletePerson({ database, authDatabase: authStore, now: Date.now }, accountId);
    },
  });
  return {
    backChannelLogout: guarded(handlers.backChannelLogout, wiring.limiter),
    accountDeleted: guarded(handlers.accountDeleted, wiring.limiter),
  };
}

/**
 * This instance's handlers, or undefined when Sovereign sign-in is not set up, when there is nothing to hear from, and the routes answer
 * 404. Made once, so the limiter's counts are one process's.
 */
const KEY = Symbol.for('tusk.sovereign-notices');
type Holder = { [KEY]?: Promise<Notices | undefined> };

export function noticeHandlers(): Promise<Notices | undefined> {
  const store = globalThis as Holder;
  store[KEY] ??= make().catch((error: unknown) => {
    store[KEY] = undefined;
    throw error;
  });
  return store[KEY];
}

async function make(): Promise<Notices | undefined> {
  const sovereign = authSettings()?.sovereign;
  const auth = await getAuth();
  if (!sovereign || !auth) return undefined;
  const database = await getDatabase();
  return buildNotices({
    auth,
    authStore: await getAuthStore(),
    database,
    coreUrl: sovereign.issuer,
    clientId: sovereign.clientId,
    limiter: new RateLimiter(database),
  });
}

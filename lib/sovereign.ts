import { createSovereign, type Sovereign } from '@sovereignfs/sdk';
import { sessionStore, tokenStore } from './stores';

let client: Sovereign | undefined;

/**
 * The one client for this process. It reads TASKS_URL, TASKS_CORE_URL, TASKS_CORE_CLIENT_ID and TASKS_CORE_CLIENT_SECRET,
 * makes no call to core, and is made when first used, so building the app needs none of them.
 */
export function sovereign(): Sovereign {
  client ??= createSovereign({ prefix: 'TASKS', sessionStore, tokenStore });
  return client;
}

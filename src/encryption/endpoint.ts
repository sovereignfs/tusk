import type { Database } from '../db/client';
import type { Limiter, Rule } from '../limits/rate';
import { readCapped } from '../sync/endpoint';
import { type EncryptionState, readEncryption, setUpPersonalKey, skipKeyOffer } from './state';

/**
 * `/api/encryption` (DESIGN.md §9.1): what a person's key situation is, setting up a key of their own, and skipping the offer. The account is the session's.
 * **What comes in is a public key and nothing secret**, and what goes out is the state; a secret key is never in a request here, and the server has nowhere to
 * put one. In operator-key mode (`TUSK_DB_ENCRYPTION=on`, §9.5) personal keys are not offered to anyone, and setting one up is refused.
 */
export interface EncryptionDeps {
  readonly database: Database;
  readonly limiter: Limiter;
  readonly now: () => number;
  /** `TUSK_DB_ENCRYPTION=on`: the operator manages encryption, and a personal key is not available. */
  readonly operatorEncryption: boolean;
}

const RATE: Rule = { limit: 20, windowMs: 60_000 };
const BODY_BYTES = 512;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

function shown(state: EncryptionState, deps: EncryptionDeps) {
  return {
    mode: state.mode,
    recipient: state.recipient,
    // Whether a personal key can be had on this server at all, and whether this person is to be asked now.
    available: !deps.operatorEncryption,
    offer: !deps.operatorEncryption && state.mode === 'none' && !state.offered,
  };
}

export async function encryptionStatus(accountId: string, deps: EncryptionDeps): Promise<Response> {
  return json(200, shown(await readEncryption(deps.database, accountId), deps));
}

async function counted(accountId: string, deps: EncryptionDeps): Promise<Response | undefined> {
  const taken = await deps.limiter.take(`encryption:${accountId}`, RATE);
  if (taken.ok) return undefined;
  return json(
    429,
    { code: 'RATE_LIMITED' },
    { 'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))) },
  );
}

/** `POST { recipient }`: 200 with the state; 400 for what is not an age public key; 409 when this Desk already has another key; 403 in operator-key mode. */
export async function encryptionSetup(
  request: Request,
  accountId: string,
  deps: EncryptionDeps,
): Promise<Response> {
  if (deps.operatorEncryption) return json(403, { code: 'NOT_AVAILABLE' });
  const body = await readCapped(request, BODY_BYTES);
  if (body === null) return json(413, { code: 'TOO_LARGE' });
  const limited = await counted(accountId, deps);
  if (limited) return limited;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { code: 'BAD_REQUEST' });
  }
  const recipient = (parsed as { recipient?: unknown } | null)?.recipient;
  if (typeof recipient !== 'string') return json(400, { code: 'BAD_REQUEST' });
  const result = await setUpPersonalKey(deps.database, accountId, recipient, deps.now());
  if (result.ok) return json(200, shown(result.state, deps));
  return result.reason === 'invalid'
    ? json(400, { code: 'BAD_REQUEST' })
    : json(409, { code: 'ALREADY_SET_UP' });
}

/** `POST`: the person chose to keep the Desk plain. 200 with the state; 403 in operator-key mode, where nothing is offered. */
export async function encryptionSkip(accountId: string, deps: EncryptionDeps): Promise<Response> {
  if (deps.operatorEncryption) return json(403, { code: 'NOT_AVAILABLE' });
  const limited = await counted(accountId, deps);
  if (limited) return limited;
  return json(200, shown(await skipKeyOffer(deps.database, accountId, deps.now()), deps));
}

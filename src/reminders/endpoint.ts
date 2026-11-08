import type { Database } from '../db/client';
import type { Limiter, Rule } from '../limits/rate';
import { readCapped } from '../sync/endpoint';
import { parseSlots, replaceSlots } from './slots';

/**
 * `PUT /api/reminders/slots` (DESIGN.md §25.2, task 14.6): a device that can read a Desk sealed with a key of its own says when something is due, so that the server can wake it.
 * The account is the session's (`accountRoute`); **the body is the instants and nothing else** (`parseSlots`), and any other key is refused, so a card cannot be named
 * here. For a Desk without a key of its own the server counts the cards itself and this answers `409 NOT_PERSONAL`.
 */
export interface SlotsDeps {
  database: Database;
  limiter: Limiter;
  now(): number;
}

export const SLOTS_RATE: Rule = { limit: 20, windowMs: 60_000 };
/** 700 instants of thirteen digits and a comma, with room over. */
const MAX_BODY = 16 * 1024;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function putSlots(
  request: Request,
  accountId: string,
  deps: SlotsDeps,
): Promise<Response> {
  const taken = await deps.limiter.take(`slots:${accountId}`, SLOTS_RATE);
  if (!taken.ok) return json(429, { code: 'RATE_LIMITED' });
  const body = await readCapped(request, MAX_BODY);
  let value: unknown;
  try {
    value = body === null ? undefined : JSON.parse(body);
  } catch {
    value = undefined;
  }
  const parsed = parseSlots(value, deps.now());
  if (!parsed.ok) return json(400, { code: 'BAD_REQUEST' });
  const result = await replaceSlots(deps.database, accountId, parsed.value);
  return result === 'replaced'
    ? json(200, { slots: parsed.value.length })
    : json(409, { code: 'NOT_PERSONAL' });
}

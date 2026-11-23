import { coreNotices } from '@sovereignfs/auth/core';
import type { Limiter, Rule } from '../limits/rate';

/**
 * Core's two notices (DESIGN.md §15.2, auth.md §8): `POST /api/sovereign/backchannel-logout` and `POST /api/sovereign/account-deleted`. The
 * package's `coreNotices` verifies each (signature, issuer, audience, event, expiry), remembers its `jti` so a replay ends nothing, ends the
 * sessions through better-auth's adapter (of the core session a logout names, or every session of the person) and drops the person's
 * refresh token; an account-deleted notice is answered only once Tusk's own deletion has run. **Tusk adds two guards in front of
 * it**: a notice is a small form, so a body over 16 KB is refused unread, and the routes take no more than 300 notices a minute.
 */
export const MAX_BODY_BYTES = 16 * 1024;
export const NOTICE_RATE: Rule = { limit: 300, windowMs: 60 * 1000 };

export type NoticeHandlers = ReturnType<typeof coreNotices>;

const answer = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** The body, read no further than the limit, or undefined when it is larger. */
async function capped(request: Request): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** One of the package's handlers behind Tusk's guards. */
export function guarded(
  handle: (request: Request) => Promise<Response>,
  limiter: Limiter | undefined,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (limiter) {
      const taken = await limiter.take('sovereign-notice', NOTICE_RATE);
      if (!taken.ok)
        return answer(429, { 'retry-after': String(Math.ceil(taken.retryAfterMs / 1000)) });
    }
    let body: Uint8Array | undefined;
    try {
      body = await capped(request);
    } catch {
      return answer(400);
    }
    if (body === undefined) return answer(413);
    return handle(
      new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: body as BodyInit,
      }),
    );
  };
}

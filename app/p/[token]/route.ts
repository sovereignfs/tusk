import { uuid } from '@/src/access/parse';
import { getDatabase } from '@/src/db/boot';
import { RateLimiter } from '@/src/limits/rate';
import { renderBoard, renderCard, renderNotHere } from '@/src/published/render';
import { readPublished } from '@/src/workspaces/published';

// A published board (DESIGN.md §14.6): read-only, for anyone with the address, signed in or not. It is made on the server as HTML with no script in it and
// with a policy that allows none, `noindex`, never cached, and limited per address. An address that is nothing, one that was taken away and a board that
// was deleted are the same answer. It changes nothing, and shows the work and no people.
export const dynamic = 'force-dynamic';

const PUBLIC_RATE = { limit: 120, windowMs: 60_000 } as const;

const nonce = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');

function html(
  status: number,
  body: (nonce: string) => string,
  extra: Record<string, string> = {},
): Response {
  const n = nonce();
  return new Response(body(n), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
      // No script at all, nothing fetched, nothing framed: the page is text and one stylesheet of its own.
      'content-security-policy': `default-src 'none'; style-src 'nonce-${n}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      ...extra,
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const database = await getDatabase();
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const taken = await new RateLimiter(database).take(`published:${address}`, PUBLIC_RATE);
  if (!taken.ok) {
    return html(429, renderNotHere, {
      'retry-after': String(Math.max(1, Math.ceil(taken.retryAfterMs / 1000))),
    });
  }
  const { token } = await context.params;
  const board = await readPublished(database, token);
  if (!board) return html(404, renderNotHere);
  // A date is shown as it is written, with the year: the reader's own zone is not known here, so nothing is "today".
  const today = '1970-01-01';
  const asked = new URL(request.url).searchParams.get('card');
  if (asked !== null) {
    const id = uuid(asked);
    // A card that is not on this board is not here.
    if (!id.ok || renderCard(board, id.value, 'x', today) === undefined)
      return html(404, renderNotHere);
    const cardId = id.value;
    return html(200, (n) => renderCard(board, cardId, n, today) ?? '');
  }
  return html(200, (n) => renderBoard(board, n, today));
}

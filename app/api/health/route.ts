export const dynamic = 'force-dynamic';

/**
 * The instance asks this before it sends anyone to the app (the manifest's `health`). It answers 200 when the server is up; once there is a
 * database (task 1.5), it answers 200 only when the database does.
 */
export function GET() {
  return new Response('ok', { headers: { 'cache-control': 'no-store' } });
}

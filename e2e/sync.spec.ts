import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * The sync endpoint, as a signed-in device reaches it over HTTP (task 13.2): the built server, a real session, a real database. The rules are held
 * by the data-layer tests on all three databases; this shows that the route is wired to them and that a browser's request is let in as it should be.
 */
const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

/** Signs this request context in, making the first account if there is none. Sign-in is rate limited per address, so a limited attempt waits. */
async function signIn(request: APIRequestContext, origin: string) {
  const headers = { origin };
  const made = await request.post('/api/auth/sign-up/email', {
    headers,
    data: { name: 'Ada', email: EMAIL, password: PASSWORD },
  });
  if (made.ok()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: EMAIL, password: PASSWORD },
    });
    if (reply.ok()) return;
    expect(reply.status()).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 10_500));
  }
  throw new Error('could not sign in');
}

test('a device applies a mutation and is sent it back, and the route is for the signed-in only', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const listId = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const sent = {
    protocol: 1,
    cursor: 0,
    mutations: [
      {
        mutationId,
        changes: [
          {
            table: 'list',
            id: listId,
            position: 'a0',
            fields: { title: { v: 'From a browser test' } },
          },
        ],
      },
    ],
  };

  // Nobody is signed in yet: refused, and no cookie to be had by asking.
  const stranger = await request.post('/api/sync', { headers: { origin }, data: sent });
  expect(stranger.status()).toBe(401);

  await signIn(request, origin);

  // From another site, even signed in: refused.
  const hostile = await request.post('/api/sync', {
    headers: { origin: 'https://evil.example.com' },
    data: sent,
  });
  expect(hostile.status()).toBe(403);

  const reply = await request.post('/api/sync', { headers: { origin }, data: sent });
  expect(reply.status()).toBe(200);
  const answer = await reply.json();
  expect(answer.results).toEqual([{ mutationId, status: 'applied', seq: expect.any(Number) }]);
  const pulled = answer.pull.rows.find((row: { id: string }) => row.id === listId);
  expect(pulled).toMatchObject({ table: 'list', fields: { title: { v: 'From a browser test' } } });

  // Sent again, as a device does after a lost answer: answered the same, and nothing new.
  const again = await (await request.post('/api/sync', { headers: { origin }, data: sent })).json();
  expect(again.results).toEqual(answer.results);

  // A device that speaks another protocol is told to update.
  const old = await request.post('/api/sync', {
    headers: { origin },
    data: { ...sent, protocol: 0 },
  });
  expect(old.status()).toBe(426);
});

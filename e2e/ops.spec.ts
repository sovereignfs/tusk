import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * The door for workspace writes, as a signed-in browser reaches it over HTTP (task 16.1): the built server, a real session, a real database. The rules
 * are held by the role matrix on all three databases; this shows that the route is wired to them and answers each kind of caller as it should.
 */
const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

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

const operation = (extra: Record<string, unknown> = {}) => ({
  opId: crypto.randomUUID(),
  op: 'workspace.create',
  id: crypto.randomUUID(),
  name: 'Acme',
  ...extra,
});

test('a signed-in browser makes and renames a workspace, and is told no for what is not its own', async ({
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  await signIn(request, origin);

  const made = operation();
  const created = await request.post('/api/ops', { headers: { origin }, data: made });
  expect(created.status()).toBe(200);
  expect(await created.json()).toMatchObject({
    status: 'applied',
    rows: { workspace: { id: made.id, name: 'Acme', role: 'owner' } },
  });

  const renamed = await request.post('/api/ops', {
    headers: { origin },
    data: { opId: crypto.randomUUID(), op: 'workspace.rename', id: made.id, name: 'Acme Ltd' },
  });
  expect(await renamed.json()).toMatchObject({
    status: 'applied',
    rows: { workspace: { name: 'Acme Ltd' } },
  });

  // A workspace that is not there, or not this account's, is one answer.
  const elsewhere = await request.post('/api/ops', {
    headers: { origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'workspace.rename',
      id: crypto.randomUUID(),
      name: 'No',
    },
  });
  expect(await elsewhere.json()).toEqual({ status: 'refused', code: 'not_found' });

  // What is not an operation is refused whole.
  const nonsense = await request.post('/api/ops', {
    headers: { origin },
    data: { opId: crypto.randomUUID(), op: 'workspace.destroy' },
  });
  expect(nonsense.status()).toBe(400);
});

test('the door is for the signed-in, and for a request from this app’s own address', async ({
  playwright,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  await signIn(request, origin);

  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  const unsigned = await stranger.post('/api/ops', { headers: { origin }, data: operation() });
  expect(unsigned.status()).toBe(401);
  await stranger.dispose();

  const hostile = await request.post('/api/ops', {
    headers: { origin: 'https://evil.example.com' },
    data: operation(),
  });
  expect(hostile.status()).toBe(403);
  const missing = await request.post('/api/ops', { data: operation() });
  expect(missing.status()).toBe(403);
});

test('a workspace’s people are for the people in it: 401 without a session, and not found for what is not yours', async ({
  playwright,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  await signIn(request, origin);
  const made = operation();
  const done = await request.post('/api/ops', { headers: { origin }, data: made });
  expect(((await done.json()) as { status: string }).status).toBe('applied');

  const mine = await request.get(`/api/workspaces/${made.id}/members`);
  expect(mine.status()).toBe(200);
  const body = (await mine.json()) as {
    people: { name: string; email?: string; role: string; you: boolean }[];
  };
  expect(body.people).toMatchObject([{ name: 'Ada', email: EMAIL, role: 'owner', you: true }]);

  // A workspace that never was and an id that is not one are the same 404 as someone else's.
  expect((await request.get(`/api/workspaces/${crypto.randomUUID()}/members`)).status()).toBe(404);
  expect((await request.get('/api/workspaces/not-an-id/members')).status()).toBe(404);

  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  expect((await stranger.get(`/api/workspaces/${made.id}/members`)).status()).toBe(401);
  await stranger.dispose();
  // Adding by address is the owner's, and an address without an account is said so to them.
  const unknown = await request.post('/api/ops', {
    headers: { origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'member.add',
      workspaceId: made.id,
      email: 'nobody@example.com',
    },
  });
  expect(await unknown.json()).toEqual({
    status: 'refused',
    code: 'invalid',
    reason: 'no_account',
  });
  await request.post('/api/ops', {
    headers: { origin },
    data: { opId: crypto.randomUUID(), op: 'workspace.delete', id: made.id, name: 'Acme' },
  });
});

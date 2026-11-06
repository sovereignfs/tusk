import { expect, test, type APIRequestContext } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Export (task 9.1, DESIGN.md §20.1): the server's part over HTTP with real sessions (who may export what), and the Desk's part in the browser from the
 * device, which works with the network off.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function account(
  request: APIRequestContext,
  origin: string,
  email: string,
  name: string,
): Promise<void> {
  const headers = { origin };
  const made = await request.post('/api/auth/sign-up/email', {
    headers,
    data: { name, email, password: PASSWORD },
  });
  if (made.ok()) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email, password: PASSWORD },
    });
    if (reply.ok()) return;
    expect(reply.status()).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 10_500));
  }
  throw new Error('could not sign in');
}

async function op(request: APIRequestContext, origin: string, body: Record<string, unknown>) {
  const reply = await request.post('/api/ops', {
    headers: { origin },
    data: { opId: crypto.randomUUID(), ...body },
  });
  expect(((await reply.json()) as { status: string }).status, JSON.stringify(body)).toBe('applied');
}

test("the route gives the owner a board, a workspace and what they own as downloads, and refuses what is not a request for one (who may see what is the role matrix's)", async ({
  playwright,
  request,
  baseURL,
}) => {
  const base = baseURL ?? 'http://localhost';
  const origin = new URL(base).origin;
  await account(request, origin, EMAIL, 'Ada');
  const [workspace, board, list, card] = [1, 2, 3, 4].map(() => crypto.randomUUID()) as [
    string,
    string,
    string,
    string,
  ];
  await op(request, origin, { op: 'workspace.create', id: workspace, name: 'Exported' });
  await op(request, origin, {
    op: 'board.create',
    id: board,
    workspaceId: workspace,
    name: 'Roadmap',
    color: '#2563eb',
  });
  await op(request, origin, {
    op: 'list.create',
    id: list,
    boardId: board,
    name: 'Doing',
    position: 'a5',
  });
  await op(request, origin, {
    op: 'card.create',
    id: card,
    listId: list,
    title: 'Ship it',
    position: 'a0',
  });

  // The owner: each scope, named as a download, and the file is what it says it is.
  const mine = await request.get(`/api/export?scope=board&id=${board}`);
  expect(mine.status()).toBe(200);
  expect(mine.headers()['content-disposition']).toMatch(
    /^attachment; filename="tusk-board-\d{4}-\d{2}-\d{2}\.json"$/,
  );
  expect(mine.headers()['cache-control']).toBe('no-store');
  const file = (await mine.json()) as {
    format: string;
    version: number;
    scope: string;
    board: { name: string; lists: { name: string; cards: { title: string }[] }[] };
  };
  expect(file).toMatchObject({
    format: 'tusk',
    version: 1,
    scope: 'board',
    board: { name: 'Roadmap' },
  });
  expect(file.board.lists.flatMap((l) => l.cards.map((c) => c.title))).toEqual(['Ship it']);
  const ws = await request.get(`/api/export?scope=workspace&id=${workspace}`);
  expect(ws.status()).toBe(200);
  const wsFile = (await ws.json()) as {
    workspace: { people: { name: string; email: string; role: string }[] };
  };
  expect(wsFile.workspace.people).toEqual([{ name: 'Ada', email: EMAIL, role: 'owner' }]);
  // Nobody's id is in either file.
  const text = JSON.stringify(file) + JSON.stringify(wsFile);
  expect(text).not.toMatch(/"(accountId|actorId|authorId|userId)"/);
  expect((await request.get('/api/export?scope=owned')).status()).toBe(200);

  // A board that is not there is the same 404 as one that is not theirs.
  expect((await request.get(`/api/export?scope=board&id=${crypto.randomUUID()}`)).status()).toBe(
    404,
  );
  expect(
    (await request.get(`/api/export?scope=workspace&id=${crypto.randomUUID()}`)).status(),
  ).toBe(404);

  // The shape of the request: no scope, an unknown scope, an id that is not one.
  expect((await request.get('/api/export')).status()).toBe(400);
  expect((await request.get('/api/export?scope=everything')).status()).toBe(400);
  expect((await request.get('/api/export?scope=board&id=not-an-id')).status()).toBe(404);
  expect((await request.get('/api/export?scope=board')).status()).toBe(404);

  // No session, no file.
  const stranger = await playwright.request.newContext({ baseURL: base });
  expect((await stranger.get(`/api/export?scope=board&id=${board}`)).status()).toBe(401);
  expect((await stranger.get('/api/export?scope=owned')).status()).toBe(401);
  await stranger.dispose();
});

test('Settings exports the Desk from the device, with the network off, and everything only with it', async ({
  page,
  context,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const name = unique('Exported');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  for (const title of ['write it', 'ship it']) {
    await page.getByLabel('Add a card').fill(title);
    await page.getByLabel('Add a card').press('Enter');
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  }
  // A card with a description and a checklist item, a done card and a deleted one.
  await page.getByRole('link', { name: 'ship it', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByLabel('Description').fill('Before Friday.');
  await detail.getByLabel('Description').blur();
  await detail.getByLabel('Add an item').fill('tag the release');
  await detail.getByLabel('Add an item').press('Enter');
  await expect(detail.getByRole('textbox', { name: 'Item: tag the release' })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('checkbox', { name: 'Done: write it' }).click();
  await page.getByLabel('Add a card').fill('thrown away');
  await page.getByLabel('Add a card').press('Enter');
  await page.getByRole('link', { name: 'thrown away', exact: true }).click();
  await detail.getByRole('button', { name: 'Delete', exact: true }).click();
  // It is written to the device before the page is left.
  await expect(page.getByRole('link', { name: 'thrown away', exact: true })).toHaveCount(0);

  await page.goto('/account?section=data');
  await expect(page.getByRole('heading', { name: 'Export' })).toBeVisible();

  // Online, then offline: the Desk's file is the device's own.
  for (const offline of [false, true]) {
    if (offline) {
      await context.setOffline(true);
    }
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export my Desk' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^tusk-desk-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const file = JSON.parse(await (await import('node:fs/promises')).readFile(path, 'utf8')) as {
      format: string;
      scope: string;
      desk: {
        lists: {
          title: string;
          cards: {
            title: string;
            description: string;
            completedAt: number | null;
            checklist: { title: string }[];
          }[];
        }[];
      };
    };
    expect(file).toMatchObject({ format: 'tusk', scope: 'desk' });
    const list = file.desk.lists.find((each) => each.title === name);
    expect(list?.cards.map((card) => card.title).sort()).toEqual(['ship it', 'write it']);
    const shipped = list?.cards.find((card) => card.title === 'ship it');
    expect(shipped).toMatchObject({
      description: 'Before Friday.',
      checklist: [{ title: 'tag the release' }],
    });
    expect(list?.cards.find((card) => card.title === 'write it')?.completedAt).toEqual(
      expect.any(Number),
    );
    expect(JSON.stringify(file)).not.toContain('thrown away');
  }

  // Everything needs the server: with no network it says so and saves nothing.
  await page.getByRole('button', { name: 'Export everything' }).click();
  await expect(page.getByText(/That needs a connection/)).toBeVisible();
  await context.setOffline(false);
  const [everything] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export everything' }).click(),
  ]);
  expect(everything.suggestedFilename()).toMatch(/^tusk-everything-\d{4}-\d{2}-\d{2}\.json$/);
  const all = JSON.parse(
    await (await import('node:fs/promises')).readFile(await everything.path(), 'utf8'),
  ) as { scope: string; desk: unknown; workspaces: unknown[] };
  expect(all.scope).toBe('everything');
  expect(all.desk).toBeDefined();
  expect(Array.isArray(all.workspaces)).toBe(true);
});

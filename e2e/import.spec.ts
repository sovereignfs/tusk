import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Import (task 9.2, DESIGN.md §20.2): a file is read and checked before anything is written, what it holds is said and the person asked, and it always
 * creates: importing the same file twice makes two copies. A Desk file works with the network off; a board needs the server, which checks it again.
 */
test.use({ viewport: { width: 1280, height: 800 } });

/** Signs in over HTTP, as the account the tests share. */
async function signInApi(request: APIRequestContext, origin: string) {
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

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(
    page.getByRole('navigation', { name: 'Lists' }).getByRole('link').first(),
  ).toBeVisible();
}

async function makeList(page: Page, name: string, cards: string[]) {
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  for (const title of cards) {
    await page.getByLabel('Add a card').fill(title);
    await page.getByLabel('Add a card').press('Enter');
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  }
}

/** From Settings to the Desk by the sidebar, which is a navigation in the app and needs no network. */
const openDesk = (page: Page) => page.getByRole('link', { name: 'Desk', exact: true }).click();
const lists = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) });
const holds = (page: Page) => page.getByRole('status').filter({ hasText: 'This file holds' });
const imported = (page: Page) => page.getByRole('status').filter({ hasText: 'Imported:' });
const importButton = (page: Page) => page.getByRole('button', { name: 'Import', exact: true });

test('a Desk file is read, said and asked about, added and never merged, offline too, and a file that is not good changes nothing', async ({
  page,
  context,
}) => {
  await signedIn(page);
  const name = unique('Imported');
  await makeList(page, name, ['first card', 'second card']);
  await page.goto('/account?section=data');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export my Desk' }).click(),
  ]);
  // The file is the Desk's, cut to the list this test made: importing the whole Desk would copy the account's other lists into the tests that follow.
  const whole = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    desk: { lists: { title: string }[]; series: unknown[] };
  };
  whole.desk.lists = whole.desk.lists.filter((each) => each.title === name);
  whole.desk.series = [];
  const path = join(await mkdtemp(join(tmpdir(), 'tusk-import-')), 'desk.json');
  await writeFile(path, JSON.stringify(whole));
  const input = page.getByLabel('File to import');

  // A file that is not good: said, and nothing changed.
  await input.setInputFiles({
    name: 'nope.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not json'),
  });
  await expect(
    page.getByText(/This file cannot be imported: the file is not JSON\. Nothing was changed\./),
  ).toBeVisible();
  await input.setInputFiles({
    name: 'wrong.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'ical', version: 1 })),
  });
  await expect(page.getByText(/not a Tusk export/)).toBeVisible();
  await expect(importButton(page)).toHaveCount(0);

  // A good one: what it holds is said, and nothing is written until the person says so.
  await input.setInputFiles(path);
  await expect(holds(page)).toContainText('your Desk: 1 list, 2 cards');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/desk');
  await expect(lists(page, name)).toHaveCount(1);

  // Twice makes two copies, and the next can be done with no network.
  await page.goto('/account?section=data');
  await page.getByLabel('File to import').setInputFiles(path);
  await importButton(page).click();
  await expect(imported(page)).toContainText('added to your Desk');
  await openDesk(page);
  await expect(lists(page, name)).toHaveCount(2);
  await page.goto('/account?section=data');
  await context.setOffline(true);
  await page.getByLabel('File to import').setInputFiles(path);
  await expect(holds(page)).toBeVisible();
  await importButton(page).click();
  await expect(imported(page)).toBeVisible();
  await openDesk(page);
  await expect(lists(page, name)).toHaveCount(3);
  await context.setOffline(false);

  // The copies are whole: a list opens with its cards.
  await lists(page, name).nth(2).click();
  await expect(page.getByRole('link', { name: 'first card', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'second card', exact: true })).toBeVisible();
});

test('a board file is put into a workspace the person chooses, by the server', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const [workspace, board, list, card] = [1, 2, 3, 4].map(() => crypto.randomUUID()) as [
    string,
    string,
    string,
    string,
  ];
  const op = async (body: Record<string, unknown>) => {
    const reply = await page.request.post('/api/ops', {
      headers: { origin },
      data: { opId: crypto.randomUUID(), ...body },
    });
    expect(((await reply.json()) as { status: string }).status).toBe('applied');
  };
  const wsName = unique('Receiving');
  await op({ op: 'workspace.create', id: workspace, name: wsName });
  await op({
    op: 'board.create',
    id: board,
    workspaceId: workspace,
    name: 'To copy',
    color: '#2563eb',
  });
  await op({ op: 'list.create', id: list, boardId: board, name: 'Doing', position: 'a5' });
  await op({ op: 'card.create', id: card, listId: list, title: 'Carried over', position: 'a0' });
  const exported = await page.request.get(`/api/export?scope=board&id=${board}`);
  expect(exported.status()).toBe(200);
  const body = Buffer.from(await exported.body());

  await page.goto('/account?section=data');
  await page
    .getByLabel('File to import')
    .setInputFiles({ name: 'board.json', mimeType: 'application/json', buffer: body });
  await expect(holds(page)).toContainText('1 board, 1 card');
  // A board needs a workspace to go into.
  await expect(importButton(page)).toBeDisabled();
  await page.getByLabel('Into which workspace?').selectOption({ label: wsName });
  await importButton(page).click();
  await expect(imported(page)).toContainText('1 board, 1 card');

  const boards = (await (await page.request.get(`/api/workspaces/${workspace}/boards`)).json()) as {
    boards: { name: string }[];
  };
  expect(boards.boards.filter((each) => each.name === 'To copy')).toHaveLength(2);

  // The workspace goes, so that the account's sidebar is as it was for the next test.
  await op({ op: 'workspace.delete', id: workspace, name: wsName });
});

test('the route checks the file again, and takes it only from the signed-in, from this app, within 50 MB', async ({
  playwright,
  request,
  baseURL,
}) => {
  const base = baseURL ?? 'http://localhost';
  const origin = new URL(base).origin;
  await signInApi(request, origin);
  const headers = { origin, 'content-type': 'application/json' };
  const at = new Date().toISOString();

  // Not signed in.
  const stranger = await playwright.request.newContext({ baseURL: base });
  expect((await stranger.post('/api/import', { headers, data: '{}' })).status()).toBe(401);
  await stranger.dispose();

  // From another address, and from none.
  expect(
    (
      await request.post('/api/import', {
        headers: { origin: 'https://evil.example.com' },
        data: '{}',
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/import', { data: '{}' })).status()).toBe(403);

  // A file that is not good is a 400 that says where and never what; a Desk is not for here.
  const bad = await request.post('/api/import', {
    headers,
    data: JSON.stringify({
      format: 'tusk',
      version: 1,
      exportedAt: at,
      scope: 'board',
      board: { id: 'x' },
    }),
  });
  expect(bad.status()).toBe(400);
  expect(((await bad.json()) as { error: string }).error).toMatch(/^board\./);
  const desk = await request.post('/api/import', {
    headers,
    data: JSON.stringify({
      format: 'tusk',
      version: 1,
      exportedAt: at,
      scope: 'desk',
      desk: { lists: [], series: [] },
    }),
  });
  expect(desk.status()).toBe(400);
  expect(((await desk.json()) as { error: string }).error).toMatch(/Desk/);
  expect((await request.post('/api/import', { headers, data: '{ not json' })).status()).toBe(400);

  // A board with no workspace to go into, and one for a workspace that is not there.
  const board = JSON.stringify({
    format: 'tusk',
    version: 1,
    exportedAt: at,
    scope: 'board',
    board: {
      id: crypto.randomUUID(),
      name: 'B',
      color: '#2563eb',
      description: null,
      visibility: 'public',
      archived: false,
      lists: [],
      labels: [],
      activity: [],
    },
  });
  expect((await request.post('/api/import', { headers, data: board })).status()).toBe(400);
  expect(
    (
      await request.post(`/api/import?workspace=${crypto.randomUUID()}`, { headers, data: board })
    ).status(),
  ).toBe(404);

  // Over 50 MB, refused before it is read.
  const big = await request.post('/api/import', { headers, data: ' '.repeat(51 * 1024 * 1024) });
  expect(big.status()).toBe(413);
});

test('the tasks plugin’s file is read as a Desk, says what it changed before anything is written, and its lists and tasks arrive with the repeat working', async ({
  page,
}) => {
  await signedIn(page);
  const stem = unique('Plugin');
  const t = (day: string) => Math.floor(Date.parse(`${day}T09:00:00Z`) / 1000);
  const item = (extra: Record<string, unknown>) => ({
    id: 'x',
    listId: 'l1',
    parentId: null,
    assigneeId: null,
    title: 'A task',
    notes: null,
    favorite: false,
    dueDate: null,
    dueTime: null,
    reminderSentAt: null,
    completedAt: null,
    sortOrder: 0,
    recurrenceRule: null,
    seriesId: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  });
  const file = {
    pluginId: 'fs.sovereign.tasks',
    schemaVersion: 1,
    data: {
      lists: [
        { id: 'l1', title: stem, color: '#16a34a', sortOrder: 1, createdAt: 1, updatedAt: 1 },
      ],
      userListPrefs: [],
      views: [
        {
          id: 'v1',
          listId: 'l1',
          name: 'Board',
          kind: 'board',
          config: '{}',
          isDefault: true,
          sortOrder: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      items: [
        item({ id: 'a', title: `${stem} milk`, notes: 'Oat', favorite: true, sortOrder: 1 }),
        item({
          id: 'b',
          parentId: 'a',
          title: `${stem} oat milk`,
          sortOrder: 1,
          completedAt: t('2026-11-01'),
        }),
        item({
          id: 'c',
          title: `${stem} bins`,
          dueDate: '2026-11-09',
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
          seriesId: 's',
          sortOrder: 2,
        }),
      ],
      notificationPrefs: null,
    },
  };
  await page.goto('/account?section=data');
  await page.getByLabel('File to import').setInputFiles({
    name: 'tasks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(holds(page)).toContainText('your Desk: 1 list, 2 cards');
  // What it changed or left behind is said before anything is written.
  await expect(page.getByText('This is a Sovereign Tasks file')).toBeVisible();
  await expect(page.getByLabel('What was changed')).toContainText('saved view');
  await importButton(page).click();
  await expect(imported(page)).toContainText('1 list, 2 cards added to your Desk');

  await page.goto('/desk');
  await lists(page, stem).click();
  await expect(page.getByRole('link', { name: `${stem} milk`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `${stem} bins`, exact: true })).toBeVisible();
  // The checklist came with the card, and the repeat is a repeat.
  await page.getByRole('link', { name: `${stem} bins`, exact: true }).click();
  // (Not /Repeats/: other specs of the shard leave lists named "Repeats …" on this Desk, in the sidebar and the list picker.)
  await expect(page.getByText('Repeats every week on Monday')).toBeVisible();
});

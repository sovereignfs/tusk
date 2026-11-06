import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * A board and its lists (task 17.1, DESIGN.md §14.1, §14.2, §14.7, §17.5): made from a workspace's tile, with lists added, renamed, moved and deleted, kept
 * after a reload, and read again when it was changed from somewhere else. The account is shared by every test, so each makes a workspace of its own name.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"canvas":{"state":"full","shown":"full"}}'),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create a workspace' })).toBeVisible();
}

/** A workspace, and a board in it, left open. Returns the workspace's name and the board's address. */
async function makeBoard(page: Page, boardName = unique('Roadmap')) {
  const workspace = unique('Acme');
  await page.getByRole('button', { name: 'Create a workspace' }).click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await page.getByRole('button', { name: 'Create board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByLabel('Name').fill(boardName);
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: boardName })).toBeVisible();
  return { workspace, boardName, address: page.url() };
}

/** The board's own button (the Desk's sidebar has one of the same name, with no text). */
const addListButton = (page: Page) => page.locator('button', { hasText: 'Add a list' });

/** The names of the lists on the board, left to right. */
const lists = (page: Page) =>
  page.locator('section[aria-label] [class*="listName"]').allTextContents();

async function addList(page: Page, name: string) {
  await addListButton(page).click();
  await page.getByLabel('Name of the new list').fill(name);
  await page.getByRole('button', { name: 'Add list' }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

/** From the board back to its workspace, which is deleted, so that the next test starts with the sidebar as it was. */
async function cleanUp(page: Page, workspace: string) {
  await page.getByRole('link', { name: workspace, exact: true }).first().click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
  await dialog.getByLabel('Type the name to confirm').fill(workspace);
  await dialog.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toHaveCount(0);
}

test('a board is made from the workspace’s tile with Backlog, its lists are added, renamed, moved and deleted, and it all survives a reload', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  expect(await lists(page)).toEqual(['Backlog']);
  await addList(page, 'Doing');
  await addList(page, 'Done');
  expect(await lists(page)).toEqual(['Backlog', 'Doing', 'Done']);

  // Renamed from its menu.
  await page.getByRole('button', { name: 'List options for Doing' }).click();
  await page.getByRole('menuitem', { name: 'Configure' }).click();
  const configure = page.getByRole('dialog', { name: 'Configure list' });
  await configure.getByLabel('Name').fill('In progress');
  await configure.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'In progress' })).toBeVisible();

  // Moved: one step left from the menu, then to a place by number.
  await page.getByRole('button', { name: 'List options for Done' }).click();
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  await expect.poll(() => lists(page)).toEqual(['Backlog', 'Done', 'In progress']);
  await page.getByRole('button', { name: 'List options for In progress' }).click();
  await page.getByRole('menuitem', { name: 'Move to position…' }).click();
  await page
    .getByRole('dialog', { name: 'Move list' })
    .getByLabel(/Position/)
    .fill('1');
  await page
    .getByRole('dialog', { name: 'Move list' })
    .getByRole('button', { name: 'Move' })
    .click();
  await expect.poll(() => lists(page)).toEqual(['In progress', 'Backlog', 'Done']);

  await page.reload();
  expect(await lists(page)).toEqual(['In progress', 'Backlog', 'Done']);

  // Deleted after asking.
  await page.getByRole('button', { name: 'List options for Done' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete list' }).click();
  await expect.poll(() => lists(page)).toEqual(['In progress', 'Backlog']);
  await page.reload();
  expect(await lists(page)).toEqual(['In progress', 'Backlog']);

  // The board is a tile in its workspace.
  await cleanUp(page, workspace);
});

test('a list is picked up by its title and put down with the keyboard', async ({ page }) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addList(page, 'Doing');
  await addList(page, 'Done');
  const handle = page.getByLabel('Done, drag to reorder');
  await handle.focus();
  // A frame between the keys, as a person's fingers leave: the drag measures where the lists are after each move.
  for (const key of ['Space', 'ArrowLeft', 'ArrowLeft', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => lists(page)).toEqual(['Done', 'Backlog', 'Doing']);
  await page.reload();
  expect(await lists(page)).toEqual(['Done', 'Backlog', 'Doing']);
  await cleanUp(page, workspace);
});

test('a change made from somewhere else shows when the person comes back to the board', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  const board = new URL(page.url()).pathname.split('/').pop() ?? '';
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const made = await page.request.post('/api/ops', {
    headers: { origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'list.create',
      id: crypto.randomUUID(),
      boardId: board,
      name: 'From elsewhere',
      position: 'a5',
    },
  });
  expect(((await made.json()) as { status: string }).status).toBe('applied');
  await expect(page.getByRole('heading', { level: 2, name: 'From elsewhere' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { level: 2, name: 'From elsewhere' })).toBeVisible();
  await cleanUp(page, workspace);
});

test('offline, the board stays as it was, says it needs a connection and changes nothing', async ({
  page,
  context,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await context.setOffline(true);
  await addListButton(page).click();
  await page.getByLabel('Name of the new list').fill('Never made');
  await page.getByRole('button', { name: 'Add list' }).click();
  await expect(page.getByText(/This board needs a connection/)).toBeVisible();
  // It is put back as it was read, and cannot be changed until the connection is back.
  await expect.poll(() => lists(page)).toEqual(['Backlog']);
  await expect(addListButton(page)).toHaveCount(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(addListButton(page)).toBeVisible();
  await cleanUp(page, workspace);
});

test('a board that is not there for this account is the page for what is not here, and its routes say 404', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signedIn(page);
  await page.goto(`/b/${crypto.randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  await page.goto('/b/not-an-id');
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();

  const none = crypto.randomUUID();
  expect((await page.request.get(`/api/boards/${none}`)).status()).toBe(404);
  expect((await page.request.get(`/api/boards/${none}/version`)).status()).toBe(404);
  expect((await page.request.get(`/api/workspaces/${none}/boards`)).status()).toBe(404);
  expect((await page.request.get('/api/boards/not-an-id')).status()).toBe(404);

  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  for (const path of [
    `/api/boards/${none}`,
    `/api/boards/${none}/version`,
    `/api/workspaces/${none}/boards`,
  ])
    expect((await stranger.get(path)).status(), path).toBe(401);
  await stranger.dispose();
});

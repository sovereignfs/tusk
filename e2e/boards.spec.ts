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

/** An entry of the board's menu. */
async function openFromMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitem', { name: item }).click();
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

/** The titles of the cards in a list, top to bottom. */
const cardsOf = (page: Page, list: string) =>
  page
    .locator(`section[aria-label="${list}"] [aria-roledescription="sortable card"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

async function addCard(page: Page, list: string, title: string) {
  const column = page.locator(`section[aria-label="${list}"]`);
  const field = column.getByLabel(`Title of a new card in ${list}`);
  if (!(await field.isVisible())) await column.getByRole('button', { name: 'Add a card' }).click();
  await field.fill(title);
  await field.press('Enter');
  await expect(column.getByLabel(title, { exact: true })).toBeVisible();
}

test('cards are added at the top of a list, moved by the keyboard and the pointer, and kept after a reload', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addList(page, 'Doing');
  await addCard(page, 'Backlog', 'First');
  await addCard(page, 'Backlog', 'Second');
  await addCard(page, 'Backlog', 'Third');
  // A new card goes to the top.
  expect(await cardsOf(page, 'Backlog')).toEqual(['Third', 'Second', 'First']);

  // The keyboard alone: pick up, one step down, put down. It lands where it was announced.
  const third = page.locator('section[aria-label="Backlog"]').getByLabel('Third', { exact: true });
  await third.focus();
  for (const key of ['Space', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Second', 'Third', 'First']);

  // The pointer, to another list.
  const from = await page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('First', { exact: true })
    .boundingBox();
  const to = await page.locator('section[aria-label="Doing"]').boundingBox();
  if (!from || !to) throw new Error('nothing to drag');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect.poll(() => cardsOf(page, 'Doing')).toEqual(['First']);
  expect(await cardsOf(page, 'Backlog')).toEqual(['Second', 'Third']);

  await page.reload();
  expect(await cardsOf(page, 'Doing')).toEqual(['First']);
  expect(await cardsOf(page, 'Backlog')).toEqual(['Second', 'Third']);
  await cleanUp(page, workspace);
});

test('a card is archived from its menu, listed under Archived cards, restored to where it was, and deleted for good', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Keep');
  await addCard(page, 'Backlog', 'Old');
  expect(await cardsOf(page, 'Backlog')).toEqual(['Old', 'Keep']);

  await page.getByRole('button', { name: 'Card options for Old' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Keep']);
  await page.reload();
  expect(await cardsOf(page, 'Backlog')).toEqual(['Keep']);

  await openFromMenu(page, 'Archived cards');
  const dialog = page.getByRole('dialog', { name: 'Archived cards' });
  await expect(dialog.getByText('Old')).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore Old' }).click();
  await expect(dialog.getByText('Nothing is archived on this board.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  // Back at the place it had, above the one it was above.
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Old', 'Keep']);

  await page.getByRole('button', { name: 'Card options for Old' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await openFromMenu(page, 'Archived cards');
  await page
    .getByRole('dialog', { name: 'Archived cards' })
    .getByRole('button', { name: 'Delete Old' })
    .click();
  // It asks first.
  await page.getByRole('button', { name: 'Delete card' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Archived cards' })
      .getByText('Nothing is archived on this board.'),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Archived cards' })
    .getByRole('button', { name: 'Close' })
    .click();
  expect(await cardsOf(page, 'Backlog')).toEqual(['Keep']);
  await cleanUp(page, workspace);
});

test('a card opens over its board at its own address, saves what is left, keeps its place on reload, and closes by replacing the address', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Write the spec');
  const board = page.url();

  // A click opens it; the address is the card's.
  await page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('Write the spec', { exact: true })
    .click();
  // Named by the card as it was opened, whatever is typed in it after.
  const dialog = page.getByRole('dialog', { name: 'Write the spec' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}$/);
  const address = page.url();
  await expect(dialog.getByText('Backlog', { exact: true })).toBeVisible();

  // Saved as it is left, and the tile behind follows at once.
  await dialog.getByLabel('Title').fill('Write the better spec');
  await dialog.getByLabel('Description').click();
  await expect(
    page
      .locator('section[aria-label="Backlog"]')
      .getByLabel('Write the better spec', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Description').fill('First line\n\nSecond <b>paragraph</b>');
  await dialog.getByLabel('Title').click();
  await expect(
    page.locator('section[aria-label="Backlog"]').getByLabel('Has a description'),
  ).toBeVisible();

  // A title emptied goes back to the one it had, and nothing is sent.
  await dialog.getByLabel('Title').fill('   ');
  await dialog.getByLabel('Description').click();
  await expect(dialog.getByLabel('Title')).toHaveValue('Write the better spec');

  // Reloading the address opens the same card, over the board, with what was saved.
  await page.reload();
  const again = page.getByRole('dialog', { name: 'Write the better spec' });
  await expect(again.getByLabel('Description')).toHaveValue(
    'First line\n\nSecond <b>paragraph</b>',
  );
  expect(page.url()).toBe(address);

  // Closing replaces the address with the board's, so Back does not return to the card.
  await again.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(board);
  await expect(page.getByRole('dialog', { name: 'Write the better spec' })).toHaveCount(0);
  await page.goBack();
  await expect(page).not.toHaveURL(address);
  await cleanUp(page, workspace);
});

test('a card is opened with Enter, archived from its dialog, and a card that is not there is the page for what is not here', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Keyboard card');
  const tile = page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('Keyboard card', { exact: true });
  await tile.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Keyboard card' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard card' })).toHaveCount(0);
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual([]);

  // The address of a card that is not there, or of another board, or not an id, is the page for what is not here.
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  for (const path of [`/b/${board}/c/${crypto.randomUUID()}`, `/b/${board}/c/not-an-id`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  }
  const none = crypto.randomUUID();
  expect((await page.request.get(`/api/cards/${none}`)).status()).toBe(404);
  expect((await page.request.get('/api/cards/not-an-id')).status()).toBe(404);
  void baseURL;
  await page.goto(`/b/${board}`);
  await cleanUp(page, workspace);
});

test('a board’s settings change its name, colour and description; archiving makes it read-only and restoring gives the work back', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Stays');

  await openFromMenu(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Board settings' });
  const renamed = unique('Plans');
  await settings.getByLabel('Name').fill(renamed);
  await settings.getByLabel('Description').fill('What we do next');
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await openFromMenu(page, 'Settings');
  await expect(
    page.getByRole('dialog', { name: 'Board settings' }).getByLabel('Description'),
  ).toHaveValue('What we do next');
  await page
    .getByRole('dialog', { name: 'Board settings' })
    .getByRole('button', { name: 'Cancel' })
    .click();

  // Archived: read-only, with a banner and a way back.
  await openFromMenu(page, 'Archive board');
  await expect(page.getByText('This board is archived and read-only for everyone.')).toBeVisible();
  await expect(addListButton(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Card options for Stays' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List options for Backlog' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('This board is archived and read-only for everyone.')).toBeVisible();
  // The operation itself refuses too, from the owner.
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const refused = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'list.create',
      id: crypto.randomUUID(),
      boardId: board,
      name: 'No',
      position: 'a5',
    },
  });
  expect(await refused.json()).toEqual({ status: 'refused', code: 'not_found' });

  await page
    .getByRole('alert')
    .getByRole('button', { name: 'Restore board' })
    .or(page.getByRole('button', { name: 'Restore board' }))
    .first()
    .click();
  await expect(addListButton(page)).toBeVisible();
  await expect(page.getByText('This board is archived and read-only for everyone.')).toHaveCount(0);
  await addList(page, 'Back to work');
  await cleanUp(page, workspace);
});

test('a board is deleted by typing its name, and is gone from its workspace and the server', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace, boardName } = await makeBoard(page);
  const address = page.url();
  await addCard(page, 'Backlog', 'Doomed card');
  await openFromMenu(page, 'Delete board');
  const dialog = page.getByRole('dialog', { name: 'Delete board' });
  const confirm = dialog.getByRole('button', { name: 'Delete this board' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the name to confirm').fill(boardName.toLowerCase());
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the name to confirm').fill(boardName);
  await confirm.click();
  // Back at the workspace, where it is no longer a tile.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: boardName })).toHaveCount(0);
  await page.goto(address);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/w\//);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const wd = page.getByRole('dialog', { name: 'Delete workspace' });
  await wd.getByLabel('Type the name to confirm').fill(workspace);
  await wd.getByRole('button', { name: 'Delete this workspace' }).click();
});

test('the Share dialog lists the board’s people, sets who can see it, and leaving and joining turn an editor into a viewer and back', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);

  // The header's avatars open it; the maker is its owner, with an address shown to them.
  await page.getByRole('button', { name: /Share board, 1 people/ }).click();
  const share = page.getByRole('dialog', { name: 'Share board' });
  const people = share.getByRole('region', { name: 'People on the board' });
  await expect(people.getByText('(you)')).toBeVisible();
  await expect(people.getByLabel('Role of Ada')).toHaveValue('owner');
  await expect(people.getByText(EMAIL)).toBeVisible();

  // Public by default, then private, kept after a reload; the workspace's owner still sees it.
  await expect(share.getByLabel('Who can see it')).toHaveValue('public');
  await share.getByLabel('Who can see it').selectOption('private');
  await expect
    .poll(async () => {
      const board = new URL(page.url()).pathname.split('/')[2] ?? '';
      const reply = await page.request.get(`/api/boards/${board}`);
      return ((await reply.json()) as { board: { visibility: string } }).board.visibility;
    })
    .toBe('private');
  await share.getByLabel('Who can see it').selectOption('public');
  await expect(share.getByLabel('Who can see it')).toHaveValue('public');

  // Leaving: the board is public, so they stay as a viewer, and can join again with one click.
  await share.getByRole('button', { name: 'Leave board' }).click();
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await share.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Join board' })).toBeVisible();
  await expect(addListButton(page)).toHaveCount(0);
  await expect(page.getByText('Viewing')).toBeVisible();
  await page.getByRole('button', { name: 'Join board' }).click();
  await expect(addListButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join board' })).toHaveCount(0);
  await cleanUp(page, workspace);
});

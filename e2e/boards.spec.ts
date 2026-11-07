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
  const handle = page.locator('[aria-roledescription="sortable list"]', { hasText: 'Done' });
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
  // The connection going is enough: the board says so and cannot be changed, with no request to fail first. (The event is sent by hand: not every
  // engine sends it when the test switches the network off.)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/This board needs a connection/)).toBeVisible();
  // It stays as it was read, and cannot be changed until the connection is back.
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
  await settings.getByLabel('Name', { exact: true }).fill(renamed);
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

test('a label is made in a card’s dialog, put on the card as a bar on its tile, taken off, and deleted from the board’s settings', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Labelled');
  await addCard(page, 'Backlog', 'Plain');
  await page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('Labelled', { exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Labelled' });

  // Made and ticked from the card's picker; the tile behind carries a bar and the dialog a chip with its name.
  await dialog.getByRole('button', { name: 'Labels' }).click();
  await page.getByLabel('Label name').fill('Urgent');
  await page.getByRole('button', { name: 'Add label' }).click();
  await page.getByRole('checkbox', { name: 'Label Urgent' }).check();
  await expect(dialog.getByText('Urgent', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Labels' }).click();
  await expect(
    page
      .locator('section[aria-label="Backlog"]')
      .getByLabel('Labelled', { exact: true })
      .getByLabel('Labels: Urgent'),
  ).toBeVisible();
  await expect(
    page
      .locator('section[aria-label="Backlog"]')
      .getByLabel('Plain', { exact: true })
      .getByLabel(/^Labels:/),
  ).toHaveCount(0);

  // Kept after a reload, taken off, and put back for the deletion below.
  await page.reload();
  const again = page.getByRole('dialog', { name: 'Labelled' });
  await expect(again.getByText('Urgent', { exact: true }).first()).toBeVisible();
  await again.getByRole('button', { name: 'Labels' }).click();
  await page.getByRole('checkbox', { name: 'Label Urgent' }).uncheck();
  // Off the card: its chip is gone from the dialog (the picker's rows are in the popover, outside it).
  await expect(again.getByText('Urgent', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Label Urgent' }).check();
  await again.getByRole('button', { name: 'Labels' }).click();
  await again.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByLabel(/^Labels: Urgent/)).toBeVisible();

  // The board's settings list the same labels, and deleting one takes it off every card.
  await openFromMenu(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Board settings' });
  await expect(settings.getByText('Urgent', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Delete label Urgent' }).click();
  await page.getByRole('button', { name: 'Delete label', exact: true }).click();
  await expect(settings.getByText('This board has no labels yet.')).toBeVisible();
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel(/^Labels:/)).toHaveCount(0);

  // The door refuses a label of nobody's board.
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const view = (await (await page.request.get(`/api/boards/${board}`)).json()) as {
    cards: { id: string }[];
  };
  const refused = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'card.addLabel',
      cardId: view.cards[0]?.id,
      labelId: crypto.randomUUID(),
    },
  });
  expect(await refused.json()).toEqual({ status: 'refused', code: 'not_found' });
  await cleanUp(page, workspace);
});

test('a card is assigned to a member of the board from its dialog, shown as an avatar on its tile, and unassigned; a person who is not on the board cannot be', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Assigned');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByLabel('Assigned', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assigned' });

  await dialog.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('checkbox', { name: 'Assign Ada' }).check();
  await dialog.getByRole('button', { name: 'Assignees' }).click();
  await expect(column.getByLabel('Assigned to Ada')).toBeVisible();
  await expect(dialog.getByText('Ada')).toBeVisible();

  // Kept after a reload, and taken off.
  await page.reload();
  await expect(
    page.locator('section[aria-label="Backlog"]').getByLabel('Assigned to Ada'),
  ).toBeVisible();
  const again = page.getByRole('dialog', { name: 'Assigned' });
  await again.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('checkbox', { name: 'Assign Ada' }).uncheck();
  await again.getByRole('button', { name: 'Assignees' }).click();
  await expect(page.getByLabel('Assigned to Ada')).toHaveCount(0);

  // Someone who is not on the board cannot be assigned: the door says why, to someone who may change the card.
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const view = (await (await page.request.get(`/api/boards/${board}`)).json()) as {
    cards: { id: string }[];
  };
  const refused = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'card.assign',
      cardId: view.cards[0]?.id,
      accountId: crypto.randomUUID(),
    },
  });
  expect(await refused.json()).toEqual({
    status: 'refused',
    code: 'invalid',
    reason: 'not_on_board',
  });
  await again.getByRole('button', { name: 'Close' }).click();
  await cleanUp(page, workspace);
});

test('a checklist is added to in a card’s dialog, ticked, reordered and deleted from, the tile’s count following, and kept after a reload', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'With steps');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByLabel('With steps', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'With steps' });
  const checklist = dialog.getByRole('region', { name: 'Checklist' });

  // "Add an item" keeps the cursor: three items typed one after another.
  const field = checklist.getByLabel('Add an item');
  for (const title of ['One', 'Two', 'Three']) {
    await field.fill(title);
    await field.press('Enter');
    await expect(checklist.getByLabel(`Item: ${title}`)).toBeVisible();
  }
  await expect(field).toBeFocused();
  await expect(column.getByLabel('0 of 3 checklist items done')).toBeVisible();

  // Reordered with the keyboard from the item's handle: Three goes to the top, one row written.
  const order = () =>
    checklist
      .getByRole('textbox', { name: /^Item:/ })
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  // A frame, and more, between the keys: the drag measures the list after each, and a loaded machine is slower than a quiet one.
  await checklist.getByRole('button', { name: 'Move Three' }).focus();
  for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(600);
  }
  await expect.poll(order).toEqual(['Three', 'One', 'Two']);

  // Ticking shows on the tile at once.
  await checklist.getByRole('checkbox', { name: 'Done: Two' }).check();
  await expect(column.getByLabel('1 of 3 checklist items done')).toBeVisible();
  await expect(checklist.getByLabel('1 of 3 done')).toBeVisible();

  // Renamed as it is left, and deleted.
  await checklist.getByLabel('Item: Three').fill('Three!');
  await checklist.getByLabel('Item: Three').press('Enter');
  await expect(checklist.getByLabel('Item: Three!')).toBeVisible();
  await checklist.getByRole('button', { name: 'Delete item One' }).click();
  await expect(column.getByLabel('1 of 2 checklist items done')).toBeVisible();

  // Kept in order after a reload.
  await page.reload();
  const again = page
    .getByRole('dialog', { name: 'With steps' })
    .getByRole('region', { name: 'Checklist' });
  await expect(again.getByRole('textbox', { name: /^Item:/ })).toHaveCount(2);
  const titles = await again
    .getByRole('textbox', { name: /^Item:/ })
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(titles).toEqual(['Three!', 'Two']);
  await expect(again.getByRole('checkbox', { name: 'Done: Two' })).toBeChecked();
  await page
    .getByRole('dialog', { name: 'With steps' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(
    page.locator('section[aria-label="Backlog"]').getByLabel('1 of 2 checklist items done'),
  ).toBeVisible();
  await cleanUp(page, workspace);
});

test('a comment is written in a card’s dialog, shown as text with its line breaks, edited and deleted by its author, and counted on the tile', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Talked about');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByLabel('Talked about', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Talked about' });
  const comments = dialog.getByRole('region', { name: 'Comments' });
  await expect(comments.getByText('No comments yet.')).toBeVisible();

  // Markup in a comment is words, not markup; its line breaks stay.
  await comments
    .getByLabel('Write a comment')
    .fill('First line\n<script>window.__ran = true</script>\n<b>bold?</b>');
  await comments.getByRole('button', { name: 'Comment', exact: true }).click();
  const text = comments.locator('p', { hasText: 'First line' });
  await expect(text).toBeVisible();
  await expect(text).toContainText('<script>window.__ran = true</script>');
  await expect(text).toContainText('<b>bold?</b>');
  expect(await text.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran),
  ).toBeUndefined();
  expect(await comments.locator('script, b').count()).toBe(0);
  await expect(comments.getByText('Ada', { exact: true })).toBeVisible();
  await expect(column.getByLabel('1 comments')).toBeVisible();

  // The author edits it, and it says so.
  await comments.getByRole('button', { name: 'Edit comment by Ada' }).click();
  await comments.getByLabel('Edit comment').fill('Changed my mind');
  await comments.getByRole('button', { name: 'Save' }).click();
  await expect(comments.getByText('Changed my mind')).toBeVisible();
  await expect(comments.getByText('· edited')).toBeVisible();

  // Kept after a reload, then deleted after asking.
  await page.reload();
  const again = page
    .getByRole('dialog', { name: 'Talked about' })
    .getByRole('region', { name: 'Comments' });
  await expect(again.getByText('Changed my mind')).toBeVisible();
  await again.getByRole('button', { name: 'Delete comment by Ada' }).click();
  await page.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await expect(again.getByText('No comments yet.')).toBeVisible();
  await expect(page.getByLabel('1 comments')).toHaveCount(0);

  // The door refuses an edit of nobody's comment.
  const refused = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: { opId: crypto.randomUUID(), op: 'comment.edit', id: crypto.randomUUID(), body: 'x' },
  });
  expect(await refused.json()).toEqual({ status: 'refused', code: 'not_found' });
  await page
    .getByRole('dialog', { name: 'Talked about' })
    .getByRole('button', { name: 'Close' })
    .click();
  await cleanUp(page, workspace);
});

test('a board’s activity is a dialog from its menu, a card’s is a tab of its dialog, and Settings has one’s own', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  await addCard(page, 'Backlog', 'Watched');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByLabel('Watched', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Watched' });
  await dialog.getByLabel('Title').fill('Watched closely');
  await dialog.getByLabel('Description').click();

  // The card's own activity, as a tab: made, then renamed.
  await dialog.getByRole('radio', { name: 'Activity' }).click();
  const own = dialog.getByRole('region', { name: 'Activity' });
  await expect(own.getByText('Ada renamed Watched to Watched closely')).toBeVisible();
  await expect(own.getByText('Ada added Watched to Backlog')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The board's, from its menu, with the list and the card in it, newest first.
  await openFromMenu(page, 'Activity');
  const all = page.getByRole('dialog', { name: 'Board activity' });
  const rows = all.getByRole('listitem');
  await expect(rows.first()).toHaveText(/Ada renamed Watched to Watched closely/);
  await expect(all.getByText('Ada created the board')).toBeVisible();
  await all.getByRole('button', { name: 'Close' }).click();

  // Kept as it was after the card is deleted for good; the API still reads it.
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const view = (await (await page.request.get(`/api/boards/${board}`)).json()) as {
    cards: { id: string }[];
  };
  const cardId = view.cards[0]?.id ?? '';
  const origin = new URL(page.url()).origin;
  for (const op of [
    { op: 'card.archive', id: cardId },
    { op: 'card.delete', id: cardId },
  ])
    await page.request.post('/api/ops', {
      headers: { origin },
      data: { opId: crypto.randomUUID(), ...op },
    });
  const after = (await (await page.request.get(`/api/cards/${cardId}/activity`)).json()) as {
    activity: { text: string }[];
  };
  expect(after.activity.map((a) => a.text)).toEqual([
    'Ada deleted Watched closely',
    'Ada archived Watched closely',
    'Ada renamed Watched to Watched closely',
    'Ada added Watched to Backlog',
  ]);

  // Settings has one's own activity, on the boards one can still see.
  await page.goto('/account?section=activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 2 })).toBeVisible();
  await expect(page.getByText('Ada deleted Watched closely').first()).toBeVisible();

  // The routes are for the signed-in, and a cursor is a time and an id.
  expect((await page.request.get('/api/activity?beforeAt=abc&beforeId=x')).status()).toBe(400);
  expect((await page.request.get(`/api/boards/${crypto.randomUUID()}/activity`)).status()).toBe(
    404,
  );
  expect((await page.request.get(`/api/cards/${crypto.randomUUID()}/activity`)).status()).toBe(404);
  await page.goto(`/b/${board}`);
  await cleanUp(page, workspace);
});

test('a card is cloned below itself, and moved to a list of another board of the workspace with its comments and labels', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  const first = new URL(page.url()).pathname.split('/')[2] ?? '';
  const workspaceUrl =
    (await page.getByRole('link', { name: workspace, exact: true }).first().getAttribute('href')) ??
    '';
  await addCard(page, 'Backlog', 'Original');
  // Cloned from the tile's menu: a copy below it, with the same title.
  await page.getByRole('button', { name: 'Card options for Original' }).click();
  await page.getByRole('menuitem', { name: 'Clone' }).click();
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Original', 'Original']);

  // A second board in the same workspace, with its own list.
  await page.goto(workspaceUrl);
  await page.getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByLabel('Name').fill('Elsewhere');
  await page
    .getByRole('dialog', { name: 'Create board' })
    .getByRole('button', { name: 'Create board' })
    .click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  const second = new URL(page.url()).pathname.split('/')[2] ?? '';
  expect(second).not.toBe(first);

  // Back on the first board: a comment and a label on a card, then Move.
  await page.goto(`/b/${first}`);
  await page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('Original', { exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Original' });
  await dialog.getByLabel('Write a comment').fill('Goes along');
  await dialog.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(dialog.getByText('Goes along')).toBeVisible();
  await dialog.getByRole('button', { name: 'Labels' }).click();
  await page.getByLabel('Label name').fill('Travels');
  await page.getByRole('button', { name: 'Add label' }).click();
  await page.getByRole('checkbox', { name: 'Label Travels' }).check();
  await dialog.getByRole('button', { name: 'Labels' }).click();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move card' });
  await move.getByLabel('Board').selectOption({ label: 'Elsewhere' });
  await move.getByRole('button', { name: 'Move', exact: true }).click();

  // It is on the other board with its comment and a label of the same name, and gone from this one.
  await expect(page).toHaveURL(new RegExp(`/b/${first}$`));
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Original']);
  const there = (await (await page.request.get(`/api/boards/${second}`)).json()) as {
    cards: { id: string; comments: number; labels: string[] }[];
    labels: { name: string }[];
  };
  expect(there.cards).toHaveLength(1);
  expect(there.cards[0]?.comments).toBe(1);
  expect(there.labels.map((l) => l.name)).toEqual(['Travels']);
  expect(there.cards[0]?.labels).toHaveLength(1);

  // The door refuses a list that is not the other board's.
  const refused = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'card.moveToBoard',
      id: there.cards[0]?.id,
      boardId: first,
      listId: crypto.randomUUID(),
      position: 'a0',
    },
  });
  expect(await refused.json()).toEqual({ status: 'refused', code: 'not_found' });
  await page.goto(workspaceUrl);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const wd = page.getByRole('dialog', { name: 'Delete workspace' });
  await wd.getByLabel('Type the name to confirm').fill(workspace);
  await wd.getByRole('button', { name: 'Delete this workspace' }).click();
});

test('a board is searched as you type: accents and case do not decide, a line says how many cards are hidden, / finds the field, Esc clears it, and nothing is dragged meanwhile', async ({
  page,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page);
  for (const title of ['Écrire la spec', 'Pay the invoice', 'Fix login'])
    await addCard(page, 'Backlog', title);
  const search = page.getByLabel('Search cards');
  expect(await cardsOf(page, 'Backlog')).toEqual([
    'Fix login',
    'Pay the invoice',
    'Écrire la spec',
  ]);

  // "é" finds "É" and "e"; the others are hidden, and a line says how many.
  await search.fill('ecrire');
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Écrire la spec']);
  await expect(page.getByRole('status').filter({ hasText: '2 cards are hidden' })).toBeVisible();
  await search.fill('É');
  await expect.poll(() => cardsOf(page, 'Backlog')).toEqual(['Pay the invoice', 'Écrire la spec']);
  await expect(page.getByRole('status').filter({ hasText: '1 card is hidden' })).toBeVisible();

  // Nothing is picked up while it is on.
  const tile = page
    .locator('section[aria-label="Backlog"]')
    .getByLabel('Écrire la spec', { exact: true });
  await tile.focus();
  for (const key of ['Space', 'ArrowUp', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(300);
  }
  expect(await cardsOf(page, 'Backlog')).toEqual(['Pay the invoice', 'Écrire la spec']);

  // Esc clears it, and every card is back in its place.
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect
    .poll(() => cardsOf(page, 'Backlog'))
    .toEqual(['Fix login', 'Pay the invoice', 'Écrire la spec']);

  // "/" goes to the field from anywhere that is not a field.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await cleanUp(page, workspace);
});

test('a board is published from its Share dialog, readable signed out with the work and no people, listed in Settings, and taken away for good', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signedIn(page);
  const { workspace } = await makeBoard(page, 'Public plans');
  await addCard(page, 'Backlog', 'Ship the thing');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByLabel('Ship the thing', { exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Ship the thing' });
  await card.getByLabel('Description').fill('Do it\n<b>carefully</b>');
  await card.getByLabel('Title').click();
  await card.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('checkbox', { name: 'Assign Ada' }).check();
  await card.getByRole('button', { name: 'Assignees' }).click();
  await card.getByLabel('Write a comment').fill('A private remark');
  await card.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(card.getByText('A private remark')).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();

  // Published from the Share dialog.
  await page.getByRole('button', { name: /Share board/ }).click();
  const share = page.getByRole('dialog', { name: 'Share board' });
  await share.getByRole('button', { name: 'Publish board' }).click();
  const address = share.getByLabel('Public address');
  await expect(address).toHaveValue(/\/p\/[A-Za-z0-9_-]{43}$/);
  const url = await address.inputValue();
  const path = new URL(url).pathname;
  await share.getByRole('button', { name: 'Close' }).click();

  // Read signed out: a request with no cookies at all.
  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  const open = await stranger.get(path);
  expect(open.status()).toBe(200);
  expect(open.headers()['x-robots-tag']).toContain('noindex');
  expect(open.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(open.headers()['content-security-policy']).not.toContain('script-src');
  const html = await open.text();
  expect(html).toContain('Public plans');
  expect(html).toContain('Ship the thing');
  for (const never of [
    'Ada',
    'owner@example.com',
    'A private remark',
    'Assigned',
    '<script',
    'commented',
  ])
    expect(html, never).not.toContain(never);
  // The card's own page: its description as text.
  const cardId = /href="\?card=([0-9a-f-]{36})"/.exec(html)?.[1] ?? '';
  const detail = await (await stranger.get(`${path}?card=${cardId}`)).text();
  expect(detail).toContain('Do it');
  expect(detail).toContain('&lt;b&gt;carefully&lt;/b&gt;');
  expect(detail).not.toContain('A private remark');
  expect((await stranger.get(`${path}?card=${crypto.randomUUID()}`)).status()).toBe(404);
  expect((await stranger.get('/p/' + 'A'.repeat(43))).status()).toBe(404);
  expect((await stranger.get('/p/short')).status()).toBe(404);

  // In a browser, signed out, it is a page.
  const anonymous = await page
    .context()
    .browser()
    ?.newContext({ baseURL: baseURL ?? 'http://localhost' });
  const tab = await anonymous?.newPage();
  await tab?.goto(path);
  await expect(
    tab?.getByRole('heading', { name: 'Public plans' }) ?? page.locator('nothing'),
  ).toBeVisible();
  await anonymous?.close();

  // Listed in Settings > Data.
  await page.goto('/account?section=data');
  await expect(page.getByRole('heading', { name: 'Published boards' })).toBeVisible();
  await expect(page.getByText(url)).toBeVisible();

  // Taken away: the address is nothing at once, and publishing again makes a different one.
  await page.goBack();
  await page.getByRole('button', { name: /Share board/ }).click();
  await page
    .getByRole('dialog', { name: 'Share board' })
    .getByRole('button', { name: 'Unpublish' })
    .click();
  await page.getByRole('button', { name: 'Unpublish', exact: true }).last().click();
  await expect(
    page
      .getByRole('dialog', { name: 'Share board' })
      .getByRole('button', { name: 'Publish board' }),
  ).toBeVisible();
  expect((await stranger.get(path)).status()).toBe(404);
  await page
    .getByRole('dialog', { name: 'Share board' })
    .getByRole('button', { name: 'Publish board' })
    .click();
  const again = await page
    .getByRole('dialog', { name: 'Share board' })
    .getByLabel('Public address')
    .inputValue();
  expect(new URL(again).pathname).not.toBe(path);
  expect((await stranger.get(path)).status()).toBe(404);
  expect((await stranger.get(new URL(again).pathname)).status()).toBe(200);
  await stranger.dispose();

  // A deleted board's address is nothing.
  await page
    .getByRole('dialog', { name: 'Share board' })
    .getByRole('button', { name: 'Close' })
    .click();
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const gone = await page.request.post('/api/ops', {
    headers: { origin: new URL(page.url()).origin },
    data: { opId: crypto.randomUUID(), op: 'board.delete', id: board, name: 'Public plans' },
  });
  expect(((await gone.json()) as { status: string }).status).toBe('applied');
  const after = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  expect((await after.get(new URL(again).pathname)).status()).toBe(404);
  await after.dispose();
  await page.goto('/boards');
  await page
    .getByRole('region', { name: 'My workspaces' })
    .getByRole('region', { name: workspace })
    .getByRole('link', { name: workspace, exact: true })
    .click();
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const wd = page.getByRole('dialog', { name: 'Delete workspace' });
  await wd.getByLabel('Type the name to confirm').fill(workspace);
  await wd.getByRole('button', { name: 'Delete this workspace' }).click();
});

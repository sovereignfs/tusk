import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, deskReady, ensureAccount, trySignIn } from './helpers';

/**
 * Working offline (task 13.6, DESIGN.md §8.6): a page loaded with the network already off does every Desk action, shows no error for being offline, and
 * what was done is on a second device once the network is back. A board shows what it had, read-only, and says why.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await deskReady(page, page.getByRole('navigation', { name: 'Lists' }).getByRole('link'));
}

/** The worker has installed and kept the shell, so that an address can be opened with no network. */
async function workerReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        for (const name of (await caches.keys()).filter((each) => each.startsWith('tusk-shell-')))
          if (await (await caches.open(name)).match('/shell')) return true;
        return false;
      }),
    )
    .toBe(true);
}

const rows = (page: Page) =>
  page
    .getByRole('list')
    .filter({ has: page.getByRole('checkbox') })
    .first()
    .getByRole('listitem');
const titles = async (page: Page) =>
  (await rows(page).getByRole('link').allInnerTexts()).map((text) => text.trim());
const link = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true });

test('a page loaded offline does every Desk action with no error, and a second device has them when the network is back', async ({
  page,
  context,
  browser,
}) => {
  await signedIn(page);
  const name = unique('Kept');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  for (const title of ['one', 'two', 'three']) {
    await page.getByLabel('Add a card').fill(title);
    await page.getByLabel('Add a card').press('Enter');
    await expect(link(page, title)).toBeVisible();
  }
  const desk = page.url();
  await workerReady(page);

  // The network goes, and the page is loaded with it off: the Desk comes from the device.
  await context.setOffline(true);
  await page.goto(desk);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // Read.
  await expect.poll(() => titles(page)).toEqual(['three', 'two', 'one']);

  // Add.
  await page.getByLabel('Add a card').fill('four');
  await page.getByLabel('Add a card').press('Enter');
  await expect.poll(() => titles(page)).toEqual(['four', 'three', 'two', 'one']);

  // Edit: a new title and a description, a star and a due date.
  await link(page, 'two').click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByLabel('Title').fill('two, edited');
  await detail.getByLabel('Description').fill('Written with no network.');
  await detail.getByLabel('Title').press('Enter');
  await detail.getByLabel('Description').blur();
  await detail.getByRole('button', { name: 'Set a due date' }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: /^Tomorrow/ })).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(link(page, 'two, edited')).toBeVisible();
  await rows(page)
    .filter({ has: link(page, 'two, edited') })
    .getByRole('button', { name: 'Star' })
    .click();

  // Mark in progress.
  await link(page, 'three').click();
  await detail.getByRole('radio', { name: 'In progress' }).click();
  await expect(detail.getByRole('radio', { name: 'In progress' })).toBeChecked();
  await detail.getByRole('button', { name: 'Close' }).click();

  // Complete.
  await page.getByRole('checkbox', { name: 'Done: one' }).click();
  await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();

  // Reorder with the keyboard: four goes down one place.
  await expect.poll(() => titles(page)).toEqual(['four', 'three', 'two, edited']);
  await link(page, 'four').focus();
  for (const key of ['Space', 'ArrowDown', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => titles(page)).toEqual(['three', 'four', 'two, edited']);

  // Delete, and Undo.
  await link(page, 'four').click();
  await detail.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => titles(page)).toEqual(['three', 'two, edited']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => titles(page)).toEqual(['three', 'four', 'two, edited']);

  // A new list, another list, and the first again: each is a load that the worker answers with the shell.
  await page.getByRole('button', { name: 'Add a list' }).click();
  const second = unique('Second');
  await page.getByLabel('New list name').fill(second);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${second}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: second })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(['three', 'four', 'two, edited']);

  // Search is the device's own.
  await page.getByRole('searchbox', { name: 'Search the Desk' }).fill('edited');
  await expect(page.getByRole('region', { name: 'Search results' })).toContainText('two, edited');

  // Not once did it say that it was offline.
  await page.goto(desk);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  // What the list shows says nothing of the network.
  const shown = await page
    .getByRole('region', { name })
    .getByText(/offline|no connection|needs a connection|network/i)
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);
  expect(shown).toBe(0);

  // The network is back, and the changes are sent.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  // Another device, signed in on its own: everything done above is there.
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const phone = await other.newPage();
  await phone.goto('/');
  await trySignIn(phone, EMAIL, PASSWORD);
  await expect(phone.getByRole('button', { name: 'User menu' })).toBeVisible();
  await phone.goto('/desk');
  await expect(phone.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await expect(async () => {
    await phone.reload();
    await phone
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${name}`) })
      .click({ timeout: 4000 });
    await expect(link(phone, 'two, edited')).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  await expect.poll(() => titles(phone)).toEqual(['three', 'four', 'two, edited']);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await phone.getByRole('button', { name: /Completed \(1\)/ }).click();
  await expect(link(phone, 'one')).toBeVisible();
  await link(phone, 'two, edited').click();
  await expect(phone.getByRole('region', { name: 'Card' }).getByLabel('Description')).toHaveValue(
    'Written with no network.',
  );
  await expect(
    phone
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${second}`) }),
  ).toBeVisible();
  await other.close();
});

test('a board shows what it had, read-only, and says why, the moment the connection is gone', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"page":{"state":"full","shown":"full"}}'),
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('button', { name: 'Create a workspace' })
    .click();
  const workspace = unique('Kept boards');
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await page.getByRole('button', { name: 'Create board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByLabel('Name').fill(unique('Board'));
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Add a card' }).click();
  await page.getByLabel(/^Title of a new card in Backlog/).fill('Kept in view');
  await page.getByLabel(/^Title of a new card in Backlog/).press('Enter');
  await expect(page.getByRole('button', { name: 'Kept in view', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  // What it had stays, and it says why it cannot be changed.
  await expect(page.getByText(/This board needs a connection/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kept in view', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a card' })).toHaveCount(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/This board needs a connection/)).toHaveCount(0);

  // The workspace is deleted, so that the sidebar is as it was for the next test.
  await page.getByRole('link', { name: workspace, exact: true }).first().click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete workspace' });
  await confirm.getByLabel('Type the name to confirm').fill(workspace);
  await confirm.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toHaveCount(0);
});

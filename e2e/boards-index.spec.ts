import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The boards index (task 16.4, DESIGN.md §17.3): the Desk as a tile of its own, then each workspace with its boards and a way to create one, the sort kept
 * with the account, and the Desk there when nothing else is. The instance has one account, so who sees which board is held by the data-layer tests.
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
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"page":{"state":"full","shown":"full"}}'),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
}

async function makeWorkspace(page: Page, name: string) {
  // The sidebar's +; the page itself has a button of the same name when there is no workspace yet.
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('button', { name: 'Create a workspace' })
    .click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function deleteWorkspace(page: Page, name: string) {
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
  await dialog.getByLabel('Type the name to confirm').fill(name);
  await dialog.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toHaveCount(0);
}

test('the Desk is a pinned tile with its counts, and the sidebar’s entry is Home', async ({
  page,
}) => {
  await signedIn(page);
  const desk = page.getByRole('region', { name: 'Pinned' }).getByRole('link', { name: /Desk/ });
  await expect(desk).toBeVisible();
  await expect(desk).toContainText(/\d+ open · \d+ due today/);
  await expect(
    page.getByRole('navigation', { name: 'Tusk', exact: true }).getByRole('link', { name: 'Home' }),
  ).toHaveAttribute('aria-current', 'page');
  await desk.click();
  await expect(page).toHaveURL(/\/desk$/);
});

test('a workspace is a section with its boards, a tile to create one and a gear for its settings', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Index');
  await makeWorkspace(page, name);
  await page.goto('/');
  const section = page.getByRole('region', { name: 'My workspaces' }).getByRole('region', { name });
  await expect(section).toBeVisible();
  await expect(section.getByRole('link', { name })).toHaveAttribute('href', /\/w\//);

  // A board made from the section's own tile opens, and is a tile there afterwards.
  const board = unique('Board');
  await section.getByRole('button', { name: 'Create board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByLabel('Name').fill(board);
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await page.goto('/');
  await expect(page.getByRole('region', { name }).getByRole('link', { name: board })).toBeVisible();

  // The gear opens the workspace's settings, here and not on another page.
  await page.getByRole('button', { name: `Settings of ${name}` }).click();
  const settings = page.getByRole('dialog', { name: 'Workspace settings' });
  await expect(settings.getByRole('region', { name: 'People' }).getByText('(you)')).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('region', { name }).getByRole('link', { name, exact: true }).click();
  await deleteWorkspace(page, name);
});

test('the sort of one’s own workspaces is kept with the account, and survives a reload', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Sorted');
  await makeWorkspace(page, name);
  await page.goto('/');
  const sort = page.getByLabel('Sort my workspaces');
  await expect(sort).toHaveValue('name');
  await sort.selectOption('updated');
  await expect
    .poll(
      async () => ((await (await page.request.get('/api/boards')).json()) as { sort: string }).sort,
    )
    .toBe('updated');
  await page.reload();
  await expect(page.getByLabel('Sort my workspaces')).toHaveValue('updated');
  // Put back as it was found.
  await page.getByLabel('Sort my workspaces').selectOption('name');
  await expect
    .poll(
      async () => ((await (await page.request.get('/api/boards')).json()) as { sort: string }).sort,
    )
    .toBe('name');
  await page.getByRole('region', { name }).getByRole('link', { name, exact: true }).click();
  await deleteWorkspace(page, name);
});

test('offline, the Desk tile stays and the rest says it needs a connection', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await context.setOffline(true);
  // The screen listens for the window's focus once it is drawn, which is a moment after the page is: say it until it has been heard.
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText(/need a connection/)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(
    page.getByRole('region', { name: 'Pinned' }).getByRole('link', { name: /Desk/ }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/need a connection/)).toHaveCount(0);
});

test('the index and the settings are for the signed-in, and a setting is a sort and nothing else', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  expect((await stranger.get('/api/boards')).status()).toBe(401);
  expect(
    (
      await stranger.patch('/api/settings', {
        headers: { origin },
        data: { workspaceSort: 'name' },
      })
    ).status(),
  ).toBe(401);
  await stranger.dispose();

  const patch = (data: unknown, headers: Record<string, string> = { origin }) =>
    page.request.patch('/api/settings', { headers, data: data as object });
  expect(
    (await patch({ workspaceSort: 'name' }, { origin: 'https://evil.example.com' })).status(),
  ).toBe(403);
  expect((await patch({ workspaceSort: 'size' })).status()).toBe(400);
  expect((await patch({ workspaceSort: 'name', seq: 1 })).status()).toBe(400);
  expect((await patch({ workspaceSort: 'name' })).status()).toBe(200);
  // A zone is a zone this runtime knows, and a setting is at least one of them.
  expect((await patch({ timeZone: 'Mars/Olympus' })).status()).toBe(400);
  expect((await patch({})).status()).toBe(400);
  expect((await patch({ timeZone: 'Europe/Berlin' })).status()).toBe(200);
});

test.describe('the browser’s time zone', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });

  test('is reported to the account once, and not again while it is the same', async ({ page }) => {
    await signedIn(page);
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage))
        if (key.startsWith('tusk.zone.')) window.localStorage.removeItem(key);
    });
    const report = page.waitForRequest(
      (request) => request.method() === 'PATCH' && request.url().endsWith('/api/settings'),
    );
    await page.reload();
    expect((await report).postDataJSON()).toEqual({ timeZone: 'Pacific/Auckland' });
    // Kept, so the next load does not send it again.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some((key) => key.startsWith('tusk.zone.')),
        ),
      )
      .toBe(true);
    let again = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().endsWith('/api/settings')) again += 1;
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(again).toBe(0);
  });
});

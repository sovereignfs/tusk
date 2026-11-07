import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, signOut, trySignIn } from './helpers';

/**
 * The PWA (task 1.11, DESIGN.md §17.9): installable (a manifest with the icons a browser asks for), a service worker that keeps the build's files and the one
 * shell page and **nothing of a person**, and a Desk that opens with the network off, from the device's own copy. A board says it needs a connection.
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
  await expect(
    page.getByRole('navigation', { name: 'Lists' }).getByRole('link').first(),
  ).toBeVisible();
}

/** The worker has installed, kept its files, and is in control of the page. */
async function workerReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // It keeps the build's files as it installs; wait for the shell to be among them.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) => name.startsWith('tusk-shell-'));
        for (const name of names) if (await (await caches.open(name)).match('/shell')) return true;
        return false;
      }),
    )
    .toBe(true);
}

test('the manifest and icons make it installable, and the worker is served from the root', async ({
  page,
  request,
}) => {
  await signedIn(page);
  const link = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(link).toBeTruthy();
  const manifest = await (await request.get(link ?? '/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({
    name: 'Tusk',
    short_name: 'Tusk',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  });
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];
  expect(icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
  expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
  expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of icons) {
    const reply = await request.get(icon.src);
    expect(reply.status(), icon.src).toBe(200);
    expect(reply.headers()['content-type'], icon.src).toContain('image/png');
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toContain('javascript');
  expect(worker.headers()['service-worker-allowed']).toBe('/');
  expect(worker.headers()['cache-control']).toContain('no-cache');
  expect(await worker.text()).toContain('/shell');
});

test('the shell is the same for everyone and holds nothing of a person', async ({ request }) => {
  // No session at all: it is a page, with no name, no address and no id of anyone in it.
  const reply = await request.get('/shell');
  expect(reply.status()).toBe(200);
  const html = await reply.text();
  expect(html).not.toContain(EMAIL);
  expect(html).not.toMatch(/"accountId"/);
  expect(reply.headers()['content-security-policy']).toContain("script-src 'self' 'nonce-");
});

test('after a signed-in tour of the Desk, a board and the Inbox, the caches hold only the build and the shell, and offline the Desk opens and a board says it needs a connection', async ({
  page,
  context,
}) => {
  await signedIn(page);
  const name = unique('Offline');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByLabel('Add a card').fill('Kept on the device');
  await page.getByLabel('Add a card').press('Enter');
  await expect(page.getByRole('link', { name: 'Kept on the device' })).toBeVisible();
  const desk = page.url();
  await workerReady(page);

  // A board and the Inbox and Settings, so that the worker has seen every kind of page.
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"page":{"state":"full","shown":"full"}}'),
  );
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('button', { name: 'Create a workspace' })
    .click();
  const workspace = unique('Tour');
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await page.getByRole('button', { name: 'Create board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByLabel('Name').fill(unique('Board'));
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  const board = page.url();
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.goto('/account');
  await page.goto(desk);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // Every cache there is: the build's files, the icons and the shell, and not one page, API answer or anything of the account.
  const listed = await page.evaluate(async () => {
    const out: { cache: string; path: string; text: string | null }[] = [];
    for (const cache of await caches.keys()) {
      const store = await caches.open(cache);
      for (const request of await store.keys()) {
        const type = (await store.match(request))?.headers.get('content-type') ?? '';
        const text =
          type.includes('html') || type.includes('json')
            ? await (await store.match(request))?.text()
            : null;
        out.push({ cache, path: new URL(request.url).pathname, text: text ?? null });
      }
    }
    return out;
  });
  expect(listed.length).toBeGreaterThan(1);
  for (const entry of listed) {
    expect(entry.cache.startsWith('tusk-shell-'), entry.cache).toBe(true);
    expect(
      entry.path === '/shell' ||
        entry.path.startsWith('/_next/static/') ||
        /^\/(icon\.svg|favicon\.ico|manifest\.webmanifest|icons\/[a-z0-9._-]+)$/.test(entry.path),
      `${entry.path} is kept`,
    ).toBe(true);
    if (entry.text !== null) {
      expect(entry.text).not.toContain(EMAIL);
      expect(entry.text).not.toContain(name);
      expect(entry.text).not.toContain('Kept on the device');
    }
  }

  // Offline: the Desk opens from the shell and the device's own copy, with what was written; a board says it needs a connection.
  await context.setOffline(true);
  await page.goto(desk);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kept on the device' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await page.goto(board);
  await expect(
    page.getByRole('heading', { level: 1, name: 'This needs a connection' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to your Desk' }).click();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await context.setOffline(false);

  // The workspace is deleted, so that the sidebar is as it was for the next test.
  await page.goto('/');
  await page.getByRole('link', { name: workspace, exact: true }).first().click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete workspace' });
  await confirm.getByLabel('Type the name to confirm').fill(workspace);
  await confirm.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toHaveCount(0);
});

test('after signing out there is no one for the shell to open for', async ({ page, context }) => {
  await signedIn(page);
  await workerReady(page);
  expect(await page.evaluate(() => window.localStorage.getItem('tusk.me'))).toContain(EMAIL);
  await signOut(page);
  expect(await page.evaluate(() => window.localStorage.getItem('tusk.me'))).toBeNull();
  await context.setOffline(true);
  await page.goto('/desk');
  await expect(page.getByText('Sign in to use Tusk')).toBeVisible();
  await context.setOffline(false);
  // The account is signed in again for the tests that follow.
  await trySignIn(page, EMAIL, PASSWORD);
});

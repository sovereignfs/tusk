import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, signOut, trySignIn } from './helpers';

/**
 * Signing out of a device and a session that ends elsewhere (task 13.4), in a browser, because what is checked is IndexedDB and cookies.
 */
const localDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases())
      .map((db) => db.name ?? '')
      .filter((name) => name.startsWith('tusk-desk-')),
  );

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // The working copy is opened when the page is, a moment after it is drawn.
  await expect.poll(() => localDatabases(page)).toHaveLength(1);
}

test('the working copy is on the device while signed in, and signing out leaves no database for the account', async ({
  page,
}) => {
  await signedIn(page);
  expect((await localDatabases(page))[0]).toMatch(/^tusk-desk-.{8,}$/);

  await signOut(page);
  await expect.poll(() => localDatabases(page)).toEqual([]);
  // And it stays gone: the session is over, so the page is the public one.
  await page.reload();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  expect(await localDatabases(page)).toEqual([]);
});

test('a session that ended elsewhere stops data being shown at the next sync, and keeps the copy for the same account', async ({
  page,
  context,
}) => {
  await signedIn(page);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  const before = await localDatabases(page);

  // The session ends on the server (here, the browser forgets its cookie, which is what the server then sees); the page does not know.
  await context.clearCookies();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  // Coming back online is one of the reasons a device syncs.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.getByRole('heading', { name: 'Your session ended' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  // Nothing was thrown away: signing back in as the same account finds the same database.
  expect(await localDatabases(page)).toEqual(before);

  await page.getByRole('link', { name: 'Sign in' }).click();
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  expect(await localDatabases(page)).toEqual(before);
  await signOut(page);
});

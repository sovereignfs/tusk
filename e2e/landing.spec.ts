import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, signOut, trySignIn } from './helpers';

/**
 * The front address (task 2.2): a page for a visitor, the first list for someone signed in, and the sign-in page for a cookie that is forged.
 */
test('a visitor reads what Tusk is, with a way to sign in, and it is there with no script at all', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: baseURL ?? 'http://localhost',
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your tasks, kept to yourself');
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(3);
  await context.close();
});

test('it offers an account only where the server would let one be made', async ({ page }) => {
  await ensureAccount(page);
  await page.goto('/');
  const offered = (await page.getByRole('link', { name: 'Create an account' }).count()) > 0;
  await page.goto('/sign-up');
  const form = (await page.getByRole('heading', { name: 'Create your account' }).count()) > 0;
  expect(offered).toBe(form);
});

test('someone signed in has their first list at the same address, and it is the front page again after signing out', async ({
  page,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
    'Your tasks, kept to yourself',
  );
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();

  await signOut(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your tasks, kept to yourself');
});

test('a forged session cookie gets the sign-in page and no data', async ({
  page,
  context,
  baseURL,
}) => {
  await ensureAccount(page);
  const url = new URL(baseURL ?? 'http://localhost');
  await context.addCookies([
    { name: 'tusk.session_token', value: 'forged.value', domain: url.hostname, path: '/' },
  ]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Tusk' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
});

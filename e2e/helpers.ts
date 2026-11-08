import { expect, type Locator, type Page } from '@playwright/test';

/**
 * What the browser tests that need a signed-in person share. The instance is closed to sign-up, so the first account is the only one there will be,
 * and it is made by whichever test gets here first: both browsers share the instance, so every test starts by making sure there is one.
 */
export const EMAIL = 'owner@example.com';
export const PASSWORD = 'correct horse battery';

export async function ensureAccount(page: Page, options: { skipKeyOffer?: boolean } = {}) {
  await page.goto('/sign-up');
  const create = page.getByRole('heading', { name: 'Create your account' });
  if (!(await create.isVisible())) return;
  await page.getByLabel('Name').fill('Ada');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // The Desk offers a key of its own once (DESIGN.md §9.1). The tests that share this account keep the Desk plain, as most people will, by pressing Skip.
  if (options.skipKeyOffer !== false) {
    await page.goto('/desk');
    await page
      .getByRole('region', { name: 'A key for your Desk' })
      .getByRole('button', { name: 'Skip' })
      .click();
    await expect(page.getByRole('region', { name: 'A key for your Desk' })).toHaveCount(0);
  }
  await signOut(page);
}

/**
 * Waits for the Desk to be usable (`ready` is something only a usable Desk shows), skipping the offer of a key of one's own if it is in the way. The
 * offer is skipped by `ensureAccount` only when that makes the account; an account made another way (a test that made it through the API) shows it on the
 * first visit, and until it is answered the Desk has no list. Whichever test of a shard goes first must not decide that for the others.
 */
export async function deskReady(page: Page, ready: Locator) {
  const offer = page.getByRole('region', { name: 'A key for your Desk' });
  await expect(ready.first().or(offer)).toBeVisible();
  if (await offer.isVisible()) {
    await offer.getByRole('button', { name: 'Skip' }).click();
    await expect(offer).toHaveCount(0);
    await expect(ready.first()).toBeVisible();
  }
}

/**
 * Opens the sign-in page. Right after the page has signed itself out (an account deleted, say) it is already on its way to `/sign-in`, and
 * WebKit then refuses a second navigation to the same address ("interrupted by another navigation"). That one is not a failure: the page is
 * going where we asked, so let it arrive, and only ask again if it did not.
 */
async function gotoSignIn(page: Page) {
  try {
    await page.goto('/sign-in');
  } catch (error) {
    if (!/interrupted by another navigation/.test(String(error))) throw error;
    await page.waitForLoadState('load');
    if (new URL(page.url()).pathname !== '/sign-in') await page.goto('/sign-in');
  }
}

/**
 * Fills the sign-in form and submits it. Sign-in is rate-limited per address (three attempts in ten seconds), and both browsers reach this instance
 * from the same one, so an attempt can be told to wait: it then does, once the window has passed, as a person would.
 */
export async function trySignIn(page: Page, email: string, password: string) {
  await gotoSignIn(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const submit = page.getByRole('button', { name: 'Sign in' });
  await submit.click();
  const limited = page.getByText(/Too many tries/);
  const outcome = page
    .getByText(/do not match/)
    .or(page.getByRole('button', { name: 'User menu' }));
  await expect(limited.or(outcome)).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_500);
    await submit.click();
  }
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
}

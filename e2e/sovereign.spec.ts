import { expect, test, type Page } from '@playwright/test';
import { signOut } from './helpers';

/**
 * Signing in through Sovereign (task 2.5, DESIGN.md §6), a fake one (`e2e/fake-sovereign-server.ts`), on two instances of their own: one that takes only
 * Sovereign and only its first account (3995), and one that takes both ways and anyone (3994). The instances keep their accounts between the two browsers,
 * so each test is the same whichever runs first: the same person signs in as the same account, and a stranger is turned away either way.
 */
const SOVEREIGN = 'http://localhost:3995';
const BOTH = 'http://localhost:3994';
const FIRST = { sub: 'e2e-first', email: 'first@sovereign.test', name: 'Grace Hopper' };
const SECOND = { sub: 'e2e-second', email: 'second@sovereign.test', name: 'Alan Turing' };

async function nextPersonIs(page: Page, who: { sub: string; email: string; name?: string }) {
  const reply = await page.request.post('http://localhost:3191/sign-in-as', { data: who });
  expect(reply.ok()).toBe(true);
}

/**
 * Starts the sign-in at Sovereign. Sign-in is rate-limited, three tries in ten seconds from one address, and both browsers reach these instances from the same
 * one: when told so, wait it out and go again, as a person would.
 */
async function throughSovereign(page: Page) {
  const button = page.getByRole('button', { name: 'Sign in with Sovereign' });
  await button.click();
  const limited = page.getByText(/Too many tries/);
  await expect(
    limited
      .or(page.getByRole('button', { name: 'User menu' }))
      .or(page.getByText(/Sign-up is closed|already an account/)),
  ).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_500);
    await button.click();
  }
}

test.describe('an instance that signs in through Sovereign only', () => {
  test.use({ baseURL: SOVEREIGN, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('offers Sovereign and nothing of the local ways, which are not there to find', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /passkey/i })).toHaveCount(0);
    for (const path of ['/sign-up', '/forgot-password', '/reset-password']) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
  });

  test('the first person signs in as who Sovereign says they are, and signing out is local', async ({
    page,
  }) => {
    await nextPersonIs(page, FIRST);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByText(FIRST.name)).toBeVisible();
    await expect(page.getByText(FIRST.email)).toBeVisible();
    await page.keyboard.press('Escape');

    // Signing out ends this session, and not Sovereign's: the next sign-in does not ask for anything again here, and is the same account.
    await signOut(page);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);
  });

  test('a second person is turned back to the sign-in page and told why, and has no session', async ({
    page,
  }) => {
    await nextPersonIs(page, SECOND);
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/Sign-up is closed/)).toBeVisible();
    await page.goto('/desk');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('a person who declines at Sovereign is told so and is not signed in', async ({ page }) => {
    await page.goto('/sign-in?error=access_denied');
    await expect(page.getByText(/You declined to share/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });
});

test.describe('an instance that offers both ways', () => {
  test.use({ baseURL: BOTH, viewport: { width: 1280, height: 800 } });
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('shows a password and Sovereign, and each signs in', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with Sovereign' })).toBeVisible();

    await nextPersonIs(page, {
      sub: 'e2e-both-1',
      email: 'both-one@sovereign.test',
      name: 'Katherine Johnson',
    });
    await throughSovereign(page);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);

    // And an account with a password, made here, still signs in with it.
    await page.goto('/sign-up');
    const email = `local-${Date.now()}@example.com`;
    await page.getByLabel('Name').fill('Local Ada');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);
  });

  test('a Sovereign login with a local account’s address is refused, with what to do instead', async ({
    page,
  }) => {
    const email = `taken-${Date.now()}@example.com`;
    await page.goto('/sign-up');
    await page.getByLabel('Name').fill('Local Grace');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
    await signOut(page);

    await nextPersonIs(page, { sub: `e2e-both-${Date.now()}`, email, name: 'Someone Else' });
    await page.goto('/sign-in');
    await throughSovereign(page);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/already an account here/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  });
});

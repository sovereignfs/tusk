import { expect, test, type Page } from '@playwright/test';

/**
 * Signing up, in, and out, in a browser (task 2.1). The instance is closed to sign-up, so the first account is the only one there will be, and it
 * is made by whichever browser gets here first: both browsers share the instance, so every test below starts by making sure there is one.
 */
const EMAIL = 'owner@example.com';
const PASSWORD = 'correct horse battery';

async function ensureAccount(page: Page) {
  await page.goto('/sign-up');
  const create = page.getByRole('heading', { name: 'Create your account' });
  if (!(await create.isVisible())) return;
  await page.getByLabel('Name').fill('Ada');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await signOut(page);
}

/**
 * Fills the sign-in form and submits it. Sign-in is rate-limited per address (three attempts in ten seconds), and both browsers reach this instance
 * from the same one, so an attempt can be told to wait: it then does, once the window has passed, as a person would.
 */
async function trySignIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
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

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
}

test('the first account can be made, and signs the person in', async ({ page }) => {
  await ensureAccount(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
});

test('signing in with the right password shows who is signed in, and signing out ends it', async ({
  page,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

  // Signed in, the sign-in page has nothing to ask.
  await page.goto('/sign-in');
  await expect(page).toHaveURL(/\/$/);

  await signOut(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
});

test('a wrong password reads the same as an address with no account, and signs no one in', async ({
  page,
}) => {
  await ensureAccount(page);
  const messages: string[] = [];
  for (const email of [EMAIL, 'nobody@example.com']) {
    await trySignIn(page, email, 'not the password at all');
    const alert = page.getByText(/do not match/);
    await expect(alert).toBeVisible();
    messages.push((await alert.textContent()) ?? '');
  }
  expect(messages[1]).toBe(messages[0]);
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
});

test('a second account is refused by the server, and the page does not offer one', async ({
  page,
  request,
}) => {
  await ensureAccount(page);
  // The browser's own origin, which is what a page of ours would send.
  const origin = new URL(page.url()).origin;
  const reply = await request.post('/api/auth/sign-up/email', {
    headers: { origin },
    data: { name: 'Mallory', email: 'mallory@example.com', password: PASSWORD },
  });
  expect(reply.status()).toBe(403);
  expect((await reply.json()).code).toBe('SIGNUP_CLOSED');

  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Sign-up is closed' })).toBeVisible();
  await page.goto('/sign-in');
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import { totpFor } from '../src/auth/testing/totp';
import { EMAIL, PASSWORD, ensureAccount, signOut, trySignIn } from './helpers';

/**
 * An authenticator app, backup codes and passkeys in a real browser (task 2.4, DESIGN.md §6, §19), on the third instance (`playwright.config.ts`) because they
 * change how the account signs in. Passkeys use Chromium's virtual authenticator over the DevTools protocol, the one way to run a passkey with no person; WebKit
 * has none, so they are tried in Chromium only. The authenticator app runs in both browsers: enrol, sign in with the code, with a backup code once, turn off.
 */
test.use({ baseURL: 'http://localhost:3996', viewport: { width: 1280, height: 800 } });

/** The password step alone: with an authenticator app on, the page that follows asks for a code, which the shared helper does not know. */
async function password(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await submit.click();
  // Sign-in is rate-limited per address, three tries in ten seconds: when told, wait it out, as a person would.
  const limited = page.getByText(/Too many tries/);
  await expect(
    limited
      .or(page.getByLabel('Code from your authenticator app'))
      .or(page.getByRole('button', { name: 'User menu' })),
  ).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_500);
    await submit.click();
  }
}
const secretOf = async (page: Page): Promise<string> =>
  (await page.getByLabel('Setup key').innerText()).trim();
const codeFor = (secret: string): Promise<string> =>
  totpFor(`otpauth://totp/Tusk:me?secret=${secret}&issuer=Tusk`);

test('an authenticator app is set up, asked for at sign-in, replaced by a backup code once, and turned off', async ({
  page,
  browserName,
}) => {
  test.setTimeout(150_000);
  await ensureAccount(page, { skipKeyOffer: false });
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/account?section=security');

  // Asks for the password to begin; a wrong one does not.
  await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
  const begin = page.getByRole('form', { name: 'Set up an authenticator app' });
  await begin.getByLabel('Your password').fill('not the password at all');
  await begin.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await begin.getByLabel('Your password').fill(PASSWORD);
  await begin.getByRole('button', { name: 'Continue' }).click();

  // It is not on until a code from the app has been shown to work.
  const confirm = page.getByRole('form', { name: 'Confirm the authenticator app' });
  await expect(confirm).toBeVisible();
  await confirm.getByLabel('Code from the app').fill('000000');
  await confirm.getByRole('button', { name: 'Turn it on' }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();
  const secret = await secretOf(page);
  await confirm.getByLabel('Code from the app').fill(await codeFor(secret));
  await confirm.getByRole('button', { name: 'Turn it on' }).click();
  const codes = page.getByRole('status', { name: 'Backup codes' });
  await expect(codes).toContainText('Save these backup codes');
  const backup = (await codes.locator('code').allInnerTexts()).map((each) => each.trim());
  expect(backup).toHaveLength(10);
  await codes.getByRole('button', { name: 'I have saved them' }).click();

  // Signed in again: the password is not enough, a code is.
  await page.goto('/boards');
  await signOut(page);
  await password(page);
  await expect(page.getByLabel('Code from your authenticator app')).toBeVisible();
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
  await page.getByLabel('Code from your authenticator app').fill('111111');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();
  // A backup code stands in for the app, and works once.
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(backup[0] ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await signOut(page);
  await password(page);
  await page.getByRole('button', { name: 'Use a backup code' }).click();
  await page.getByLabel('Backup code').fill(backup[0] ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('backup code is not right')).toBeVisible();
  // The app's code signs in (a failed backup code ends that attempt, so the password is given again), and turning it off asks for the password and puts
  // sign-in back to the password alone.
  await password(page);
  await page.getByLabel('Code from your authenticator app').fill(await codeFor(secret));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/account?section=security');
  await page.getByRole('button', { name: 'Turn it off' }).click();
  const off = page.getByRole('form', { name: 'Turn off the authenticator app' });
  await off.getByLabel('Your password').fill('not the password at all');
  await off.getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await off.getByLabel('Your password').fill(PASSWORD);
  await off.getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.getByRole('button', { name: 'Set up an authenticator app' })).toBeVisible();
  await signOut(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  void browserName;
});

test('a passkey is added, named, signs in with no password, and is removed', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'a virtual authenticator is Chromium’s alone');
  test.setTimeout(120_000);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

  // A security key that is always present and always verifies: the person at the other end of the prompt.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto('/account?section=security');
  await expect(page.getByText('You have no passkeys.')).toBeVisible();
  await page.getByLabel('Name for the new passkey').fill('Test laptop');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  const list = page.getByRole('list', { name: 'Your passkeys' });
  await expect(list).toContainText('Test laptop');
  // Renamed.
  await page.getByRole('button', { name: 'Rename Test laptop' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Work laptop');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(list).toContainText('Work laptop');

  // Signed out, a passkey signs in with no password.
  await page.goto('/boards');
  await signOut(page);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a passkey instead' }).click();
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

  // Removed, and then there is nothing for it to sign in with.
  await page.goto('/account?section=security');
  await page.getByRole('button', { name: 'Remove Work laptop' }).click();
  await expect(page.getByText('You have no passkeys.')).toBeVisible();
  await signOut(page);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a passkey instead' }).click();
  await expect(page.getByText('did not sign you in')).toBeVisible();
});

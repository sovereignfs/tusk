import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Settings (task 2.7, DESIGN.md §19): a dialog over the page it was opened from, a page of its own at `/account`, its sections, and what it does with a
 * name, a password and the devices. The account is shared by every test, so a test that changes it puts it back, and the password is not changed here:
 * that would sign out every other test.
 */
test.use({ viewport: { width: 1280, height: 800 } });

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
}

test('the menu opens Settings as a dialog over the Desk, and closing it goes back to where it was', async ({
  page,
}) => {
  await signedIn(page);
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  // The Desk is still behind it, not replaced by it.
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeAttached();
  await expect(dialog.getByRole('region', { name: 'Profile' })).toBeVisible();
  await expect(dialog.getByText(EMAIL)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('an address with a section opens it, on a page of its own, and one that is not a section opens Profile', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account?section=security');
  await expect(page.getByRole('region', { name: 'Security' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Profile' })).toBeHidden();
  await page.goto('/account?section=nonsense');
  await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
});

test('the sections are chosen from the list, and the one that is not shown keeps what was typed in it', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account?section=security');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await page.getByLabel('Current password').fill('half typed');
  await nav.getByRole('button', { name: 'Profile' }).click();
  await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();
  await nav.getByRole('button', { name: 'Security' }).click();
  await expect(page.getByLabel('Current password')).toHaveValue('half typed');
});

test('a name is changed and shows in the menu, and is put back', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account');
  const name = page.getByRole('textbox', { name: /^Name/ });
  const original = await name.inputValue();
  const changed = `${original} ${crypto.randomUUID().slice(0, 4)}`;
  try {
    await name.fill(changed);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Your name is saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^Name/ })).toHaveValue(changed);
  } finally {
    await page.getByRole('textbox', { name: /^Name/ }).fill(original);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Your name is saved.')).toBeVisible();
  }
});

test('a password is not changed without the right one, and the answer says so', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/account?section=security');
  await page.getByLabel('Current password').fill('not the password at all');
  await page.getByLabel(/^New password(?! again)/).fill('another long password');
  await page.getByLabel('New password again').fill('another long password');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('That password is not right.')).toBeVisible();
});

test('a new password that is short, or does not match, cannot be sent', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account?section=security');
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel(/^New password(?! again)/).fill('short');
  await expect(page.getByText(/At least \d+ characters\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
  await page.getByLabel(/^New password(?! again)/).fill('a long enough password');
  await page.getByLabel('New password again').fill('a different one entirely');
  await expect(page.getByText('The two are not the same.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeDisabled();
});

test('the devices it is signed in on are listed, and this one says so', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account?section=security');
  const devices = page.getByRole('list', { name: 'Signed-in devices' });
  await expect(devices).toBeVisible();
  await expect(devices.getByText('This device')).toHaveCount(1);
});

test('the theme is chosen, applied at once, and kept on the device', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account?section=preferences');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'System' }).click();
});

test('Data says when this device last heard from the server', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account?section=data');
  await expect(page.getByText(/Last synced: (?!…)/)).toBeVisible();
});

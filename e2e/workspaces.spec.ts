import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Workspaces (task 16.2, DESIGN.md §13.1, §17.2): made from the sidebar, renamed, and deleted by typing the name, with one that is not the person's the page for what is not here.
 * The account is shared by every test, so each makes workspaces of its own name and deletes what it made.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  // Wide, so that the workspaces are named in words and not only by their first letter.
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"canvas":{"state":"full","shown":"full"}}'),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create a workspace' })).toBeVisible();
}

async function make(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create a workspace' }).click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** Opens the workspace's settings from its gear. */
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function remove(page: Page, name: string) {
  await (await openSettings(page)).getByRole('button', { name: 'Delete workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
  await dialog.getByLabel('Type the name to confirm').fill(name);
  await dialog.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toHaveCount(0);
}

test('a workspace is made from the sidebar, is in it under My workspaces, and survives a reload', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Acme');
  await make(page, name);
  const mine = page.getByRole('region', { name: 'My workspaces' });
  await expect(mine.getByRole('link', { name })).toBeVisible();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'My workspaces' }).getByRole('link', { name }),
  ).toBeVisible();
  await remove(page, name);
});

test('an owner renames it and the sidebar follows; a name that is blank is not sent', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Acme');
  await make(page, name);
  const renamed = unique('Renamed');
  const settings = await openSettings(page);
  await expect(settings.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await settings.getByLabel('Name').fill('   ');
  await expect(settings.getByRole('button', { name: 'Save name' })).toBeDisabled();
  await settings.getByLabel('Name').fill(renamed);
  await settings.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(
    page.getByRole('region', { name: 'My workspaces' }).getByRole('link', { name: renamed }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await remove(page, renamed);
});

test('the people of a workspace: the owner is listed with their address, an unknown address is refused, and the last owner cannot leave', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('People');
  await make(page, name);
  const dialog = await openSettings(page);
  const people = dialog.getByRole('region', { name: 'People' });
  await expect(people.getByRole('listitem')).toHaveCount(1);
  await expect(people.getByText('(you)')).toBeVisible();
  await expect(people.getByText(EMAIL)).toBeVisible();
  // Not an address with an account here: it says so and adds nothing.
  await people.getByLabel('Add a person by email').fill('nobody@example.com');
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(dialog.getByText('No account with that address here.')).toBeVisible();
  await expect(people.getByRole('listitem')).toHaveCount(1);
  // The owner's own address is an account that is in it already.
  await people.getByLabel('Add a person by email').fill(EMAIL.toUpperCase());
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(dialog.getByText('They are in this workspace already.')).toBeVisible();
  // The only owner cannot step down or leave.
  await people.getByLabel('Role of Ada').selectOption('member');
  await expect(dialog.getByText(/keeps at least one owner/)).toBeVisible();
  await expect(people.getByLabel('Role of Ada')).toHaveValue('owner');
  await dialog.getByRole('button', { name: 'Leave workspace' }).click();
  await page
    .getByRole('dialog', { name: 'Leave this workspace?' })
    .getByRole('button', { name: 'Leave' })
    .click();
  await expect(dialog.getByText(/keeps at least one owner/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await remove(page, name);
});

test('deleting needs the name typed as it is, and takes it out of the sidebar and the server', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Doomed');
  await make(page, name);
  const address = page.url();
  await (await openSettings(page)).getByRole('button', { name: 'Delete workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete workspace' });
  const confirm = dialog.getByRole('button', { name: 'Delete this workspace' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the name to confirm').fill(name.toLowerCase());
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type the name to confirm').fill(name);
  await confirm.click();
  await expect(page).toHaveURL(/\/$|\/desk$/);
  await expect(
    page.getByRole('region', { name: 'My workspaces' }).getByRole('link', { name }),
  ).toHaveCount(0);
  // It is gone for good: its address is the page for what is not here.
  await page.goto(address);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
});

test('a workspace that is not there for this account is the page for what is not here, whether it never was or is someone else’s', async ({
  page,
}) => {
  await signedIn(page);
  // The same page for both. (The status line is 200, as it is for every page that streams behind the root loading state; the proxy cannot ask the database.)
  await page.goto(`/w/${crypto.randomUUID()}`);
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
  await page.goto('/w/not-an-id');
  await expect(page.getByRole('heading', { name: 'That is not here' })).toBeVisible();
});

test('a rail shows each workspace by its first letter, named for a screen reader', async ({
  page,
}) => {
  await signedIn(page);
  const name = unique('Zebra');
  await make(page, name);
  await page.evaluate(() =>
    window.localStorage.setItem(
      'tusk.sidebar',
      '{"index":{"state":"rail","shown":"rail"},"canvas":{"state":"rail","shown":"rail"}}',
    ),
  );
  await page.reload();
  const link = page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('link', { name });
  await expect(link).toBeVisible();
  await expect(link).toHaveText('Z');
  await link.click();
  await remove(page, name);
});

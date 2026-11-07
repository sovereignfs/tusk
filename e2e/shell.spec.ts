import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The shell (task 7.8, DESIGN.md §17.2): the header, and the app's sidebar, which is full, a rail of icons, or hidden, and is remembered on the device
 * for the kind of page. Home opens full; every other page opens as a rail.
 */
test.use({ viewport: { width: 1280, height: 800 } });

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // A device of its own for every test: nothing a test chose before is in the way.
  await page.evaluate(() => window.localStorage.removeItem('tusk.sidebar'));
  await page.reload();
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Tusk', exact: true });
const widthOf = (page: Page) => sidebar(page).evaluate((el) => el.getBoundingClientRect().width);

test('Home opens full and the Desk opens a rail, which names each entry for a screen reader and a pointer', async ({
  page,
}) => {
  await signedIn(page);
  // Home is where signing in lands: the whole sidebar, with the workspaces by name.
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');
  expect(await widthOf(page)).toBe(220);
  await expect(sidebar(page).getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/desk');
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');
  expect(await widthOf(page)).toBe(56);
  for (const name of ['Home', 'Desk', 'Planner', 'Inbox']) {
    const entry = sidebar(page).getByRole('link', { name });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('title', name);
  }
  await expect(sidebar(page).getByRole('link', { name: 'Desk' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sidebar(page).getByRole('link', { name: 'Home' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  // After the Inbox: a divider, the workspaces' icons, and then the +.
  await expect(sidebar(page).getByRole('button', { name: 'Create a workspace' })).toBeVisible();
});

test('the Planner is between the Desk and the Inbox, and its page is blank for now', async ({
  page,
}) => {
  await signedIn(page);
  const places = await sidebar(page)
    .getByRole('link')
    .evaluateAll((links) => links.slice(0, 4).map((link) => link.textContent?.trim() ?? ''));
  expect(places).toEqual(['Home', 'Desk', 'Planner', 'Inbox']);
  await sidebar(page).getByRole('link', { name: 'Planner' }).click();
  await expect(page).toHaveURL(/\/planner$/);
  await expect(sidebar(page).getByRole('link', { name: 'Planner' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
});

test('the sidebar’s own button narrows a full sidebar and widens it again, and it is remembered after a reload', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Widen the sidebar' }).click();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');
  expect(await widthOf(page)).toBe(220);
  await expect(sidebar(page).getByText('Desk', { exact: true })).toBeVisible();

  await page.reload();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');

  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');

  // Home is a kind of page of its own: what was chosen for the Desk did not change it.
  await page.goto('/');
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');
});

test('the header’s button hides the sidebar and shows it again as it was, and the choice is remembered', async ({
  page,
}) => {
  await signedIn(page);
  const toggle = page.getByRole('banner').getByRole('button', { name: 'Hide the sidebar' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(sidebar(page)).toHaveCount(0);
  await page.reload();
  await expect(sidebar(page)).toHaveCount(0);

  const show = page.getByRole('banner').getByRole('button', { name: 'Show the sidebar' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await show.click();
  // It was full when it was hidden, and it is full when it comes back.
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');
});

test('the Desk’s own columns are still there beside it, and the page does not scroll sideways', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('a storage that is empty, or full of nonsense, leaves the default', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"page":{"state":"wide"}}'),
  );
  await page.goto('/desk');
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test('there is no sidebar beside the page: the same places are in a drawer the header’s button opens (task 7.9)', async ({
    page,
  }) => {
    await signedIn(page);
    await expect(sidebar(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /Hide the sidebar|Show the sidebar/ }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Open the navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer.getByRole('link', { name: 'Home' })).toBeVisible();
  });
});

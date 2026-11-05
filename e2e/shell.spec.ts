import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The shell (task 7.8, DESIGN.md §17.2): the header, and the app's sidebar, which is full, a rail of icons, or hidden, and is remembered on the device
 * for the kind of page. The Desk is a canvas, so it opens as a rail.
 */
test.use({ viewport: { width: 1280, height: 800 } });

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  // A device of its own for every test: nothing a test chose before is in the way.
  await page.evaluate(() => window.localStorage.removeItem('tusk.sidebar'));
  await page.reload();
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Tusk', exact: true });
const widthOf = (page: Page) => sidebar(page).evaluate((el) => el.getBoundingClientRect().width);

test('the Desk opens with a rail, which names each entry for a screen reader and a pointer', async ({
  page,
}) => {
  await signedIn(page);
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');
  expect(await widthOf(page)).toBe(56);
  const desk = sidebar(page).getByRole('link', { name: 'Desk' });
  await expect(desk).toBeVisible();
  await expect(desk).toHaveAttribute('title', 'Desk');
  await expect(desk).toHaveAttribute('aria-current', 'page');
});

test('the sidebar’s own button widens a rail and narrows it again, and it is remembered after a reload', async ({
  page,
}) => {
  await signedIn(page);
  await page.getByRole('button', { name: 'Widen the sidebar' }).click();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');
  expect(await widthOf(page)).toBe(220);
  await expect(sidebar(page).getByText('Desk')).toBeVisible();

  await page.reload();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'full');

  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');
});

test('the header’s button hides the sidebar and shows it again as it was, and the choice is remembered', async ({
  page,
}) => {
  await signedIn(page);
  await page.getByRole('button', { name: 'Widen the sidebar' }).click();
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
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('a storage that is empty, or full of nonsense, leaves the default', async ({ page }) => {
  await signedIn(page);
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"canvas":{"state":"wide"}}'),
  );
  await page.reload();
  await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'rail');
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test('there is no sidebar and no button for one: the footer is the phone’s (task 7.2)', async ({
    page,
  }) => {
    await signedIn(page);
    await expect(sidebar(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /sidebar/i })).toHaveCount(0);
  });
});

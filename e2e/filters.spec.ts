import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Which cards a list shows (task 6.1, DESIGN.md §10.5): the Starred filter shows the open starred cards alone, is remembered with the list, can still be
 * dragged under Custom, and lets a card that is un-starred go without moving it.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

const rows = (page: Page) =>
  page
    .getByRole('list')
    .filter({ has: page.getByRole('checkbox') })
    .first()
    .getByRole('listitem');
const titles = async (page: Page) =>
  (await rows(page).getByRole('link').allInnerTexts()).map((text) => text.trim());
const row = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });

test('Starred shows the open starred cards alone, is remembered, can be dragged, and lets an un-starred card go without moving it', async ({
  page,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const name = unique('Starred');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // A new card goes to the top, so these are added in reverse.
  for (const title of ['d', 'c', 'b', 'a']) {
    await page.getByLabel('Add a card').fill(title);
    await page.getByLabel('Add a card').press('Enter');
    await expect(row(page, title)).toHaveCount(1);
  }
  await expect.poll(() => titles(page)).toEqual(['a', 'b', 'c', 'd']);
  for (const title of ['a', 'c', 'd'])
    await row(page, title).getByRole('button', { name: 'Star' }).click();
  // One starred card is done: Starred shows open cards, so it is not among them.
  await row(page, 'd').getByRole('checkbox', { name: 'Done: d' }).click();

  const show = page.getByRole('radiogroup', { name: 'Show' });
  await show.getByRole('radio', { name: 'Starred' }).click();
  await expect.poll(() => titles(page)).toEqual(['a', 'c']);
  await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);

  // Remembered: after a reload it is still Starred.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Starred' })).toBeChecked();
  await expect.poll(() => titles(page)).toEqual(['a', 'c']);

  // Still draggable under Custom: c to the top of what is shown, and under All it is at the top.
  await page.getByRole('link', { name: 'c', exact: true }).focus();
  for (const key of ['Space', 'ArrowUp', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect.poll(() => titles(page)).toEqual(['c', 'a']);

  // Un-starring a card takes it out of view, and does not move it.
  await row(page, 'a').getByRole('button', { name: 'Remove the star' }).click();
  await expect.poll(() => titles(page)).toEqual(['c']);
  await show.getByRole('radio', { name: 'All' }).click();
  await expect.poll(() => titles(page)).toEqual(['c', 'a', 'b']);
});

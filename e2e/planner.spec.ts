import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The Planner's feed (task 19.1, DESIGN.md §25.1): a Desk card and a board card assigned to the person on their days, today where the feed opens, runs of empty
 * days folded and opened, and more days arriving as either end is scrolled to, without moving what the reader was looking at. The zone is set so that "today" is
 * the same everywhere the test runs.
 */
test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin' });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('a Desk card and an assigned board card are on their days, and the feed opens on today', async ({
  page,
}) => {
  await signedIn(page);
  const list = unique('Planner');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(list);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${list}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: list })).toBeVisible();
  const desk = unique('Desk thing');
  await page.getByLabel('Add a card').fill(desk);
  await page.getByLabel('Add a card').press('Enter');
  await page.getByRole('link', { name: desk }).click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByRole('button', { name: 'Set a due date' }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByLabel('Time', { exact: true }).fill('09:30');
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: /^Tomorrow, / })).toBeVisible();

  // A board card, assigned to this person and dated today; and one dated today that is not assigned to anyone.
  await page.goto('/');
  const workspace = unique('Planned');
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('button', { name: 'Create a workspace' })
    .click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await page.getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByLabel('Name').fill('Plan');
  await page
    .getByRole('dialog', { name: 'Create board' })
    .getByRole('button', { name: 'Create board' })
    .click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  const column = page.locator('section[aria-label="Backlog"]');
  const mine = unique('Board mine');
  const nobody = unique('Board nobody');
  await column.getByRole('button', { name: 'Add a card' }).click();
  for (const title of [mine, nobody]) {
    // The field stays open for the next card.
    await column.getByLabel('Title of a new card in Backlog').fill(title);
    await column.getByLabel('Title of a new card in Backlog').press('Enter');
    await expect(column.getByLabel(title, { exact: true })).toBeVisible();
  }
  for (const title of [mine, nobody]) {
    await column.getByLabel(title, { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title });
    await dialog.getByRole('button', { name: 'Set a due date' }).click();
    await page.getByRole('button', { name: 'Today' }).click();
    await page.keyboard.press('Escape');
    if (title === mine) {
      await dialog.getByRole('button', { name: 'Assignees' }).click();
      await page.getByRole('checkbox', { name: 'Assign Ada' }).check();
      await dialog.getByRole('button', { name: 'Assignees' }).click();
    }
    await dialog.getByRole('button', { name: 'Close' }).click();
  }

  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('link', { name: 'Planner', exact: true })
    .click();
  await expect(page).toHaveURL(/\/planner$/);
  const today = page.locator('[aria-current="date"]');
  await expect(today).toBeVisible();
  // The board card assigned to the person is on today, and the Desk card on tomorrow, which comes after it; the unassigned one is nowhere.
  await expect(today.getByText(mine)).toBeVisible();
  const tomorrow = today.locator('xpath=following-sibling::li[1]');
  await expect(tomorrow.getByText(desk)).toBeVisible();
  await expect(
    tomorrow.getByRole('link', { name: new RegExp(desk) }).getByText(/9:30|09:30/),
  ).toBeVisible();
  await expect(page.getByText(nobody)).toHaveCount(0);
  // The feed opened with today at the top of what is shown.
  const scroller = page.locator('div[aria-label="Planner"]');
  const offset = await today.evaluate(
    (el, root) =>
      el.getBoundingClientRect().top - (root as HTMLElement).getBoundingClientRect().top,
    await scroller.elementHandle(),
  );
  // Today is in what is shown. (It is at the top when there is enough below it to scroll that far; a feed of a few cards cannot.)
  expect(offset).toBeGreaterThanOrEqual(0);
  expect(offset).toBeLessThan(400);

  // A card opens where it is.
  await today.getByText(mine).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}$/);
});

test('empty runs are folded and open when tapped, and scrolling to either end adds days without moving the reader', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/planner');
  const days = page.locator('[data-planner-day]');
  await expect(page.locator('[aria-current="date"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /nothing planned$/ }).first()).toBeVisible();

  const gap = page.getByRole('button', { name: /nothing planned$/ }).first();
  const before = await days.count();
  await gap.click();
  expect(await days.count()).toBeGreaterThan(before);

  // Scrolling to the end adds days below.
  const scroller = page.locator('div[aria-label="Planner"]');
  // The ends of the feed, as they read: a day, or the label of a folded run.
  const rows = page.locator('div[aria-label="Planner"] > div > ol > li');
  const last = async () => (await rows.last().textContent()) ?? '';
  const first = async () => (await rows.first().textContent()) ?? '';
  const lastBefore = await last();
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect.poll(last).not.toBe(lastBefore);

  // Scrolling to the top adds days above, and the day the reader was looking at stays where it was on the screen.
  const firstBefore = await first();
  const anchor = await scroller.evaluate((el) => {
    el.scrollTo({ top: 0 });
    const root = el.getBoundingClientRect();
    const day = [...el.querySelectorAll('[data-planner-day]')].find(
      (each) => each.getBoundingClientRect().bottom > root.top + 1,
    );
    return {
      date: day?.getAttribute('data-planner-day') ?? '',
      top: (day?.getBoundingClientRect().top ?? 0) - root.top,
    };
  });
  await expect.poll(first).not.toBe(firstBefore);
  const after = await scroller.evaluate((el, date) => {
    const day = el.querySelector(`[data-planner-day="${date}"]`);
    return (day?.getBoundingClientRect().top ?? 0) - el.getBoundingClientRect().top;
  }, anchor.date);
  expect(Math.abs(after - anchor.top)).toBeLessThan(3);
});

test('at a phone’s width the feed does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/planner');
  await expect(page.locator('[aria-current="date"]')).toBeVisible();
  const wide = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth ||
      [...document.querySelectorAll('div[aria-label="Planner"]')].some(
        (el) => el.scrollWidth > el.clientWidth,
      ),
  );
  expect(wide).toBe(false);
});

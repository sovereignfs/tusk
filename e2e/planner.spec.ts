import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, deskReady, ensureAccount, trySignIn } from './helpers';

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
  await deskReady(page, page.getByRole('navigation', { name: 'Lists' }).getByRole('link'));
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
  // Today is in what is shown. (It is at the top when there is enough below it to scroll that far; a feed of a few cards cannot.) A layout is measured in
  // fractions of a pixel, and a fraction either way (-0.5 on CI's fonts) is still at the top.
  expect(offset).toBeGreaterThanOrEqual(-1);
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

async function newList(page: Page, name: string) {
  // A click made before the page has its handlers is lost: it is made again until the field is there.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add a list' }).click();
    await expect(page.getByLabel('New list name')).toBeVisible({ timeout: 1500 });
  }).toPass();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  // Written to the working copy before the page is left: a navigation straight after would race it.
  await expect(
    page
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${name}`) }),
  ).toBeVisible();
}

async function deskCardToday(
  page: Page,
  list: string,
  title: string,
  time: string | null,
  end: string | null = null,
) {
  await page.goto('/desk');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${list}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: list })).toBeVisible();
  await page.getByLabel('Add a card').fill(title);
  await page.getByLabel('Add a card').press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('link', { name: title }).click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByRole('button', { name: 'Set a due date' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  if (time) await page.getByLabel('Time', { exact: true }).fill(time);
  if (end) await page.getByLabel('Until').fill(end);
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: /^Today/ })).toBeVisible();
}

test('a day reads in the order of the day, with the line for now between the cards that have gone and those to come, and a card opens over the feed', async ({
  page,
}) => {
  await signedIn(page);
  const list = unique('Order');
  await newList(page, list);
  const [anytime, early, late] = [unique('Anytime'), unique('Early'), unique('Late')];
  // The latest first, so the order is the day's and not the order they were made in.
  await deskCardToday(page, list, late, '23:59');
  await deskCardToday(page, list, early, '00:00');
  await deskCardToday(page, list, anytime, null);

  await page.goto('/planner');
  const today = page.locator('[aria-current="date"]');
  await expect(today.getByText(late)).toBeVisible();
  const items = today.locator('ul > li');
  const texts = await items.evaluateAll((els) =>
    els.map((el) =>
      el.hasAttribute('data-planner-now') ? '— now —' : (el.textContent ?? '').trim(),
    ),
  );
  const at = (name: string) => texts.findIndex((text) => text.includes(name));
  // No time first, named; then by time; the line for now between the one that has gone and the one to come.
  expect(texts[0]).toBe('Any time');
  expect(at(anytime)).toBeLessThan(at(early));
  expect(at(early)).toBeLessThan(texts.indexOf('— now —'));
  expect(texts.indexOf('— now —')).toBeLessThan(at(late));
  expect(await page.locator('[data-planner-now]').count()).toBe(1);

  // A card opens over the feed, which stays; closing it leaves the feed as it was.
  await today.getByRole('link', { name: new RegExp(anytime) }).click();
  await expect(page).toHaveURL(/\/planner\?card=/);
  await expect(page.getByRole('region', { name: 'Card' })).toBeVisible();
  await expect(today.getByText(late)).toBeVisible();
  await page.getByRole('region', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/planner$/);
  await expect(page.getByRole('region', { name: 'Card' })).toHaveCount(0);
});

test('coming back to the feed is to the place the reader left, with the runs they opened still open', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/planner');
  await expect(page.locator('[aria-current="date"]')).toBeVisible();
  await page
    .getByRole('button', { name: /nothing planned$/ })
    .first()
    .click();
  const scroller = page.locator('div[aria-label="Planner"]');
  await scroller.evaluate((el) => el.scrollTo({ top: 900 }));
  const place = () =>
    scroller.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const day = [...el.querySelectorAll('[data-planner-day]')].find(
        (each) => each.getBoundingClientRect().bottom > top + 1,
      );
      return {
        date: day?.getAttribute('data-planner-day') ?? '',
        offset: Math.round((day?.getBoundingClientRect().top ?? 0) - top),
      };
    });
  const left = await place();
  expect(left.date).not.toBe('');
  // The place is kept a moment after the reader stops.
  await page.waitForTimeout(400);
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('[aria-current="date"]')).toBeVisible();
  await expect.poll(place).toEqual(left);
});

test('a card is added from an empty day, from the end of a day and from a gap between timed cards, onto that day', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/planner');
  const today = page.locator('[aria-current="date"]');
  await expect(today).toBeVisible();
  const dayBefore = today.locator('xpath=preceding-sibling::li[1]');
  await expect(dayBefore).toHaveAttribute('data-planner-day', /^\d{4}-\d{2}-\d{2}$/);

  // From a day's own row, empty or not: the dialog says which day, and the card is on it at once.
  const one = unique('From a day');
  await dayBefore.locator('[data-planner-add]').first().click();
  const dialog = page.getByRole('dialog', { name: 'New card' });
  await expect(dialog.getByText(/^Due /)).toBeVisible();
  await dialog.getByLabel('Title').fill(one);
  await dialog.getByRole('button', { name: 'Add card' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(dayBefore.getByRole('link', { name: new RegExp(one) })).toBeVisible();

  // From a gap: two cards today, at least two hours apart, make a slot an hour after the first, and a card made there is at that time.
  const list = unique('Gap list');
  await page.goto('/desk');
  await newList(page, list);
  await deskCardToday(page, list, unique('Gap early'), '00:00');
  await deskCardToday(page, list, unique('Gap late'), '23:59');
  await page.goto('/planner');
  const slot = page.locator('[aria-current="date"] [data-planner-slot]').first();
  await expect(slot).toBeVisible();
  const label = ((await slot.textContent()) ?? '')
    .replace(/^Add at /, '')
    .replace(/\+$/, '')
    .trim();
  const two = unique('From a gap');
  await slot.click();
  const gapDialog = page.getByRole('dialog', { name: 'New card' });
  await expect(gapDialog.getByText(/^Due Today, /)).toBeVisible();
  await gapDialog.getByLabel('Title').fill(two);
  await gapDialog.getByRole('button', { name: 'Add card' }).click();
  const card = page.locator('[aria-current="date"]').getByRole('link', { name: new RegExp(two) });
  await expect(card).toBeVisible();
  await expect(
    card.getByText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)),
  ).toBeVisible();
  // The card is in the Desk, in the list it was added to, and the list is remembered for the next.
  await page.goto('/planner');
  await page.locator('[aria-current="date"] [data-planner-add]').first().click();
  await expect(page.getByRole('dialog', { name: 'New card' }).getByLabel('List')).toHaveValue(/.+/);
});

test('on a phone the footer’s new card on the Planner is due today', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/planner');
  await expect(page.locator('[aria-current="date"]')).toBeVisible();
  await page.getByRole('button', { name: 'Apps' }).click();
  await page
    .getByRole('dialog', { name: 'What to add' })
    .getByRole('button', { name: 'New card' })
    .click();
  await expect(page.getByRole('dialog', { name: 'New card' }).getByText('Due Today')).toBeVisible();
});

test('a repeating card shows its next days as previews, and completing it turns the first into the card', async ({
  page,
}) => {
  await signedIn(page);
  const list = unique('Repeats');
  await newList(page, list);
  const title = unique('Water');
  await deskCardToday(page, list, title, null);
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByRole('button', { name: 'Set a repeat' }).click();
  await page.getByRole('radio', { name: 'Daily' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(detail.getByRole('button', { name: 'Repeats every day' })).toBeVisible();

  await page.goto('/planner');
  const today = page.locator('[aria-current="date"]');
  const tomorrow = today.locator('xpath=following-sibling::li[1]');
  const after = today.locator('xpath=following-sibling::li[2]');
  const mine = (day: ReturnType<typeof page.locator>) =>
    day.locator(`[data-planner-card]`).filter({ hasText: title });
  // The card is on today; tomorrow and the day after have previews of it, drawn with the repeat mark.
  await expect(mine(today)).toHaveAttribute('data-planner-card', /^desk:/);
  await expect(mine(tomorrow)).toHaveAttribute('data-planner-card', /^preview:/);
  await expect(mine(after)).toHaveAttribute('data-planner-card', /^preview:/);
  await expect(mine(tomorrow)).toContainText('Repeats');

  // A preview opens the card there is.
  await mine(tomorrow).click();
  await expect(page).toHaveURL(/\/planner\?card=/);
  await expect(page.getByRole('region', { name: 'Card' }).getByLabel('Title')).toHaveValue(title);
  await page.getByRole('region', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();

  // Completing today's card makes tomorrow's: a card where the preview was, and the previews go on from it.
  await page.goto('/desk');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${list}`) })
    .click();
  await page.getByRole('checkbox', { name: `Done: ${title}` }).click();
  // The next card is made with the tick: it is on the list, due tomorrow, before the page is left.
  await expect(
    page.getByRole('listitem').filter({ hasText: title }).filter({ hasText: 'Tomorrow' }),
  ).toHaveCount(1);
  await page.goto('/planner');
  await expect(mine(page.locator('[aria-current="date"]'))).toHaveAttribute(
    'data-planner-card',
    /^desk:/,
  );
  const next = page.locator('[aria-current="date"]').locator('xpath=following-sibling::li[1]');
  await expect(mine(next)).toHaveAttribute('data-planner-card', /^desk:/);
  await expect(
    page.locator('[aria-current="date"]').locator('xpath=following-sibling::li[2]'),
  ).toContainText(title);

  // Stopping the repeat takes the previews away: they were only ever worked out from the rule. (It also leaves the shared account's Planner as it was.)
  await mine(next).click();
  const open = page.getByRole('region', { name: 'Card' });
  await open.getByRole('button', { name: 'Repeats every day' }).click();
  await page.getByRole('radio', { name: 'Does not repeat' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(open.getByRole('button', { name: 'Set a repeat' })).toBeVisible();
  await expect(
    page.locator('[data-planner-card^="preview:"]').filter({ hasText: title }),
  ).toHaveCount(0);
});

test('a card with an end is as tall as it is long, and free time is what is left between them (task 19.5)', async ({
  page,
}) => {
  await signedIn(page);
  const list = unique('Length');
  await newList(page, list);
  const [hour, two, open] = [unique('One hour'), unique('Two hours'), unique('No end')];
  // Times that no other test uses, so that the free time between them is theirs alone.
  await deskCardToday(page, list, hour, '03:10', '04:10');
  await deskCardToday(page, list, two, '05:40', '07:40');
  await deskCardToday(page, list, open, '12:00');

  await page.goto('/planner');
  const today = page.locator('[aria-current="date"]');
  const card = (title: string) => today.locator('[data-planner-card]').filter({ hasText: title });
  await expect(card(two)).toBeVisible();
  const height = async (title: string) => (await card(title).boundingBox())?.height ?? 0;
  // One hour and two hours are 72 and 144 pixels: twice. A card with no end is the fixed height.
  const one = await height(hour);
  expect(one).toBeGreaterThan(56);
  expect(Math.abs((await height(two)) - 2 * one)).toBeLessThan(3);
  expect(await height(open)).toBeLessThan(one);
  await expect(card(hour)).toContainText(/3:10.*–.*4:10|03:10.*–.*04:10/);

  // Free time begins when the cards before are over: at 04:10, after the first, and at 07:40, after the second; a slot there makes a card there.
  const slots = await today
    .locator('[data-planner-slot]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-planner-slot')));
  expect(slots).toContain('04:10');
  expect(slots).toContain('07:40');
  // Not at 03:10's hour mark, which a card with an end would have said was taken until 04:10.
  expect(slots).not.toContain('04:00');
});

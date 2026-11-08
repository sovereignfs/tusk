import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Every page of DESIGN.md §17.11 at a phone's width (task 7.9, DESIGN.md §18), in Chromium and WebKit: the same addresses and the same data, one column at a time.
 * The sidebar and the lists are in a drawer the header's button opens; a card is a page of its own; a board's lists scroll sideways and stop at each; the card's
 * dialog fills the screen; and nothing on any page is wider than the screen. The iOS Simulator is for what these cannot say (touch, the keyboard), by hand.
 */
test.use({ viewport: { width: 375, height: 812 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

/** Nothing on the page makes it wider than the screen, so there is nothing to scroll sideways. */
async function fits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'Open the navigation' })).toBeVisible();
}

const drawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' });
async function openNavigation(page: Page) {
  await page.getByRole('button', { name: 'Open the navigation' }).click();
  await expect(drawer(page)).toBeVisible();
}

test('the pages for someone who is not signed in fit', async ({ page }) => {
  for (const path of ['/', '/sign-in']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await fits(page);
  }
});

test('the Desk is a list at a time, its lists and the places are in a drawer, and a card is a page of its own', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toHaveCount(0);
  await fits(page);

  // A card of this list's own.
  const title = unique('Buy oat milk');
  await page.getByPlaceholder('Add a card…').first().fill(title);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  // The drawer: the places, and the Desk's lists with a search.
  await openNavigation(page);
  await expect(drawer(page).getByRole('navigation', { name: 'Tusk' })).toBeVisible();
  await expect(drawer(page).getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await expect(drawer(page).getByRole('link', { name: 'Home' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);

  // A card opens as a page in place of the list, at the same address as on a desktop, and its Close goes back to the list.
  await page.getByRole('link', { name: title }).click();
  const detail = page.getByRole('region', { name: 'Card', exact: true });
  await expect(detail).toBeVisible();
  expect(page.url()).toContain('?card=');
  await expect(page.getByPlaceholder('Add a card…')).toHaveCount(0);
  const box = await detail.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(340);
  await fits(page);
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

test('a place chosen in the drawer is gone to, and the drawer is closed behind it', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await fits(page);
  await openNavigation(page);
  await drawer(page)
    .getByRole('link', { name: /^Inbox/ })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await fits(page);
  for (const path of ['/account', '/account?section=security', '/account?section=data']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    await fits(page);
  }
});

test('a workspace, a board, a card’s dialog and a published board are all usable, and the lists scroll sideways and stop at each', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.goto('/');
  const workspace = unique('Acme');
  // From the drawer, where the sidebar's + is (the page itself offers it only to someone with no workspace yet).
  await openNavigation(page);
  await drawer(page).getByRole('button', { name: 'Create a workspace' }).click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await fits(page);

  await page.getByRole('button', { name: 'Create board' }).click();
  const create = page.getByRole('dialog', { name: 'Create board' });
  await create.getByLabel('Name').fill('Roadmap');
  await create.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();

  // Lists: more than a screen's width of them.
  for (const name of ['Doing', 'Review', 'Shipped']) {
    await page.locator('button', { hasText: 'Add a list' }).click();
    await page.getByLabel('Name of the new list').fill(name);
    await page.getByRole('button', { name: 'Add list' }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await fits(page);
  const columns = page.locator('[class*="columns"]').first();
  expect(await columns.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain('x');
  expect(await columns.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const first = page.locator('section[aria-label]').first();
  const width = (await first.boundingBox())?.width ?? 0;
  expect(width).toBeGreaterThan(250);
  expect(width).toBeLessThanOrEqual(375);

  // A column has an address: the list that stops at the left edge is written to it, and a reload comes back there.
  const review = page.locator('section[aria-label="Review"]');
  const reviewId = (await review.getAttribute('data-list')) ?? '';
  expect(reviewId).toMatch(/^[0-9a-f-]{36}$/);
  await columns.evaluate((row, id) => {
    const target = row.querySelector(`[data-list="${id}"]`);
    if (!target) throw new Error('no such column');
    const left =
      target.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft - 16;
    row.scrollTo({ left });
  }, reviewId);
  await expect(page).toHaveURL(new RegExp(`/b/[0-9a-f-]{36}\\?list=${reviewId}$`));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`\\?list=${reviewId}$`));
  await expect(review).toBeVisible();
  const edge = (await review.boundingBox())?.x ?? -1;
  expect(edge).toBeGreaterThanOrEqual(0);
  expect(edge).toBeLessThan(40);

  // A card, and its dialog is the whole screen.
  const column = page.locator('section[aria-label="Backlog"]');
  await column.scrollIntoViewIfNeeded();
  await column.getByRole('button', { name: 'Add a card' }).click();
  const field = column.getByLabel('Title of a new card in Backlog');
  await field.fill('Ship it');
  await field.press('Enter');
  await column.getByLabel('Ship it', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Ship it' });
  await expect(dialog).toBeVisible();
  const frame = await dialog.boundingBox();
  expect(frame?.width ?? 0).toBeGreaterThanOrEqual(370);
  await expect(dialog.getByLabel('Title')).toBeVisible();
  await fits(page);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Published, and read as anyone reads it.
  await page.getByRole('button', { name: /Share board/ }).click();
  const share = page.getByRole('dialog', { name: 'Share board' });
  await share.getByRole('button', { name: 'Publish board' }).click();
  const address = share.getByLabel('Public address');
  await expect(address).toHaveValue(/\/p\/[A-Za-z0-9_-]{43}$/);
  const path = new URL(await address.inputValue()).pathname;
  await share.getByRole('button', { name: 'Close' }).click();
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
  await fits(page);
});

test('the Desk is a carousel of its lists on a phone: a swipe changes the address, a reload returns there, and a link to a list moves it', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/desk');
  // Three lists, made from the drawer as anyone makes them; the first is Backlog.
  const names = [unique('Alpha'), unique('Beta')] as const;
  const [alpha, beta] = names;
  for (const name of names) {
    await openNavigation(page);
    await drawer(page).getByRole('button', { name: 'Add a list' }).click();
    await drawer(page).getByLabel('New list name').fill(name);
    await drawer(page).getByLabel('New list name').press('Enter');
    await expect(drawer(page).getByRole('link', { name })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
  }

  const scroller = page.getByRole('region', { name: 'Your lists' });
  await expect(scroller).toBeVisible();
  await fits(page);
  const slides = page.getByRole('tab');
  expect(await slides.count()).toBeGreaterThanOrEqual(3);

  // Swiping to the next slide (the native scroll the carousel snaps) settles, and the address is that list's. No spinner is on the way.
  // (The account is shared with other tests, so the slide is found by its name.)
  const at = (
    await slides.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  ).indexOf(alpha);
  expect(at).toBeGreaterThan(0);
  await scroller.dispatchEvent('pointerdown');
  await scroller.evaluate((el, n) => el.scrollTo({ left: n * el.clientWidth }), at);
  await expect(page).toHaveURL(/\/desk\/[0-9a-f-]{36}$/);
  const reached = page.url();
  await expect(page.getByRole('progressbar')).toHaveCount(0);

  // A reload returns to the same list, still at the same address.
  await page.reload();
  await expect(page).toHaveURL(reached);
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(alpha);

  // A link to another list (from the drawer) moves the carousel there.
  await openNavigation(page);
  await drawer(page).getByRole('link', { name: beta }).click();
  await expect(page).not.toHaveURL(reached);
  await expect(page).toHaveURL(/\/desk\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(beta);
});

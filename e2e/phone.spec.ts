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

  // A column scrolls without pulling the page with it.
  expect(
    await page
      .locator('section[aria-label="Backlog"] [class*="cards"]')
      .evaluate((el) => getComputedStyle(el).overscrollBehaviorY),
  ).toBe('none');

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

  // The footer's action, inside a board: a new card goes into the list on screen (Review, which is at the edge), and a new list is offered too.
  const footer = page.getByRole('navigation', { name: 'App navigation' });
  await footer.getByRole('button', { name: 'Apps' }).click();
  const what = page.getByRole('dialog', { name: 'What to add' });
  await expect(what.getByRole('button', { name: 'New list' })).toBeVisible();
  await what.getByRole('button', { name: 'New card' }).click();
  const fromFooter = review.getByLabel('Title of a new card in Review');
  await fromFooter.fill('Added from the footer');
  await fromFooter.press('Enter');
  await expect(review.getByLabel('Added from the footer', { exact: true })).toBeVisible();

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

test('the phone has a footer of five: the places, and an action that fits where you are', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.goto('/desk');
  const footer = page.getByRole('navigation', { name: 'App navigation' });
  await expect(footer).toBeVisible();
  for (const name of ['Desk', 'Boards', 'Planner', 'Inbox'])
    await expect(footer.getByRole('link', { name })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Desk' })).toHaveAttribute('aria-current', 'page');
  await expect(footer.getByRole('button', { name: 'Apps' })).toBeVisible();
  await fits(page);
  // It publishes its own height, which sheets clear.
  const published = await page.evaluate(
    () =>
      document.getElementById('sv-app-shell')?.style.getPropertyValue('--sv-shell-footer-height') ??
      '',
  );
  const height = (await footer.boundingBox())?.height ?? 0;
  expect(Number.parseFloat(published)).toBeGreaterThan(40);
  expect(Math.abs(Number.parseFloat(published) - height)).toBeLessThan(2);

  // On the Desk: a new card goes into the list on screen, and each form has a name.
  const what = page.getByRole('dialog', { name: 'What to add' });
  await footer.getByRole('button', { name: 'Apps' }).click();
  for (const name of ['New card', 'New list', 'Go to a list'])
    await expect(what.getByRole('button', { name })).toBeVisible();
  await what.getByRole('button', { name: 'New card' }).click();
  const dialog = page.getByRole('dialog', { name: 'New card' });
  const title = unique('From the footer');
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Add card' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible();

  // On Boards the action is a new board and a new workspace.
  await footer.getByRole('link', { name: 'Boards' }).click();
  await expect(page).toHaveURL(/\/$/);
  await footer.getByRole('button', { name: 'Apps' }).click();
  await expect(what.getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(what.getByRole('button', { name: 'New workspace' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The places are links: the Inbox is one.
  await footer.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(footer.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
});

test.describe('touch gestures on a Desk row', () => {
  // Real touch events (the DevTools protocol's), which only Chromium can send; WebKit's touch is for the iOS Simulator, by hand.
  test.use({ hasTouch: true, isMobile: true });
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'touch events are sent through Chromium',
  );

  type Touch = 'touchStart' | 'touchMove' | 'touchEnd';
  async function swipeLeft(page: Page, from: { x: number; y: number }, by: number) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: Touch, x: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: from.y }],
      });
    await send('touchStart', from.x);
    for (let moved = 20; moved <= by; moved += 20) {
      await send('touchMove', from.x - moved);
      await page.waitForTimeout(25);
    }
    await send('touchEnd', from.x - by);
    await cdp.detach();
  }

  test('a swipe on a row shows Done and Delete and does not move the carousel; Done completes it and Delete offers Undo', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/desk');
    const title = unique('Swipe me');
    await page.getByPlaceholder('Add a card…').first().fill(title);
    await page.keyboard.press('Enter');
    const link = page.getByRole('link', { name: title });
    await expect(link).toBeVisible();
    const row = page.locator('li').filter({ has: link });
    const box = await link.boundingBox();
    if (!box) throw new Error('no row');
    const at = { x: box.x + box.width * 0.7, y: box.y + box.height / 2 };

    // A handle is drawn for a touch to reorder by, and a mouse has none.
    await expect(row.locator('[data-handle]')).toBeVisible();

    // A swipe slides the row aside: Done and Delete are there, and the list on screen is still the same one.
    const before = page.url();
    await swipeLeft(page, at, 160);
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Done' })).toBeVisible();
    expect(page.url()).toBe(before);

    // Done completes the card and closes the row.
    await row.getByRole('button', { name: 'Done' }).click();
    // Done: the card is ticked, or, where this list hides its completed cards (a setting another test may have left), it is gone from the list.
    await expect(async () => {
      const gone = (await link.count()) === 0;
      const ticked =
        !gone && (await row.getByRole('checkbox', { name: `Done: ${title}` }).isChecked());
      expect(gone || ticked).toBe(true);
    }).toPass();

    // Another card: Delete removes it and offers Undo, which brings it back.
    const other = unique('Delete me');
    await page.getByPlaceholder('Add a card…').first().fill(other);
    await page.keyboard.press('Enter');
    const otherLink = page.getByRole('link', { name: other });
    await expect(otherLink).toBeVisible();
    const otherBox = await otherLink.boundingBox();
    if (!otherBox) throw new Error('no row');
    await swipeLeft(
      page,
      { x: otherBox.x + otherBox.width * 0.7, y: otherBox.y + otherBox.height / 2 },
      160,
    );
    await page
      .locator('li')
      .filter({ has: otherLink })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(otherLink).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: other })).toBeVisible();
  });

  test('a long press on a row chooses it, and a touch reorders only from the handle, after a press', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/desk');
    const names = [unique('First'), unique('Second'), unique('Third')];
    // Added one after another: each goes to the top, so the order on the screen is Third, Second, First.
    for (const name of names) {
      await page.getByPlaceholder('Add a card…').first().fill(name);
      await page.keyboard.press('Enter');
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
    const [first, second, third] = names as [string, string, string];
    const order = async () =>
      (
        await page
          .locator('li')
          .filter({ has: page.getByRole('link') })
          .allInnerTexts()
      )
        .map((text) => text.split('\n')[0] ?? '')
        .filter((text) => names.includes(text));
    await expect.poll(order).toEqual([third, second, first]);

    const cdp = await page.context().newCDPSession(page);
    const send = (type: Touch, x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });
    const centre = async (name: string) => {
      const box = await page.getByRole('link', { name }).boundingBox();
      if (!box) throw new Error('no row');
      return { x: box.x + box.width * 0.5, y: box.y + box.height / 2, box };
    };

    // A drag from the body of a row (a touch that moves after no press) is not a lift: the order is as it was.
    const body = await centre(first);
    await send('touchStart', body.x, body.y);
    for (let step = 1; step <= 6; step++) {
      await send('touchMove', body.x, body.y - step * 20);
      await page.waitForTimeout(30);
    }
    await send('touchEnd', body.x, body.y - 120);
    await expect.poll(order).toEqual([third, second, first]);

    // A long press on the body chooses the card, and the bar that acts on the chosen appears.
    await send('touchStart', body.x, body.y);
    await page.waitForTimeout(1500);
    await send('touchEnd', body.x, body.y);
    await expect(page.getByRole('toolbar', { name: 'Chosen cards' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('toolbar', { name: 'Chosen cards' })).toHaveCount(0);

    // A press on the handle, then a move, lifts the row and puts it where it is dropped: First goes to the top.
    const handle = page
      .locator('li')
      .filter({ has: page.getByRole('link', { name: first }) })
      .locator('[data-handle]');
    const grip = await handle.boundingBox();
    const top = await centre(third);
    if (!grip) throw new Error('no handle');
    const gx = grip.x + grip.width / 2;
    const gy = grip.y + grip.height / 2;
    await send('touchStart', gx, gy);
    await page.waitForTimeout(900);
    const travel = gy - top.y;
    for (let step = 1; step <= 12; step++) {
      await send('touchMove', gx, gy - (travel * step) / 12 - 4);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(200);
    await send('touchEnd', gx, top.y - 4);
    await expect.poll(order).toEqual([first, third, second]);
  });
});

test('Today and Review, from the footer, go through cards one at a time by their buttons: done, dismiss with Undo, skip and carry on', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signedIn(page);
  await page.goto('/desk');
  // Two cards, both starred (starred is what Today shows when nothing is due). Their titles begin with a mark that sorts before any other, so that they are the first
  // two of Today whatever else the shared account holds, and each is the other's kind (a before b).
  const alpha = `!a ${crypto.randomUUID().slice(0, 8)}`;
  const beta = `!b ${crypto.randomUUID().slice(0, 8)}`;
  for (const title of [alpha, beta]) {
    await page.getByPlaceholder('Add a card…').first().fill(title);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await page
      .locator('li')
      .filter({ has: page.getByRole('link', { name: title }) })
      .getByRole('button', { name: 'Star' })
      .click();
    await expect(
      page
        .locator('li')
        .filter({ has: page.getByRole('link', { name: title }) })
        .getByRole('button', { name: 'Remove the star' }),
    ).toBeVisible();
  }
  const footer = page.getByRole('navigation', { name: 'App navigation' });
  const apps = () => footer.getByRole('button', { name: 'Apps' }).click();
  const what = page.getByRole('dialog', { name: 'What to add' });
  const today = page.getByRole('dialog', { name: 'Today' });
  // The shared account may hold other cards that are overdue or due today, which Today shows before the starred: so a card is brought to the top by dismissing what is
  // above it (a dismissal lasts a day and is harmless here).
  // The stack renders the card under the top one first (hidden from the accessibility tree), so the card in front is the last title in the dialog.
  const front = () =>
    today
      .locator('[data-card-title]')
      .last()
      .textContent({ timeout: 5000 })
      .then((text) => text ?? '')
      .catch(() => '(none)');
  const toTop = async (title: string) => {
    for (let guard = 0; guard < 40; guard++) {
      const top = await front();
      if (top === title) return;
      if (top === '(none)') throw new Error('Today is empty');
      await today.getByRole('button', { name: 'Dismiss' }).click();
      // The card leaves with a short transition, during which the buttons do nothing: wait for the next one to be in front.
      await expect.poll(front).not.toBe(top);
    }
    throw new Error(`${title} never came to the top of Today`);
  };

  // Today is an overlay: the Desk is under it at the same address.
  const address = page.url();
  await apps();
  await what.getByRole('button', { name: 'Today' }).click();
  await expect(today).toBeVisible();
  for (const name of ['Done', 'Cancel', 'Dismiss', 'Star'])
    await expect(today.getByRole('button', { name })).toBeVisible();
  // The starred are ordered by title, and the page's own cards are the same ones (ours are among them).
  await toTop(alpha);
  await today.getByRole('button', { name: 'Done' }).click();
  await toTop(beta);

  // Dismiss hides it until tomorrow; closing leaves the Desk where it was, and Undo (still offered) brings it back.
  await today.getByRole('button', { name: 'Dismiss' }).click();
  // The Undo bar is offered once the dismissal is written: closing and looking again before then would look at the copy as it was.
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(today).toHaveCount(0);
  expect(page.url()).toBe(address);
  await apps();
  await what.getByRole('button', { name: 'Today' }).click();
  await expect(today.getByRole('button', { name: beta, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo' }).click();
  await apps();
  await what.getByRole('button', { name: 'Today' }).click();
  await toTop(beta);
  await page.keyboard.press('Escape');

  // Review: a pass can be stopped and gone on with. The card that was skipped goes to the end, and is not the first one when it is opened again.
  const gamma = unique('Gamma');
  await page.getByPlaceholder('Add a card…').first().fill(gamma);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: gamma })).toBeVisible();
  const review = page.getByRole('dialog', { name: 'Review' });
  await apps();
  await what.getByRole('button', { name: 'Review' }).click();
  await expect(review).toBeVisible();
  const first = await review.locator('[data-card-title]').last().textContent();
  await review.getByRole('button', { name: 'Skip' }).click();
  await page.keyboard.press('Escape');
  await apps();
  await what.getByRole('button', { name: 'Review' }).click();
  const next = await review.locator('[data-card-title]').last().textContent();
  expect(next).not.toBe(first);
  await page.keyboard.press('Escape');

  // Tidy up what this test made on the shared account: Beta is done from Today, and Gamma ticked on the Desk.
  await apps();
  await what.getByRole('button', { name: 'Today' }).click();
  await toTop(beta);
  await today.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: `Done: ${gamma}` }).check();
  // The shared account is read by the next browser's run from the server: let what was just written get there before this page goes.
  await page.waitForTimeout(2500);
});

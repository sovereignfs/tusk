import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Accessibility (task 7.7, DESIGN.md §17.8): axe, on every page of §17.11 and the surfaces that open over them, in light and dark, at a desktop's width and a
 * phone's, in Chromium and WebKit. **No serious or critical violation** is allowed; the lesser ones are listed in the output for whoever is looking, and are not
 * failures. What axe cannot say (focus order that makes sense, a screen reader's words) is the by-hand part of the task, written up in its epic.
 */
const WIDTHS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 375, height: 812 },
] as const;
const THEMES = ['light', 'dark'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Controls whose name does not begin with what is drawn on them (WCAG 2.5.3, `label-content-name-mismatch`), **named here so that the list is short and read, and
 * a new one is a failure**: the design system's own (`UserMenu`'s button reads "User menu" and draws the person's initials; the date picker's reads "Set a due
 * date" and draws a date, both to be raised in `@sovereignfs/ui`), and the board's Share button, a group of avatars whose name says what it does and whose
 * members' names are inside it. Only that one rule, and only for these controls, is let through; everything else is checked on them as on every other.
 */
const NAME_MISMATCH_ALLOWED = [
  'aria-label="User menu"',
  'aria-label="Set a due date"',
  'aria-label="Share board,',
];

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

interface Surface {
  name: string;
  /** Gets the page to this surface; it may open a dialog or a menu. */
  go(page: Page): Promise<void>;
  /** Without a session. */
  signedOut?: boolean;
}

/** What the seed made: addresses that are only known once it has run. */
const made: {
  list?: string;
  card?: string;
  workspace?: string;
  board?: string;
  published?: string;
} = {};

async function seed(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  // Signed in before going anywhere: a navigation while the sign-in is still answering cancels it.
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  // A list and a card on the Desk.
  await page.goto('/desk');
  await page.getByPlaceholder('Add a card…').fill('Water the plants');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Water the plants' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Water the plants' }).first().click();
  await expect(page.getByRole('region', { name: 'Card', exact: true })).toBeVisible();
  made.card = new URL(page.url()).search;
  made.list = '/desk';
  // A workspace, a board, a list with a card, published.
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a workspace' }).first().click();
  await page
    .getByRole('dialog', { name: 'Create a workspace' })
    .getByLabel('Name')
    .fill(unique('Acme'));
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  made.workspace = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Create board' }).click();
  const create = page.getByRole('dialog', { name: 'Create board' });
  await create.getByLabel('Name').fill('Roadmap');
  await create.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  made.board = new URL(page.url()).pathname;
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByRole('button', { name: 'Add a card' }).click();
  const field = column.getByLabel('Title of a new card in Backlog');
  await field.fill('Ship it');
  await field.press('Enter');
  await expect(column.getByLabel('Ship it', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Share board/ }).click();
  const share = page.getByRole('dialog', { name: 'Share board' });
  await share.getByRole('button', { name: 'Publish board' }).click();
  const address = share.getByLabel('Public address');
  await expect(address).toHaveValue(/\/p\/[A-Za-z0-9_-]{43}$/);
  made.published = new URL(await address.inputValue()).pathname;
}

const SURFACES: Surface[] = [
  { name: 'the landing page', signedOut: true, go: (p) => p.goto('/').then(() => undefined) },
  { name: 'sign in', signedOut: true, go: (p) => p.goto('/sign-in').then(() => undefined) },
  { name: 'the Desk', go: (p) => p.goto('/desk').then(() => undefined) },
  {
    name: 'a card on the Desk',
    go: async (p) => {
      await p.goto(`/desk${made.card}`);
      await expect(p.getByRole('region', { name: 'Card', exact: true })).toBeVisible();
    },
  },
  { name: 'the boards index', go: (p) => p.goto('/boards').then(() => undefined) },
  { name: 'a workspace', go: (p) => p.goto(made.workspace as string).then(() => undefined) },
  {
    name: 'a board',
    go: async (p) => {
      await p.goto(made.board as string);
      await expect(p.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();
    },
  },
  {
    name: 'a card’s dialog',
    go: async (p) => {
      await p.goto(made.board as string);
      await p
        .locator('section[aria-label="Backlog"]')
        .getByLabel('Ship it', { exact: true })
        .click();
      await expect(p.getByRole('dialog', { name: 'Ship it' })).toBeVisible();
    },
  },
  {
    name: 'the share dialog',
    go: async (p) => {
      await p.goto(made.board as string);
      await p.getByRole('button', { name: /Share board/ }).click();
      await expect(p.getByRole('dialog', { name: 'Share board' })).toBeVisible();
    },
  },
  { name: 'the Inbox', go: (p) => p.goto('/inbox').then(() => undefined) },
  { name: 'the Planner', go: (p) => p.goto('/planner').then(() => undefined) },
  ...['profile', 'security', 'preferences', 'notifications', 'activity', 'data'].map((section) => ({
    name: `Settings, ${section}`,
    go: async (p: Page) => {
      await p.goto(`/account?section=${section}`);
      await expect(p.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    },
  })),
  {
    name: 'a published board',
    signedOut: true,
    go: (p) => p.goto(made.published as string).then(() => undefined),
  },
];

async function scan(page: Page): Promise<string[]> {
  // Let the page settle: skeletons gone, fonts in.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const analysed = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const result = {
    violations: analysed.violations
      .map((v) =>
        v.id === 'label-content-name-mismatch'
          ? {
              ...v,
              nodes: v.nodes.filter(
                (n) => !NAME_MISMATCH_ALLOWED.some((ok) => n.html.includes(ok)),
              ),
            }
          : v,
      )
      .filter((v) => v.nodes.length > 0),
  };
  const lines = result.violations.map(
    (v) =>
      `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}: ${v.nodes
        .slice(0, 3)
        .map((n) => `${n.target.join(' ')} ${n.html.slice(0, 160)}`)
        .join(' | ')}`,
  );
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  if (lines.length > 0) console.log(lines.join('\n'));
  return serious.map(
    (v) =>
      `${v.impact}: ${v.id}: ${v.help} (${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 4)
        .join(' | ')})`,
  );
}

test.describe.configure({ mode: 'serial' });

test('the surfaces are made', async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);
});

for (const theme of THEMES) {
  for (const size of WIDTHS) {
    test(`no serious or critical violation: ${theme}, ${size.name}`, async ({ page, browser }) => {
      test.setTimeout(240_000);
      const problems: string[] = [];
      const signedIn = page;
      await signedIn.setViewportSize({ width: size.width, height: size.height });
      await signedIn.emulateMedia({ colorScheme: theme });
      await trySignIn(signedIn, EMAIL, PASSWORD);
      await expect(signedIn.getByRole('button', { name: 'User menu' })).toBeVisible();
      const stranger = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        colorScheme: theme,
      });
      const visitor = await stranger.newPage();
      for (const surface of SURFACES) {
        const on = surface.signedOut ? visitor : signedIn;
        await surface.go(on);
        for (const found of await scan(on)) problems.push(`${surface.name}: ${found}`);
      }
      await stranger.close();
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}

test('focus returns to what opened a dialog or a menu, and a keyboard drag of a list is said aloud', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto(made.board as string);
  await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible();

  // A card's dialog, closed with Escape and with its button.
  // Opened from the keyboard: Safari does not focus a button that is clicked, so there is nothing for focus to return to unless it was there first.
  const open = async (opener: Locator) => {
    await opener.focus();
    await page.keyboard.press('Enter');
  };
  const card = page.locator('section[aria-label="Backlog"]').getByLabel('Ship it', { exact: true });
  await open(card);
  const dialog = page.getByRole('dialog', { name: 'Ship it' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();

  // The share dialog.
  const share = page.getByRole('button', { name: /Share board/ });
  await open(share);
  const shareDialog = page.getByRole('dialog', { name: 'Share board' });
  await expect(shareDialog).toBeVisible();
  await shareDialog.getByRole('button', { name: 'Close' }).click();
  await expect(shareDialog).toHaveCount(0);
  await expect(share).toBeFocused();

  // The board's menu.
  const menu = page.getByRole('button', { name: 'Board menu' });
  await open(menu);
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  await expect(menu).toBeFocused();

  // A drag by the keyboard says what it did, in a live region: a second list, picked up and moved before the first.
  await page.locator('button', { hasText: 'Add a list' }).click();
  await page.getByLabel('Name of the new list').fill('Doing');
  await page.getByRole('button', { name: 'Add list' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Doing' })).toBeVisible();
  const handle = page.locator('[aria-roledescription="sortable list"]', { hasText: 'Doing' });
  await handle.focus();
  // Every announcement, in order: each replaces the last in the live region, so one that is only read would be missed.
  await page.evaluate(() => {
    const heard: string[] = [];
    (window as unknown as { heard: string[] }).heard = heard;
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[aria-live]'))
        if (el.textContent && heard[heard.length - 1] !== el.textContent)
          heard.push(el.textContent);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const said = () =>
    page.evaluate(() => (window as unknown as { heard: string[] }).heard.join(' | '));
  // A frame between the keys, as a person's fingers leave: the drag measures where the lists are after each move.
  await page.keyboard.press('Space');
  await expect.poll(said).toMatch(/Picked up list Doing, position 2 of 2/);
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(said).toMatch(/Doing is over position 1 of 2/);
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await expect.poll(said).toMatch(/Dropped list Doing at position 1 of 2/);
  // Never an id: what dnd-kit says by itself reads one out.
  expect(await said()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
});

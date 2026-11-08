import { expect, test, type Page, type Route } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The bell and the Notifications page (tasks 8.8 and 8.9, DESIGN.md §16). This instance has one account, and a notice is never for the one who did it, so there are no
 * notices to be had here: the server's answers are stood in for by a small store that does what the routes do (a page, a count, read and dismiss for the ones named or all),
 * and these tests are of the screens, which the data-layer tests of the routes (who is told, who may read, one person's ids never another's) do not reach.
 */
// The service worker would answer these requests itself, past the stand-in; it is not what is being looked at here (`pwa.spec.ts` is).
test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

interface Stored {
  id: string;
  kind: string;
  actorName: string | null;
  workspaceId: string | null;
  boardId: string | null;
  cardId: string | null;
  subject: string;
  createdAt: number;
  read: boolean;
  dismissed: boolean;
}

const board = '3f2a1c52-9c1e-4a8e-8d52-5a0c2f4f9a11';
const card = '4c1b7d19-2f3e-4b6a-9d0e-1a2b3c4d5e6f';

function makeStore(now: number) {
  const notices: Stored[] = [
    ['n1', 'assigned', 'Ana', 'Pay the rent', 60_000],
    ['n2', 'comment', 'Ben', 'Pay the rent', 5 * 60_000],
    ['n3', 'brief', null, '2 due today', 3 * 3_600_000],
  ].map(([id, kind, actorName, subject, ago]) => ({
    id: String(id),
    kind: String(kind),
    actorName: actorName as string | null,
    workspaceId: null,
    boardId: kind === 'brief' ? null : board,
    cardId: kind === 'brief' ? null : card,
    subject: String(subject),
    createdAt: now - Number(ago),
    read: false,
    dismissed: false,
  }));
  const posts: { path: string; body: unknown }[] = [];
  const shown = () => notices.filter((each) => !each.dismissed);
  const unread = () => shown().filter((each) => !each.read).length;
  const handle = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'GET' && url.pathname === '/api/notifications/unread')
      return json({ unread: unread() });
    if (request.method() === 'GET' && url.pathname === '/api/notifications')
      return json({
        notices: shown().map(({ dismissed: _gone, ...row }) => row),
        more: false,
        unread: unread(),
      });
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { ids?: string[]; all?: true };
      posts.push({ path: url.pathname, body });
      const which = (each: Stored) => body.all === true || (body.ids ?? []).includes(each.id);
      if (url.pathname === '/api/notifications/read')
        for (const each of notices) if (which(each)) each.read = true;
      if (url.pathname === '/api/notifications/dismiss')
        for (const each of notices) if (which(each)) each.dismissed = true;
      return route.fulfill({ status: 204 });
    }
    return route.continue();
  };
  return { handle, posts, unread };
}

async function signedIn(page: Page, store: ReturnType<typeof makeStore>) {
  await page.route('**/api/notifications**', store.handle);
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('the bell is left of the avatar and says how many are unread; opened, it lists them with their words and how long ago', async ({
  page,
}) => {
  const store = makeStore(Date.now());
  await signedIn(page, store);
  const bell = page.getByRole('button', { name: 'Notifications (3 unread)' });
  await expect(bell).toBeVisible();
  const [bellBox, avatarBox] = await Promise.all([
    bell.boundingBox(),
    page.getByRole('button', { name: 'User menu' }).boundingBox(),
  ]);
  expect(bellBox && avatarBox && bellBox.x + bellBox.width <= avatarBox.x).toBe(true);
  await expect(bell).toContainText('3');

  await bell.click();
  const list = page.getByRole('list', { name: 'Notifications list' });
  await expect(list.getByRole('link', { name: 'Ana assigned you to Pay the rent' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Ben commented on Pay the rent' })).toBeVisible();
  await expect(list.getByRole('link', { name: '2 due today' })).toBeVisible();
  await expect(list.getByText('1m ago')).toBeVisible();
  await expect(list.getByText('5m ago')).toBeVisible();
  await expect(list.getByText('3h ago')).toBeVisible();
  await expect(list.getByLabel('Unread')).toHaveCount(3);
});

test('opening a notice reads it and goes where it points, dismissing and the two actions change the list and the count at once, and View all is the page', async ({
  page,
}) => {
  const store = makeStore(Date.now());
  await signedIn(page, store);
  await page.getByRole('button', { name: 'Notifications (3 unread)' }).click();
  const list = page.getByRole('list', { name: 'Notifications list' });

  // Opened: the one is read (and only that one), and the app goes to its card, without loading the page again.
  await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
  await list.getByRole('link', { name: 'Ana assigned you to Pay the rent' }).click();
  await expect(page).toHaveURL(new RegExp(`/b/${board}/c/${card}$`));
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
  expect(store.posts).toContainEqual({ path: '/api/notifications/read', body: { ids: ['n1'] } });
  // The panel was closed by the new place; the count is of the two left.
  await expect(page.getByRole('button', { name: 'Notifications (2 unread)' })).toBeVisible();

  // Dismissed: gone from the list and not counted.
  await page.getByRole('button', { name: 'Notifications (2 unread)' }).click();
  await page.getByRole('button', { name: 'Dismiss: Ben commented on Pay the rent' }).click();
  await expect(list.getByRole('link', { name: 'Ben commented on Pay the rent' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notifications (1 unread)' })).toBeVisible();
  expect(store.posts).toContainEqual({ path: '/api/notifications/dismiss', body: { ids: ['n2'] } });

  // View all: the page, which has what the bell has.
  await page.getByRole('link', { name: 'View all' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Pay the rent').first()).toBeVisible();
  await expect(page.locator('[data-notice]')).toHaveCount(2);
  await expect(page.locator('[data-notice="n1"]')).toHaveAttribute('data-read', 'true');
  await expect(page.locator('[data-notice="n3"]')).toHaveAttribute('data-read', 'false');

  // "Mark all read" on the page is the bell's too: nothing is unread, and the notices stay.
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.locator('[data-notice="n3"]')).toHaveAttribute('data-read', 'true');
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  expect(store.posts.at(-1)).toEqual({ path: '/api/notifications/read', body: { all: true } });
  expect(store.unread()).toBe(0);

  // "Clear all": nothing left in the page or the bell.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('Nothing new.')).toBeVisible();
  await expect(page.locator('[data-notice]')).toHaveCount(0);
  expect(store.posts.at(-1)).toEqual({ path: '/api/notifications/dismiss', body: { all: true } });
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Notifications list' }).getByText('Nothing new.'),
  ).toBeVisible();
});

test('a notice dismissed on the page is gone from the bell, and a change the server refuses is put right by reading again', async ({
  page,
}) => {
  const store = makeStore(Date.now());
  await signedIn(page, store);
  await page.goto('/notifications');
  await expect(page.locator('[data-notice]')).toHaveCount(3);
  await page.getByRole('button', { name: /^Dismiss: 2 due today/ }).click();
  await expect(page.locator('[data-notice]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Notifications (2 unread)' })).toBeVisible();

  // The server will not take the next read: the page shows it for a moment and then what the server holds.
  await page.route('**/api/notifications/read', (route) => route.fulfill({ status: 500 }));
  await page.locator('[data-notice="n1"]').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/b/${board}/c/${card}$`));
  await page.goto('/notifications');
  await expect(page.locator('[data-notice="n1"]')).toHaveAttribute('data-read', 'false');
  await expect(page.getByRole('button', { name: 'Notifications (2 unread)' })).toBeVisible();
});

test('the bell and the page work at a phone’s width without scrolling sideways, and the sidebar’s Inbox has no count', async ({
  page,
}) => {
  const store = makeStore(Date.now());
  await signedIn(page, store);
  // The name is the word alone: a count would have made it "Inbox, 3 unread".
  await expect(
    page
      .getByRole('navigation', { name: 'Tusk', exact: true })
      .getByRole('link', { name: 'Inbox', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/notifications');
  await expect(page.locator('[data-notice]')).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Notifications (3 unread)' }).click();
  await expect(page.getByRole('list', { name: 'Notifications list' })).toBeVisible();
});

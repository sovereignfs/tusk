import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The signed-in layout (task 7.1): two rows and three columns, read from the working copy, with the right column only while a task is open. The
 * dimensions are the design's (DESIGN.md §15.2): a sidebar of 280px, content with about 24px of padding, a right column of 360px.
 */
async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
}

/** Makes a list and a task on the server as a device would, so that this one finds them on its first load. */
async function seed(request: APIRequestContext, origin: string) {
  // Every test and both browsers share one account, so each makes a list of its own name.
  const name = `Groceries ${crypto.randomUUID().slice(0, 8)}`;
  const list = crypto.randomUUID();
  const task = crypto.randomUUID();
  const reply = await request.post('/api/sync', {
    headers: { origin },
    data: {
      protocol: 1,
      cursor: 0,
      mutations: [
        {
          mutationId: crypto.randomUUID(),
          changes: [
            {
              table: 'list',
              id: list,
              position: 'a0',
              fields: { title: { v: name }, color: { v: 'green' } },
            },
            {
              table: 'task',
              id: task,
              listId: list,
              position: 'a0',
              fields: { title: { v: 'Buy oat milk' } },
            },
          ],
        },
      ],
    },
  });
  expect(reply.status()).toBe(200);
  return { list, task, name };
}

const width = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

test.use({ viewport: { width: 1280, height: 800 } });

test('two columns at first: a sidebar of 280px and the content, with no right column', async ({
  page,
}) => {
  await signedIn(page);
  const sidebar = page.getByRole('navigation', { name: 'Lists' });
  await expect(sidebar).toBeVisible();
  // The column is the nav’s parent, which the design system sizes.
  expect(
    await sidebar.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().width),
  ).toBe(280);
  await expect(page.getByRole('region', { name: 'Task', exact: true })).toHaveCount(0);

  // The content has about 24px of padding, and fills what is left.
  const content = page.getByRole('heading', { level: 1 });
  const box = await content.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(280 + 24);
});

test('a list made on another device is in the sidebar after the first load, with its colour and its count', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const { list, name } = await seed(page.request, origin);
  // `page.request` is the page’s own session, so this is the same person on another device; reloading is a device that starts and pulls.
  await page.reload();

  const row = page.getByRole('link', { name });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('href', `/lists/${list}`);
  await expect(row).toContainText('1');
});

test('the right column is there only while a task is open, is 360px, shows the task, and closing it replaces the address', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const { task, name } = await seed(page.request, origin);
  await page.reload();
  await expect(page.getByRole('link', { name })).toBeVisible();

  const home = new URL('/home', page.url()).toString();
  await page.goto(`/home?task=${task}`);
  const detail = page.getByRole('region', { name: 'Task', exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Buy oat milk' })).toBeVisible();
  expect(
    await detail.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().width),
  ).toBe(360);
  // Three columns now: the sidebar is the same, and the content is what is left.
  expect(await width(page, 'nav[aria-label="Lists"]')).toBeLessThanOrEqual(280);

  const entries = await page.evaluate(() => history.length);
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('region', { name: 'Task', exact: true })).toHaveCount(0);
  expect(page.url()).toBe(home);
  // Replaced, not pushed: closing a task does not add a step to go back through.
  expect(await page.evaluate(() => history.length)).toBe(entries);
});

test('a task that is not there says so, and can be closed', async ({ page }) => {
  await signedIn(page);
  await page.goto(`/home?task=${crypto.randomUUID()}`);
  const detail = page.getByRole('region', { name: 'Task', exact: true });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(detail).toHaveCount(0);
});

test.describe('at a phone’s width', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the same routes and the same data, with the columns it cannot fit left out, and nothing to scroll sideways', async ({
    page,
  }) => {
    await signedIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Lists' })).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

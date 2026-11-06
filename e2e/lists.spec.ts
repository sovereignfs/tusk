import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Lists in a browser (task 3.3): made from the sidebar, shown at once with or without a network, and put in order by dragging.
 */
test.use({ viewport: { width: 1280, height: 800 } });

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  // Ready when the working copy is open and has the first list in it: before that the page is still being put together, and a field typed into may be
  // replaced under the keyboard.
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
}

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function addList(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
}

/** What the server has of this account, as a device that starts from nothing is sent it. */
async function onServer(page: Page, origin: string) {
  const reply = await page.request.post('/api/sync', {
    headers: { origin },
    data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
  });
  const body = await reply.json();
  return body.pull.rows.filter((row: { table: string }) => row.table === 'desk_list') as {
    id: string;
    position: string;
    deletedAt: number | null;
    fields: { title?: { v: string } };
  }[];
}

test('there is always a first list, made once however many devices come first', async ({
  page,
}) => {
  await signedIn(page);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('link', { name: /^Backlog/ })).toHaveCount(1);
});

test('a list is made from the +, appears at once, and opens', async ({ page, baseURL }) => {
  await signedIn(page);
  const name = unique('Garden');
  await addList(page, name);

  const row = page.getByRole('link', { name: new RegExp(`^${name}`) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('0');
  // The field is put away, and the person is where they were.
  await expect(page.getByLabel('New list name')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  await row.click();
  await expect(page).toHaveURL(/\/desk\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(row).toHaveAttribute('aria-current', 'page');

  // It reaches the server, and a device that starts later finds it.
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  await expect
    .poll(async () => (await onServer(page, origin)).some((l) => l.fields.title?.v === name))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
});

test('an empty name makes nothing, and Escape puts the field away', async ({ page }) => {
  await signedIn(page);
  // Counted once the lists are in the sidebar, and not while they are still being read from the device.
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const before = await page.getByRole('navigation', { name: 'Lists' }).getByRole('link').count();
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill('   ');
  await page.getByLabel('New list name').press('Enter');
  await expect(page.getByLabel('New list name')).toBeVisible();
  await page.getByLabel('New list name').press('Escape');
  await expect(page.getByLabel('New list name')).toHaveCount(0);
  expect(await page.getByRole('navigation', { name: 'Lists' }).getByRole('link').count()).toBe(
    before,
  );
});

test('with the network off a list is still made at once, and is sent when it comes back', async ({
  page,
  context,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const name = unique('Offline');
  await context.setOffline(true);
  await addList(page, name);
  // Nothing waits for the network: it is in the sidebar the moment it is made.
  await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await onServer(page, origin)).some((l) => l.fields.title?.v === name), {
      timeout: 20_000,
    })
    .toBe(true);
});

test('lists are dragged into order, at once, and the order is the same after a reload and on the server, with one row written', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const names = [unique('First'), unique('Second'), unique('Third')];
  for (const name of names) await addList(page, name);
  const sidebar = page.getByRole('navigation', { name: 'Lists' });
  const order = async () =>
    (await sidebar.getByRole('link').allInnerTexts())
      .map((text) => text.split('\n')[0] ?? '')
      .filter((text) => names.includes(text));
  await expect.poll(order).toEqual(names);
  await expect
    .poll(
      async () =>
        (await onServer(page, origin)).filter((l) => names.includes(l.fields.title?.v ?? ''))
          .length,
    )
    .toBe(3);
  const before = new Map((await onServer(page, origin)).map((l) => [l.id, l.position]));

  // The sidebar scrolls once an account has many lists (the tests share one): the three are brought into view together, and measured after that.
  await sidebar.getByRole('link', { name: new RegExp(`^${names[2]}`) }).scrollIntoViewIfNeeded();
  await sidebar.getByRole('link', { name: new RegExp(`^${names[0]}`) }).scrollIntoViewIfNeeded();
  await sidebar.getByRole('link', { name: new RegExp(`^${names[2]}`) }).scrollIntoViewIfNeeded();

  // The third is dragged above the first.
  const from = await sidebar.getByRole('link', { name: new RegExp(`^${names[2]}`) }).boundingBox();
  const to = await sidebar.getByRole('link', { name: new RegExp(`^${names[0]}`) }).boundingBox();
  if (!from || !to) throw new Error('rows are not on the page');
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2 - 8, { steps: 4 });
  await page.mouse.move(to.x + 20, to.y + 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(order).toEqual([names[2], names[0], names[1]]);
  // The same after a reload, which is a device starting and pulling from the server.
  await expect
    .poll(async () => {
      const rows = (await onServer(page, origin)).filter((l) =>
        names.includes(l.fields.title?.v ?? ''),
      );
      return rows.sort((a, b) => (a.position < b.position ? -1 : 1)).map((l) => l.fields.title?.v);
    })
    .toEqual([names[2], names[0], names[1]]);
  await page.reload();
  await expect.poll(order).toEqual([names[2], names[0], names[1]]);

  // One row changed its position, and the other two did not.
  const after = await onServer(page, origin);
  const changed = after.filter((l) => before.has(l.id) && before.get(l.id) !== l.position);
  expect(changed.map((l) => l.fields.title?.v)).toEqual([names[2]]);
});

test('a list that is not there says so and leads back, whether it never was or the id is nonsense', async ({
  page,
}) => {
  await signedIn(page);
  for (const id of [crypto.randomUUID(), 'not-an-id']) {
    await page.goto(`/desk/${id}`);
    await expect(page.getByRole('heading', { name: 'That list is not here' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to your lists' }).click();
    await expect(page).toHaveURL(/\/$/);
    // The page it leads to is the app, not only an address: the next step waits for it, and not for a navigation still on its way.
    await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

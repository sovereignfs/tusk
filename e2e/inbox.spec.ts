import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The Inbox (task 8.1, DESIGN.md §16): what is assigned to a person across their boards, the notifications and their kinds, the Inbox entry in the sidebar,
 * and the settings that turn a kind off. The instance has one account, and a notice is never for the one who did it, so who is told what is held by the
 * data-layer tests; this shows the screens and the routes.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('the Inbox lists what is assigned to the person across their boards, and has its entry in the sidebar', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/');
  const workspace = unique('Inbox');
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('button', { name: 'Create a workspace' })
    .click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  const workspaceUrl = page.url();
  await page.getByRole('button', { name: 'Create board' }).click();
  await page.getByRole('dialog', { name: 'Create board' }).getByLabel('Name').fill('Plan');
  await page
    .getByRole('dialog', { name: 'Create board' })
    .getByRole('button', { name: 'Create board' })
    .click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  // A title of its own: a run that failed half way leaves its workspace, and the Inbox lists what is assigned across every board.
  const card = unique('Mine to do');
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByRole('button', { name: 'Add a card' }).click();
  await column.getByLabel('Title of a new card in Backlog').fill(card);
  await column.getByLabel('Title of a new card in Backlog').press('Enter');
  await column.getByLabel(card, { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: card });
  await dialog.getByRole('button', { name: 'Assignees' }).click();
  await page.getByRole('checkbox', { name: 'Assign Ada' }).check();
  await dialog.getByRole('button', { name: 'Assignees' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // The sidebar's entry opens the Inbox, with the card under Assigned to me and a skeleton before it is read.
  await page
    .getByRole('navigation', { name: 'Tusk', exact: true })
    .getByRole('link', { name: 'Inbox', exact: true })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
  const assigned = page.getByRole('region', { name: 'Assigned to me' });
  await expect(assigned.getByRole('link', { name: card })).toBeVisible();
  await expect(assigned.getByText('Plan')).toBeVisible();
  // What a person is told is the bell's and not the Inbox's: nothing of the kind is here.
  await expect(page.getByRole('region', { name: 'Notifications' })).toHaveCount(0);
  await assigned.getByRole('link', { name: card }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}$/);

  await page.goto(workspaceUrl);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const wd = page.getByRole('dialog', { name: 'Delete workspace' });
  await wd.getByLabel('Type the name to confirm').fill(workspace);
  await wd.getByRole('button', { name: 'Delete this workspace' }).click();
});

test('Settings has Notifications: each kind on or off, kept with the account', async ({ page }) => {
  await signedIn(page);
  await page.goto('/account?section=notifications');
  const section = page.getByRole('heading', { name: 'Notifications', level: 2 });
  await expect(section).toBeVisible();
  // (The Inbox's own kind "My daily brief…" is a different checkbox, which stays.)
  // This server has no mail, no push keys and no core: nothing is offered outside the app, and it says why.
  await expect(page.getByText('Nothing leaves Tusk on this server')).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'A daily brief of what needs attention' }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Send by email/i })).toHaveCount(0);
  const assigned = page.getByRole('checkbox', { name: 'When I am assigned a card' });
  await expect(assigned).toBeChecked();
  await assigned.uncheck();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/settings')).json()) as { noticesOff: string[] })
          .noticesOff,
    )
    .toEqual(['assigned']);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'When I am assigned a card' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'When I am assigned a card' }).check();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/settings')).json()) as { noticesOff: string[] })
          .noticesOff,
    )
    .toEqual([]);
});

test('the Inbox and notification routes are for the signed-in, a body is closed, and reading and dismissing need this app’s own address', async ({
  page,
  playwright,
  baseURL,
}) => {
  await signedIn(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const stranger = await playwright.request.newContext({ baseURL: baseURL ?? 'http://localhost' });
  for (const path of [
    '/api/inbox',
    '/api/notifications',
    '/api/notifications/unread',
    '/api/settings',
  ])
    expect((await stranger.get(path)).status(), path).toBe(401);
  for (const path of ['/api/notifications/read', '/api/notifications/dismiss'])
    expect(
      (await stranger.post(path, { headers: { origin }, data: { all: true } })).status(),
      path,
    ).toBe(401);
  await stranger.dispose();

  // A cursor that is half given is a bad request; the account's own is fine. The old routes of the Inbox are gone.
  expect((await page.request.get('/api/notifications?beforeAt=abc&beforeId=nope')).status()).toBe(
    400,
  );
  expect((await page.request.get('/api/notifications?beforeAt=5')).status()).toBe(400);
  expect((await page.request.get('/api/notifications')).status()).toBe(200);
  expect((await (await page.request.get('/api/inbox')).json()) as object).toEqual({
    assigned: expect.any(Array),
  });
  expect((await page.request.get('/api/inbox/unread')).status()).toBe(404);
  expect((await page.request.post('/api/inbox/seen', { headers: { origin } })).status()).toBe(404);
  // A body is closed: ids or all, and nothing else.
  for (const data of [{}, { all: false }, { ids: ['x'] }, { all: true, ids: [] }])
    expect(
      (await page.request.post('/api/notifications/read', { headers: { origin }, data })).status(),
      JSON.stringify(data),
    ).toBe(400);
  // Reading and dismissing are writes: they need this app's own address.
  for (const path of ['/api/notifications/read', '/api/notifications/dismiss'])
    expect(
      (
        await page.request.post(path, {
          headers: { origin: 'https://evil.example.com' },
          data: { all: true },
        })
      ).status(),
      path,
    ).toBe(403);
  expect(
    (
      await page.request.post('/api/notifications/read', {
        headers: { origin },
        data: { all: true },
      })
    ).status(),
  ).toBe(204);
  const unread = (await (await page.request.get('/api/notifications/unread')).json()) as {
    unread: number;
  };
  expect(unread.unread).toBe(0);
  // A kind that is not one is refused in the settings.
  expect(
    (
      await page.request.patch('/api/settings', {
        headers: { origin },
        data: { noticesOff: ['gossip'] },
      })
    ).status(),
  ).toBe(400);
});

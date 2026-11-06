import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * A due date and time (task 4.2, DESIGN.md §11), on the Desk and on a board: chosen with one picker, shown as Today, Tomorrow or the day, kept after a
 * reload, and shown in the danger colour when it is before today. The time zone is set so that "today" is the same everywhere the test runs.
 */
test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin' });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('a Desk card gets a date and a time from the picker, shows them on its row, and keeps them after a reload', async ({
  page,
}) => {
  await signedIn(page);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const name = unique('Due');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByLabel('Add a card').fill('Pay the invoice');
  await page.getByLabel('Add a card').press('Enter');
  await page.getByRole('link', { name: 'Pay the invoice' }).click();
  const detail = page.getByRole('region', { name: 'Card' });

  await detail.getByRole('button', { name: 'Set a due date' }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByLabel('Time', { exact: true }).fill('09:30');
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: /^Due Tomorrow, / })).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Pay the invoice' })
      .getByText(/^Tomorrow, /),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Card' }).getByRole('button', { name: /^Due Tomorrow, / }),
  ).toBeVisible();

  // Cleared with its time.
  await page
    .getByRole('region', { name: 'Card' })
    .getByRole('button', { name: /^Due Tomorrow/ })
    .click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(
    page.getByRole('region', { name: 'Card' }).getByRole('button', { name: 'Set a due date' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Pay the invoice' })
      .getByText(/Tomorrow/),
  ).toHaveCount(0);
});

test('a card on a board gets a date from the dialog, shows it on its tile, shows a past date as overdue, and a time cannot exist without a date', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  await page.goto('/boards');
  const workspace = unique('Dated');
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
  const board = new URL(page.url()).pathname.split('/')[2] ?? '';
  const column = page.locator('section[aria-label="Backlog"]');
  await column.getByRole('button', { name: 'Add a card' }).click();
  await column.getByLabel('Title of a new card in Backlog').fill('Ship it');
  await column.getByLabel('Title of a new card in Backlog').press('Enter');
  await column.getByLabel('Ship it', { exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Ship it' });
  await dialog.getByRole('button', { name: 'Set a due date' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByLabel('Time', { exact: true }).fill('17:45');
  await page.keyboard.press('Escape');
  await expect(column.getByText(/Today, /)).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('dialog', { name: 'Ship it' }).getByRole('button', { name: /^Due Today, / }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Ship it' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(column.getByText(/Today, /)).toBeVisible();

  // A date before today is overdue: the tile's badge carries the danger style.
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const card = await page.request
    .get(`/api/boards/${board}`)
    .then((r) => r.json() as Promise<{ cards: { id: string }[] }>);
  const id = card.cards[0]?.id ?? '';
  const past = await page.request.post('/api/ops', {
    headers: { origin },
    data: {
      opId: crypto.randomUUID(),
      op: 'card.setDue',
      id,
      dueDate: '2020-01-02',
      dueTime: null,
    },
  });
  expect(((await past.json()) as { status: string }).status).toBe('applied');
  await page.reload();
  const badge = page.locator('section[aria-label="Backlog"]').getByText('Jan 2, 2020');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/overdue/);

  // A time with no date is refused by the door.
  const bad = await page.request.post('/api/ops', {
    headers: { origin },
    data: { opId: crypto.randomUUID(), op: 'card.setDue', id, dueDate: null, dueTime: '09:00' },
  });
  expect(bad.status()).toBe(400);

  await page.goto(workspaceUrl);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const wd = page.getByRole('dialog', { name: 'Delete workspace' });
  await wd.getByLabel('Type the name to confirm').fill(workspace);
  await wd.getByRole('button', { name: 'Delete this workspace' }).click();
});

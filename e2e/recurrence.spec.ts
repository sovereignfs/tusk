import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * A card that repeats (task 5.2, DESIGN.md §12): ticking it makes exactly one next, due after today, with its checklist unticked, and the same after a
 * reload. The repeat picker is task 5.3's, so the series is put on the server as another device would, and this device is told of it by its sync.
 */
test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin' });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
}

test('ticking a card that repeats makes one next, due after today, with its checklist unticked, and it survives a reload', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  // It is Friday 6 November in Berlin.
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const name = unique('Repeats');
  const [listId, cardId, seriesId] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const sent = await page.request.post('/api/sync', {
    headers: { origin },
    data: {
      protocol: 2,
      cursor: 0,
      mutations: [
        {
          mutationId: crypto.randomUUID(),
          changes: [
            { table: 'desk_list', id: listId, position: 'a0', fields: { title: { v: name } } },
            {
              table: 'desk_series',
              id: seriesId,
              listId,
              fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-10-30' } },
            },
            {
              table: 'desk_card',
              id: cardId,
              listId,
              position: 'a0',
              fields: {
                title: { v: 'Water the plants' },
                description: { v: 'The ones by the window' },
                dueDate: { v: '2026-10-30' },
                seriesId: { v: seriesId },
              },
            },
            {
              table: 'desk_check',
              id: crypto.randomUUID(),
              cardId,
              position: 'a0',
              fields: { title: { v: 'Fill the can' } },
            },
          ],
        },
      ],
    },
  });
  expect(sent.status()).toBe(200);
  expect(((await sent.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
    'applied',
  );

  // This device hears of it on its next sync.
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Water the plants' });
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel('Repeats')).toBeVisible();

  // A week late: ticking it makes one that is due tomorrow, not seven.
  await row.getByRole('checkbox', { name: 'Done: Water the plants' }).click();
  const open = page
    .getByRole('listitem')
    .filter({ hasText: 'Water the plants' })
    .filter({ hasText: 'Tomorrow' });
  await expect(open).toHaveCount(1);
  await page.getByRole('button', { name: /Completed \(1\)/ }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Water the plants' })).toHaveCount(2);

  // The next card has the copied description, the repeat in words, and its checklist item unticked.
  await open.getByRole('link', { name: 'Water the plants' }).click();
  const detail = page.getByRole('region', { name: 'Card' });
  await expect(detail.getByText('Repeats every day')).toBeVisible();
  await expect(detail.getByLabel('Description')).toHaveValue('The ones by the window');
  await expect(detail.getByRole('checkbox', { name: /Fill the can/ })).not.toBeChecked();

  // After a reload, still exactly one open occurrence and one done.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Water the plants' })
      .filter({ hasText: 'Tomorrow' }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();
});

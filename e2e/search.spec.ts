import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Search on the Desk (task 6.2, DESIGN.md §10.7): by title, description and checklist item, folded for case and accents, as text and not a pattern, shown
 * in the content column at `/desk?q=`, and run in the browser so that it works with the network off.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

test('typing in the search field finds cards by title, description and checklist item, as text, offline too', async ({
  page,
  context,
  baseURL,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const mark = crypto.randomUUID().slice(0, 8);
  const name = unique('Findable');
  const listId = crypto.randomUUID();
  const card = (title: string, extra: object = {}) => ({
    table: 'desk_card',
    id: crypto.randomUUID(),
    listId,
    position: `a${Math.floor(Math.random() * 1e6)}`,
    fields: { title: { v: title }, ...extra },
  });
  const milk = card(`Buy milk ${mark}`, { description: { v: 'The oat kind, for the porridge' } });
  const trip = card(`Plan trip ${mark}`);
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
            milk,
            trip,
            card(`Save 50% today ${mark}`),
            card(`Fifty percent ${mark}`),
            card(`Un café ${mark}`),
            card(`Left alone ${mark}`),
            {
              table: 'desk_check',
              id: crypto.randomUUID(),
              cardId: milk.id,
              position: 'a0',
              fields: { title: { v: 'wholemeal bread' } },
            },
            {
              table: 'desk_check',
              id: crypto.randomUUID(),
              cardId: trip.id,
              position: 'a0',
              fields: { title: { v: 'book a CAFÉ for the evening' } },
            },
          ],
        },
      ],
    },
  });
  expect(sent.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search the Desk' });
  const results = page.getByRole('region', { name: 'Search results' });
  const hit = (title: string) => results.getByRole('listitem').filter({ hasText: title });

  // From a list's page, the first letters go to the results; a word found in a title, a description and an item.
  await search.fill(`${mark} milk`);
  await expect(page).toHaveURL(new RegExp(`/desk\\?q=`));
  await expect(results.getByRole('status')).toContainText('1 card matches');
  await expect(hit(`Buy milk ${mark}`)).toHaveCount(1);
  await search.fill(`porridge ${mark}`);
  await expect(hit(`Buy milk ${mark}`)).toHaveCount(1);
  // A checklist match shows under its card.
  await search.fill(`bread ${mark}`);
  await expect(
    hit(`Buy milk ${mark}`).getByRole('list', { name: 'Checklist items that match' }),
  ).toContainText('wholemeal bread');

  // É finds é, and the item that has it is shown under its card.
  await search.fill(`É ${mark}`);
  await expect(hit(`Un café ${mark}`)).toHaveCount(1);
  await expect(hit(`Plan trip ${mark}`)).toHaveCount(1);
  await expect(hit(`Plan trip ${mark}`)).toContainText('book a CAFÉ for the evening');

  // A % is a %, and not "anything".
  await search.fill(`% ${mark}`);
  await expect(results.getByRole('status')).toContainText('1 card matches');
  await expect(hit(`Save 50% today ${mark}`)).toHaveCount(1);
  // The characters of a pattern are not a pattern: no card has this text in it, though every one would match it as one.
  await search.fill(`[a-z]+ (.*) ${mark}`);
  await expect(results.getByRole('status')).toContainText('Nothing matches');

  // It is kept in the address, and in the field, after a reload.
  await search.fill(`fifty ${mark}`);
  await expect(hit(`Fifty percent ${mark}`)).toHaveCount(1);
  await page.reload();
  await expect(search).toHaveValue(`fifty ${mark}`);
  await expect(hit(`Fifty percent ${mark}`)).toHaveCount(1);

  // With the network off, a search is still a search: it is the device's own.
  await context.setOffline(true);
  await search.fill(`bread ${mark}`);
  await expect(hit(`Buy milk ${mark}`)).toHaveCount(1);
  await context.setOffline(false);

  // A hit opens the card where it is.
  await hit(`Buy milk ${mark}`)
    .getByRole('link', { name: `Buy milk ${mark}` })
    .click();
  await expect(page.getByRole('region', { name: 'Card' }).getByLabel('Title')).toHaveValue(
    `Buy milk ${mark}`,
  );
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  // Escape in the field empties it, and the Desk is its first list again.
  await search.fill(`milk ${mark}`);
  await expect(results).toBeVisible();
  await search.press('Escape');
  await expect(results).toHaveCount(0);
  await expect(search).toHaveValue('');
});

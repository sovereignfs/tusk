import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Acting on several cards at once (task 3.11, DESIGN.md §10.6): ctrl or cmd chooses a card (its box already means done), a click then chooses more and
 * opens nothing, and a bar completes them (a repeating one making its next), moves them to another list, or deletes them with one Undo.
 */
test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'Europe/Berlin' });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

const rows = (page: Page) =>
  page
    .getByRole('list')
    .filter({ has: page.getByRole('checkbox') })
    .first()
    .getByRole('listitem');
const titles = async (page: Page) =>
  (await rows(page).getByRole('link').allInnerTexts()).map((text) => text.trim());
const row = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });

test('ctrl-click chooses cards, a click then chooses and opens nothing, and the bar completes, moves and deletes them', async ({
  page,
  baseURL,
}) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  // It is Friday 6 November in Berlin.
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const [nameA, nameB] = [unique('Here'), unique('There')];
  const [listA, listB, seriesId] = [1, 2, 3].map(() => crypto.randomUUID()) as [
    string,
    string,
    string,
  ];
  const cardIds = Object.fromEntries(['a', 'b', 'c', 'd'].map((t) => [t, crypto.randomUUID()]));
  const card = (title: string, position: string, extra: object = {}) => ({
    table: 'desk_card',
    id: cardIds[title],
    listId: listA,
    position,
    fields: { title: { v: title }, ...extra },
  });
  const sent = await page.request.post('/api/sync', {
    headers: { origin },
    data: {
      protocol: 2,
      cursor: 0,
      mutations: [
        {
          mutationId: crypto.randomUUID(),
          changes: [
            { table: 'desk_list', id: listA, position: 'a0', fields: { title: { v: nameA } } },
            { table: 'desk_list', id: listB, position: 'a1', fields: { title: { v: nameB } } },
            {
              table: 'desk_series',
              id: seriesId,
              listId: listA,
              fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-11-06' } },
            },
            card('a', 'a0'),
            card('b', 'a1'),
            // Due tomorrow, so that nothing is pinned to the top for being due today.
            card('c', 'a2', { dueDate: { v: '2026-11-07' }, seriesId: { v: seriesId } }),
            card('d', 'a3'),
            {
              table: 'desk_check',
              id: crypto.randomUUID(),
              cardId: cardIds.a,
              position: 'a0',
              fields: { title: { v: 'an item' } },
            },
          ],
        },
      ],
    },
  });
  expect(sent.status()).toBe(200);
  await page.reload();
  const sidebar = page.getByRole('navigation', { name: 'Lists' });
  await sidebar.getByRole('link', { name: new RegExp(`^${nameA}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: nameA })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(['a', 'b', 'c', 'd']);
  const bar = page.getByRole('toolbar', { name: 'Chosen cards' });
  const link = (title: string) => page.getByRole('link', { name: title, exact: true });

  // Ctrl or cmd chooses; it does not open the card, and Escape lets go.
  await link('a').click({ modifiers: ['ControlOrMeta'] });
  await link('b').click({ modifiers: ['ControlOrMeta'] });
  await expect(bar.getByRole('status')).toHaveText('2 chosen');
  await expect(page).not.toHaveURL(/\?card=/);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);

  // Once one is chosen a plain click chooses more, and again un-chooses; none of it opens a card.
  await link('a').click({ modifiers: ['ControlOrMeta'] });
  await link('c').click();
  await link('b').click();
  await expect(bar.getByRole('status')).toHaveText('3 chosen');
  await link('b').click();
  await expect(bar.getByRole('status')).toHaveText('2 chosen');
  await expect(row(page, 'a')).toContainText('Chosen');
  await expect(page).not.toHaveURL(/\?card=/);

  // Complete: a is done with its item, c is done and makes its next, one open occurrence at a time.
  await bar.getByRole('button', { name: 'Complete' }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual(['b', 'c', 'd']);
  await expect(row(page, 'c').filter({ hasText: 'Nov 8' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Completed \(2\)/ })).toBeVisible();

  // Move b and d to the other list: they go to its top in the order they had, and the repeating c stays.
  await link('b').click({ modifiers: ['ControlOrMeta'] });
  await link('d').click();
  await bar.getByLabel('Move to list').selectOption({ label: nameB });
  await expect(bar).toHaveCount(0);
  await expect.poll(() => titles(page)).toEqual(['c']);
  await sidebar.getByRole('link', { name: new RegExp(`^${nameB}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: nameB })).toBeVisible();
  await expect.poll(() => titles(page)).toEqual(['b', 'd']);

  // Delete both, with one Undo that brings back those two.
  await link('b').click({ modifiers: ['ControlOrMeta'] });
  await link('d').click();
  await bar.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => titles(page)).toEqual([]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => titles(page)).toEqual(['b', 'd']);
});

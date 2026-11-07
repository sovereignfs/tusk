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
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Lists' }).getByRole('link').first(),
  ).toBeVisible();
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
  await expect(detail.getByRole('button', { name: 'Repeats every day' })).toBeVisible();
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

test('the repeat picker sets a preset from the keyboard, a custom rule, keeps weekdays to weekly, and stops it', async ({
  page,
}) => {
  await signedIn(page);
  // It is Friday 6 November in Berlin.
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  const name = unique('Picker');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByLabel('Add a card').fill('Take out the bins');
  await page.getByLabel('Add a card').press('Enter');
  await page.getByRole('link', { name: 'Take out the bins' }).click();
  const detail = page.getByRole('region', { name: 'Card' });

  // From the keyboard alone: down through the choices to Weekly (which says its day), and Apply.
  await detail.getByRole('button', { name: 'Set a repeat' }).click();
  await page.getByRole('radio', { name: 'Does not repeat' }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Weekly on Friday' })).toBeChecked();
  // Choosing did not apply: the panel is still open, and the card does not repeat.
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  await expect(detail.getByRole('button', { name: 'Repeats every week on Friday' })).toBeVisible();
  // A card with no date is given one: the first date the rule matches from today.
  await expect(detail.getByRole('button', { name: /^Today/ })).toBeVisible();
  await expect(detail.getByText('Repeats every week on Friday')).toBeVisible();

  // Custom: every 2 weeks on Monday and Friday. Weekdays are weekly's: not carried to months, and back to weekly starts again from the date's.
  await detail.getByRole('button', { name: 'Repeats every week on Friday' }).click();
  await page.getByRole('radio', { name: 'Custom' }).check();
  await page.getByLabel('Every how many').fill('2');
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Unit').selectOption({ label: 'months' });
  await expect(page.getByRole('group', { name: 'On' })).toHaveCount(0);
  await page.getByLabel('Unit').selectOption({ label: 'weeks' });
  await expect(page.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Friday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Monday', exact: true }).click();
  await page.getByLabel('Ends').selectOption({ label: 'After a number of times' });
  await page.getByLabel('How many times').fill('3');
  await expect(page.getByText('Repeats every 2 weeks on Monday, Friday, 3 times')).toBeVisible();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(
    detail.getByRole('button', { name: 'Repeats every 2 weeks on Monday, Friday, 3 times' }),
  ).toBeVisible();

  // It is kept after a reload.
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Card' })
      .getByRole('button', { name: 'Repeats every 2 weeks on Monday, Friday, 3 times' }),
  ).toBeVisible();

  // A number that is not one cannot be applied.
  await page
    .getByRole('region', { name: 'Card' })
    .getByRole('button', { name: /repeats every 2 weeks/i })
    .click();
  await page.getByLabel('Every how many').fill('0');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await page.getByLabel('Every how many').fill('1');
  await expect(page.getByRole('button', { name: 'Apply' })).toBeEnabled();

  // Does not repeat: the card is a one-off again, and keeps its date.
  await page.getByRole('radio', { name: 'Does not repeat' }).check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByRole('region', { name: 'Card' }).getByRole('button', { name: 'Set a repeat' }),
  ).toBeVisible();
  await expect(page.getByText(/^Repeats every/)).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Card' }).getByRole('button', { name: /^Today/ }),
  ).toBeVisible();
});

test('editing a card that repeats: a rename and a new date apply from there on with no new row, done cards are left alone, and clearing the date ends it', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  // It is Friday 6 November in Berlin.
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const name = unique('Edits');
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
              fields: { rule: { v: 'FREQ=WEEKLY;BYDAY=FR' }, anchor: { v: '2026-11-06' } },
            },
            {
              table: 'desk_card',
              id: cardId,
              listId,
              position: 'a0',
              fields: {
                title: { v: 'Water the plants' },
                dueDate: { v: '2026-11-06' },
                seriesId: { v: seriesId },
              },
            },
          ],
        },
      ],
    },
  });
  expect(sent.status()).toBe(200);
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const cards = (title: string) => page.getByRole('listitem').filter({ hasText: title });

  // Done on Friday: the next is a week on, and has the name the card has.
  await cards('Water the plants').getByRole('checkbox', { name: 'Done: Water the plants' }).click();
  await expect(cards('Water the plants').filter({ hasText: 'Nov 13' })).toHaveCount(1);

  // The next is renamed and moved to Saturday: the rule follows to Saturdays, and no card is added.
  await cards('Water the plants').filter({ hasText: 'Nov 13' }).getByRole('link').click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByLabel('Title').fill('Water everything');
  await detail.getByLabel('Title').press('Enter');
  await expect(cards('Water everything')).toHaveCount(1);
  await detail.getByRole('button', { name: /^Nov 13/ }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.keyboard.press('Escape');
  await expect(
    detail.getByRole('button', { name: 'Repeats every week on Saturday' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: /Water/ })).toHaveCount(1);

  // Done on Saturday: the one after is a Saturday, with the new name; the card done before keeps the name it had.
  await cards('Water everything').getByRole('checkbox', { name: 'Done: Water everything' }).click();
  await expect(cards('Water everything').filter({ hasText: 'Nov 14' })).toHaveCount(1);
  await page.getByRole('button', { name: /Completed \(2\)/ }).click();
  await expect(cards('Water the plants')).toHaveCount(1);
  await expect(cards('Water everything')).toHaveCount(2);

  // Clearing the date ends it: the card is a one-off.
  await cards('Water everything').filter({ hasText: 'Nov 14' }).getByRole('link').click();
  await detail.getByRole('button', { name: /^Nov 14/ }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.keyboard.press('Escape');
  await expect(detail.getByRole('button', { name: 'Set a repeat' })).toBeVisible();
  // Only the occurrence done before still has the mark: it is history, and was never written.
  await expect(cards('Water everything').getByLabel('Repeats')).toHaveCount(1);
});

test('reopening takes away an untouched next, a changed next stays and the reopened card leaves, Undo of a delete keeps repeating, and a move takes the series along', async ({
  page,
  baseURL,
}) => {
  await signedIn(page);
  // It is Friday 6 November in Berlin.
  await page.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const [nameA, nameB] = [unique('Here'), unique('There')];
  const [listA, listB, cardId, seriesId] = [1, 2, 3, 4].map(() => crypto.randomUUID()) as [
    string,
    string,
    string,
    string,
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
            { table: 'desk_list', id: listA, position: 'a0', fields: { title: { v: nameA } } },
            { table: 'desk_list', id: listB, position: 'a1', fields: { title: { v: nameB } } },
            {
              table: 'desk_series',
              id: seriesId,
              listId: listA,
              fields: { rule: { v: 'FREQ=DAILY' }, anchor: { v: '2026-11-06' } },
            },
            {
              table: 'desk_card',
              id: cardId,
              listId: listA,
              position: 'a0',
              fields: {
                title: { v: 'Water' },
                dueDate: { v: '2026-11-06' },
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
  await page.reload();
  const sidebar = page.getByRole('navigation', { name: 'Lists' });
  await sidebar.getByRole('link', { name: new RegExp(`^${nameA}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: nameA })).toBeVisible();
  const row = (title: string) =>
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });
  const tickBox = (title: string, checked: boolean) =>
    page.getByRole('checkbox', { name: `Done: ${title}`, checked });

  // A tick, and the undo of it: the starting rows, and nothing else.
  await tickBox('Water', false).click();
  await expect(row('Water').filter({ hasText: 'Tomorrow' })).toHaveCount(1);
  await page.getByRole('button', { name: /Completed \(1\)/ }).click();
  await tickBox('Water', true).click();
  await expect(row('Water')).toHaveCount(1);
  await expect(row('Water').filter({ hasText: 'Today' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);
  await expect(row('Water').getByLabel('Repeats')).toBeVisible();

  // A tick, the next renamed, and the first reopened: two open cards, and only the next repeats.
  await tickBox('Water', false).click();
  await row('Water').filter({ hasText: 'Tomorrow' }).getByRole('link').click();
  const detail = page.getByRole('region', { name: 'Card' });
  await detail.getByLabel('Title').fill('Water more');
  await detail.getByLabel('Title').press('Enter');
  await expect(row('Water more')).toHaveCount(1);
  // The list remembers that Completed is open.
  await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();
  await tickBox('Water', true).click();
  await expect(row('Water')).toHaveCount(1);
  await expect(row('Water').getByLabel('Repeats')).toHaveCount(0);
  await expect(row('Water more').getByLabel('Repeats')).toBeVisible();

  // Delete, and Undo: it repeats still.
  await row('Water more').getByRole('link').click();
  await detail.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row('Water more')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row('Water more').getByLabel('Repeats')).toBeVisible();

  // A move takes the series with it: ticked in the other list, the next is made there.
  await row('Water more').getByRole('link').click();
  await detail.getByLabel('List', { exact: true }).selectOption({ label: nameB });
  await expect(row('Water more')).toHaveCount(0);
  await sidebar.getByRole('link', { name: new RegExp(`^${nameB}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: nameB })).toBeVisible();
  await tickBox('Water more', false).click();
  await expect(row('Water more').filter({ hasText: 'Nov 8' })).toHaveCount(1);
  await sidebar.getByRole('link', { name: new RegExp(`^${nameA}`) }).click();
  await expect(row('Water more')).toHaveCount(0);
});

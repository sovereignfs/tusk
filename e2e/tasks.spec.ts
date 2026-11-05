import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Tasks in a browser (task 3.4): added from the keyboard, ticked, edited as you leave a field, deleted with Undo, and all of it with the network off.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;

/** A list of its own, opened, so that a test does not share its tasks with another. */
async function openNewList(page: Page): Promise<{ name: string; url: string }> {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
  // The page is ready when its working copy is open and has the first list in it: before that a click lands on a page nothing listens to yet.
  await expect(page.getByRole('link', { name: /^My tasks/ })).toBeVisible();
  const name = unique('Tasks');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return { name, url: page.url() };
}

const rows = (page: Page) =>
  page
    .getByRole('list')
    .filter({ has: page.getByRole('checkbox') })
    .first()
    .getByRole('listitem');
const add = async (page: Page, title: string) => {
  await page.getByLabel('Add a task').fill(title);
  await page.getByLabel('Add a task').press('Enter');
};
const titles = async (page: Page) => (await rows(page).allInnerTexts()).map((text) => text.trim());

test('Enter adds a task at the top, and the cursor stays for the next one', async ({ page }) => {
  await openNewList(page);
  const input = page.getByLabel('Add a task');
  // A list opens with the cursor in the field.
  await expect(input).toBeFocused();
  for (const title of ['one', 'two', 'three']) {
    await input.pressSequentially(title);
    await input.press('Enter');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
  }
  await expect.poll(() => titles(page)).toEqual(['three', 'two', 'one']);
});

test('an empty title adds nothing, and what was added is there after a reload, at once', async ({
  page,
}) => {
  await openNewList(page);
  await add(page, '   ');
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  const title = unique('Water the plants');
  await add(page, title);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

test('ticking moves a task to Completed, and un-ticking brings it back, and it does not flicker', async ({
  page,
}) => {
  await openNewList(page);
  const title = unique('Call the bank');
  await add(page, title);
  const box = page.getByRole('checkbox', { name: `Done: ${title}` });
  // A tick moves the row into Completed, which is closed, so the box is gone from the page a moment later: it is clicked, not checked.
  await box.click();
  const completed = page.getByText(/^Completed \(1\)$/);
  await expect(completed).toBeVisible();
  await completed.click();
  const done = page.getByRole('checkbox', { name: `Done: ${title}` });
  await expect(done).toBeChecked();
  // Never, at any moment after it was ticked, shown unticked: sampled, since a flicker is a state that lasts a frame.
  const seen = await page.evaluate(
    (label) =>
      new Promise<boolean[]>((resolve) => {
        const states: boolean[] = [];
        const input = [...document.querySelectorAll('input[type=checkbox]')].find(
          (el) => el.getAttribute('aria-label') === label,
        ) as HTMLInputElement;
        let frames = 0;
        const tick = () => {
          states.push(input.checked);
          if (++frames < 20) requestAnimationFrame(tick);
          else resolve(states);
        };
        tick();
      }),
    `Done: ${title}`,
  );
  expect(seen.every(Boolean)).toBe(true);

  await done.uncheck();
  await expect(page.getByText(/^Completed/)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).not.toBeChecked();
});

test('a task opens in the right column by its address, is edited as you leave each field, and the address can be linked to and reloaded', async ({
  page,
}) => {
  const { url } = await openNewList(page);
  const title = unique('Plan the trip');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  const detail = page.getByRole('region', { name: 'Task', exact: true });
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/\?task=[0-9a-f-]{36}$/);
  const address = page.url();

  const renamed = `${title} (booked)`;
  await detail.getByLabel('Title').fill(renamed);
  await detail.getByLabel('Notes').fill('Flights first.\nThen the hotel.');
  // Leaving the field saves it: there is no button.
  await detail.getByLabel('Title').press('Enter');
  await detail.getByLabel('Notes').blur();
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(address);
  await expect(detail.getByLabel('Title')).toHaveValue(renamed);
  await expect(detail.getByLabel('Notes')).toHaveValue('Flights first.\nThen the hotel.');

  // A task that is not there shows nothing and does not fail.
  await page.goto(`${url}?task=${crypto.randomUUID()}`);
  await expect(detail).toBeVisible();
  await expect(detail.getByText('That task is not here any more.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a title that is emptied goes back to what it was, and nothing is saved', async ({ page }) => {
  await openNewList(page);
  const title = unique('Keep me');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  const field = page.getByRole('region', { name: 'Task', exact: true }).getByLabel('Title');
  await field.fill('   ');
  await field.blur();
  await expect(field).toHaveValue(title);
});

test('deleting offers Undo, which brings the task back', async ({ page }) => {
  await openNewList(page);
  const title = unique('Throw away');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Task', exact: true })).toHaveCount(0);
  const bar = page.getByRole('status').filter({ hasText: 'Task deleted.' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test('with the network off, adding and ticking show at once, and are sent when it comes back', async ({
  page,
  context,
  baseURL,
}) => {
  await openNewList(page);
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const title = unique('On the train');
  await context.setOffline(true);
  await add(page, title);
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('checkbox', { name: `Done: ${title}` }).click();
  await expect(page.getByText(/^Completed \(1\)$/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () => {
        const reply = await page.request.post('/api/sync', {
          headers: { origin },
          data: { protocol: 1, cursor: 0, mutations: [], limit: 2000 },
        });
        const body = await reply.json();
        return body.pull.rows.some(
          (row: {
            table: string;
            fields: { title?: { v: string }; completedAt?: { v: number | null } };
          }) =>
            row.table === 'task' &&
            row.fields.title?.v === title &&
            typeof row.fields.completedAt?.v === 'number',
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});

test.describe('subtasks', () => {
  /** A list with one task, opened in the right column. */
  async function taskOpen(page: Page) {
    await openNewList(page);
    const title = unique('Plan the trip');
    await add(page, title);
    await page.getByRole('link', { name: title }).click();
    const detail = page.getByRole('region', { name: 'Task', exact: true });
    await expect(detail).toBeVisible();
    return { title, detail };
  }
  const addSub = async (detail: ReturnType<Page['getByRole']>, title: string) => {
    await detail.getByLabel('Add a subtask').fill(title);
    await detail.getByLabel('Add a subtask').press('Enter');
  };

  test('are added from the keyboard, in order, with the cursor staying, and the row shows how far through it is', async ({
    page,
  }) => {
    const { title, detail } = await taskOpen(page);
    for (const sub of ['Flights', 'Hotel', 'Insurance']) {
      await addSub(detail, sub);
      await expect(detail.getByLabel('Add a subtask')).toBeFocused();
    }
    const subs = detail.getByRole('region', { name: 'Subtasks' });
    await expect
      .poll(
        async () =>
          await subs
            .getByRole('listitem')
            .getByRole('textbox')
            .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
      )
      .toEqual(['Flights', 'Hotel', 'Insurance']);

    const ring = page.getByRole('listitem').filter({ hasText: title }).getByRole('img');
    await expect(ring).toHaveAccessibleName('0 of 3 subtasks done');
    await subs.getByRole('checkbox', { name: 'Done: Hotel' }).click();
    await expect(ring).toHaveAccessibleName('1 of 3 subtasks done');
    // They are not on the list's rows: a subtask is not a task of the list.
    await expect(page.getByRole('link', { name: 'Hotel' })).toHaveCount(0);
  });

  test('ticking the parent ticks the open ones and leaves the time of the one that was done, and reopening it reopens nothing', async ({
    page,
    baseURL,
  }) => {
    const { title, detail } = await taskOpen(page);
    const origin = new URL(baseURL ?? 'http://localhost').origin;
    for (const sub of ['One', 'Two', 'Three']) await addSub(detail, sub);
    const subs = detail.getByRole('region', { name: 'Subtasks' });
    await subs.getByRole('checkbox', { name: 'Done: Two' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: title }).getByRole('img'),
    ).toHaveAccessibleName('1 of 3 subtasks done');

    const completedAt = async () => {
      const reply = await page.request.post('/api/sync', {
        headers: { origin },
        data: { protocol: 1, cursor: 0, mutations: [], limit: 2000 },
      });
      const rows = (await reply.json()).pull.rows as {
        table: string;
        fields: { title?: { v: string }; completedAt?: { v: number | null } };
      }[];
      return Object.fromEntries(
        rows
          .filter(
            (r) =>
              r.table === 'task' &&
              ['One', 'Two', 'Three', title].includes(r.fields.title?.v ?? ''),
          )
          .map((r) => [r.fields.title?.v, r.fields.completedAt?.v ?? null]),
      );
    };
    await expect.poll(async () => (await completedAt()).Two).not.toBeNull();
    const twoDoneAt = (await completedAt()).Two;

    await detail.getByRole('checkbox', { name: 'Done' }).first().click();
    await expect.poll(async () => (await completedAt())[title]).not.toBeNull();
    await expect.poll(async () => (await completedAt()).One).not.toBeNull();
    const after = await completedAt();
    expect(after.Three).not.toBeNull();
    // Two was done already, and keeps the time it was done at.
    expect(after.Two).toBe(twoDoneAt);

    // Reopening the parent reopens none of them.
    await detail.getByRole('checkbox', { name: 'Done' }).first().click();
    await expect.poll(async () => (await completedAt())[title]).toBeNull();
    const reopened = await completedAt();
    expect(reopened.One).not.toBeNull();
    expect(reopened.Three).not.toBeNull();
  });

  test('ticking the last one does not tick the parent, and a subtask deleted can be undone', async ({
    page,
  }) => {
    const { detail } = await taskOpen(page);
    await addSub(detail, 'Only');
    const subs = detail.getByRole('region', { name: 'Subtasks' });
    await subs.getByRole('checkbox', { name: 'Done: Only' }).click();
    await expect(detail.getByRole('checkbox', { name: 'Done' }).first()).not.toBeChecked();

    await subs.getByRole('button', { name: 'Delete subtask: Only' }).click();
    await expect(subs.getByRole('textbox', { name: 'Subtask: Only' })).toHaveCount(0);
    const bar = page.getByRole('status').filter({ hasText: 'Subtask deleted.' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(subs.getByRole('textbox', { name: 'Subtask: Only' })).toBeVisible();
  });

  test('a title is edited in place and saved as it is left, and an emptied one goes back', async ({
    page,
  }) => {
    const { detail } = await taskOpen(page);
    await addSub(detail, 'Flights');
    const field = detail.getByRole('textbox', { name: 'Subtask: Flights' });
    await field.fill('Flights and trains');
    await field.press('Enter');
    await expect(
      detail.getByRole('textbox', { name: 'Subtask: Flights and trains' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Subtask: Flights and trains' })).toBeVisible();
    const again = page.getByRole('textbox', { name: 'Subtask: Flights and trains' });
    await again.fill('   ');
    await again.blur();
    await expect(again).toHaveValue('Flights and trains');
  });
});

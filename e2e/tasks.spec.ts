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
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
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
  await page.getByLabel('Add a card').fill(title);
  await page.getByLabel('Add a card').press('Enter');
};
// The titles are the links: a row has a star as well, which is text.
const titles = async (page: Page) =>
  (await rows(page).getByRole('link').allInnerTexts()).map((text) => text.trim());

test('Enter adds a task at the top, and the cursor stays for the next one', async ({ page }) => {
  await openNewList(page);
  const input = page.getByLabel('Add a card');
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
  const completed = page.getByRole('button', { name: /Completed \(1\)/ });
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
  await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).not.toBeChecked();
});

test('a task opens in the right column by its address, is edited as you leave each field, and the address can be linked to and reloaded', async ({
  page,
}) => {
  const { url } = await openNewList(page);
  const title = unique('Plan the trip');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  const detail = page.getByRole('region', { name: 'Card', exact: true });
  await expect(detail).toBeVisible();
  await expect(page).toHaveURL(/\?card=[0-9a-f-]{36}$/);
  const address = page.url();

  const renamed = `${title} (booked)`;
  await detail.getByLabel('Title').fill(renamed);
  await detail.getByLabel('Description').fill('Flights first.\nThen the hotel.');
  // Leaving the field saves it: there is no button.
  await detail.getByLabel('Title').press('Enter');
  await detail.getByLabel('Description').blur();
  await expect(page.getByRole('link', { name: renamed })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(address);
  await expect(detail.getByLabel('Title')).toHaveValue(renamed);
  await expect(detail.getByLabel('Description')).toHaveValue('Flights first.\nThen the hotel.');

  // A task that is not there shows nothing and does not fail.
  await page.goto(`${url}?card=${crypto.randomUUID()}`);
  await expect(detail).toBeVisible();
  await expect(detail.getByText('That card is not here any more.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a title that is emptied goes back to what it was, and nothing is saved', async ({ page }) => {
  await openNewList(page);
  const title = unique('Keep me');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  const field = page.getByRole('region', { name: 'Card', exact: true }).getByLabel('Title');
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
  await expect(page.getByRole('region', { name: 'Card', exact: true })).toHaveCount(0);
  const bar = page.getByRole('status').filter({ hasText: 'Card deleted.' });
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
  await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () => {
        const reply = await page.request.post('/api/sync', {
          headers: { origin },
          data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
        });
        const body = await reply.json();
        return body.pull.rows.some(
          (row: {
            table: string;
            fields: { title?: { v: string }; completedAt?: { v: number | null } };
          }) =>
            row.table === 'desk_card' &&
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
    const detail = page.getByRole('region', { name: 'Card', exact: true });
    await expect(detail).toBeVisible();
    return { title, detail };
  }
  const addSub = async (detail: ReturnType<Page['getByRole']>, title: string) => {
    await detail.getByLabel('Add an item').fill(title);
    await detail.getByLabel('Add an item').press('Enter');
  };

  test('are added from the keyboard, in order, with the cursor staying, and the row shows how far through it is', async ({
    page,
  }) => {
    const { title, detail } = await taskOpen(page);
    for (const sub of ['Flights', 'Hotel', 'Insurance']) {
      await addSub(detail, sub);
      await expect(detail.getByLabel('Add an item')).toBeFocused();
    }
    const subs = detail.getByRole('region', { name: 'Checklist' });
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
    await expect(ring).toHaveAccessibleName('0 of 3 items done');
    await subs.getByRole('checkbox', { name: 'Done: Hotel' }).click();
    await expect(ring).toHaveAccessibleName('1 of 3 items done');
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
    const subs = detail.getByRole('region', { name: 'Checklist' });
    await subs.getByRole('checkbox', { name: 'Done: Two' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: title }).getByRole('img'),
    ).toHaveAccessibleName('1 of 3 items done');

    const completedAt = async () => {
      const reply = await page.request.post('/api/sync', {
        headers: { origin },
        data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
      });
      const rows = (await reply.json()).pull.rows as {
        table: string;
        fields: { title?: { v: string }; completedAt?: { v: number | null } };
      }[];
      return Object.fromEntries(
        rows
          .filter(
            (r) =>
              r.table === 'desk_card' &&
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
    const subs = detail.getByRole('region', { name: 'Checklist' });
    await subs.getByRole('checkbox', { name: 'Done: Only' }).click();
    await expect(detail.getByRole('checkbox', { name: 'Done' }).first()).not.toBeChecked();

    await subs.getByRole('button', { name: 'Delete item: Only' }).click();
    await expect(subs.getByRole('textbox', { name: 'Item: Only' })).toHaveCount(0);
    const bar = page.getByRole('status').filter({ hasText: 'Item deleted.' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(subs.getByRole('textbox', { name: 'Item: Only' })).toBeVisible();
  });

  test('a title is edited in place and saved as it is left, and an emptied one goes back', async ({
    page,
  }) => {
    const { detail } = await taskOpen(page);
    await addSub(detail, 'Flights');
    const field = detail.getByRole('textbox', { name: 'Item: Flights' });
    await field.fill('Flights and trains');
    await field.press('Enter');
    await expect(detail.getByRole('textbox', { name: 'Item: Flights and trains' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Item: Flights and trains' })).toBeVisible();
    const again = page.getByRole('textbox', { name: 'Item: Flights and trains' });
    await again.fill('   ');
    await again.blur();
    await expect(again).toHaveValue('Flights and trains');
  });
});

test.describe('putting tasks in order', () => {
  /** What the server holds of this account's tasks, by title. */
  async function positions(page: Page, origin: string, wanted: string[]) {
    const reply = await page.request.post('/api/sync', {
      headers: { origin },
      data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
    });
    const rows = (await reply.json()).pull.rows as {
      table: string;
      position: string;
      fields: { title?: { v: string } };
    }[];
    return Object.fromEntries(
      rows
        .filter((r) => r.table === 'desk_card' && wanted.includes(r.fields.title?.v ?? ''))
        .map((r) => [r.fields.title?.v, r.position]),
    );
  }

  async function threeTasks(page: Page) {
    await openNewList(page);
    const names = [unique('Alpha'), unique('Beta'), unique('Gamma')];
    // Added in this order they are shown last first: Gamma, Beta, Alpha.
    for (const name of names) await add(page, name);
    await expect.poll(() => titles(page)).toEqual([...names].reverse());
    return [...names].reverse();
  }

  async function drag(page: Page, from: string, to: string) {
    const source = await page.getByRole('link', { name: from }).boundingBox();
    const target = await page.getByRole('link', { name: to }).boundingBox();
    if (!source || !target) throw new Error('rows are not on the page');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 - 8, {
      steps: 4,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 12 });
    await page.mouse.up();
  }

  test('a task is dragged into place at once, only that row is written, and the order is the same after a reload', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? 'http://localhost').origin;
    const [first, second, third] = await threeTasks(page);
    await expect
      .poll(
        async () =>
          Object.keys(await positions(page, origin, [first, second, third] as string[])).length,
      )
      .toBe(3);
    const before = await positions(page, origin, [first, second, third] as string[]);

    // The last is dragged to the top.
    await drag(page, third as string, first as string);
    await expect.poll(() => titles(page)).toEqual([third, first, second]);
    // Nothing sprang back, and the page did not navigate to the task that was dragged.
    await expect(page).not.toHaveURL(/\?card=/);
    await expect
      .poll(
        async () =>
          (await positions(page, origin, [first, second, third] as string[]))[third as string],
      )
      .not.toBe(before[third as string]);
    const after = await positions(page, origin, [first, second, third] as string[]);
    expect(after[first as string]).toBe(before[first as string]);
    expect(after[second as string]).toBe(before[second as string]);

    await page.reload();
    await expect.poll(() => titles(page)).toEqual([third, first, second]);
  });

  test('the keyboard does it too: Space picks a task up, the arrows move it, Space puts it down', async ({
    page,
  }) => {
    const [first, second, third] = await threeTasks(page);
    await page.getByRole('link', { name: third as string }).focus();
    // Each key is given a moment, as a person does: the drag measures the rows again after each move, and a second arrow pressed in the same
    // instant is taken against the first measurement.
    for (const key of ['Space', 'ArrowUp', 'ArrowUp', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    await expect.poll(() => titles(page)).toEqual([third, first, second]);
    // Enter was left to the link, which opens the task.
    await page.getByRole('link', { name: first as string }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?card=/);
  });

  test('a card is dragged from anywhere on its row, here the ring of its checklist, and a click on that free space opens it', async ({
    page,
  }) => {
    const [first, second, third] = await threeTasks(page);
    // The last card gets a checklist item, which gives its row a ring that is not the link.
    await page.getByRole('link', { name: third as string }).click();
    const detail = page.getByRole('region', { name: 'Card', exact: true });
    await detail.getByLabel('Add an item').fill('One');
    await detail.getByLabel('Add an item').press('Enter');
    await expect(detail.getByRole('textbox', { name: 'Item: One' })).toBeVisible();
    await detail.getByRole('button', { name: 'Close' }).click();
    await expect(page).not.toHaveURL(/\?card=/);

    const ring = page.getByRole('img', { name: '0 of 1 items done' });
    await expect(ring).toBeVisible();
    // A click on the ring opens the card, as a click on the title does.
    await ring.click();
    await expect(page).toHaveURL(/\?card=/);
    await detail.getByRole('button', { name: 'Close' }).click();

    const from = await ring.boundingBox();
    const to = await page.getByRole('link', { name: first as string }).boundingBox();
    if (!from || !to) throw new Error('the row is not on the page');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => titles(page)).toEqual([third, first, second]);
    await expect(page).not.toHaveURL(/\?card=/);
  });

  test('a subtask is dragged by its handle, and the order holds after a reload', async ({
    page,
  }) => {
    await openNewList(page);
    const title = unique('With parts');
    await add(page, title);
    await page.getByRole('link', { name: title }).click();
    const detail = page.getByRole('region', { name: 'Card', exact: true });
    for (const sub of ['One', 'Two', 'Three']) {
      await detail.getByLabel('Add an item').fill(sub);
      await detail.getByLabel('Add an item').press('Enter');
    }
    const order = async () =>
      detail
        .getByRole('region', { name: 'Checklist' })
        .getByRole('list')
        .getByRole('textbox')
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    await expect.poll(order).toEqual(['One', 'Two', 'Three']);

    const handle = detail.getByRole('button', { name: 'Move item: Three' });
    const target = detail.getByRole('textbox', { name: 'Item: One' });
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error('rows are not on the page');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y - 8, { steps: 4 });
    await page.mouse.move(to.x + 10, to.y + 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(['Three', 'One', 'Two']);
    await page.reload();
    await expect.poll(order).toEqual(['Three', 'One', 'Two']);
  });
});

test('deleting a task with subtasks takes them with it, and Undo brings back those and not one that was deleted before', async ({
  page,
}) => {
  await openNewList(page);
  const title = unique('Parent');
  await add(page, title);
  await page.getByRole('link', { name: title }).click();
  const detail = page.getByRole('region', { name: 'Card', exact: true });
  for (const sub of ['Kept', 'Earlier', 'Later']) {
    await detail.getByLabel('Add an item').fill(sub);
    await detail.getByLabel('Add an item').press('Enter');
  }
  const subs = detail.getByRole('region', { name: 'Checklist' });
  // One is deleted on its own first.
  await subs.getByRole('button', { name: 'Delete item: Earlier' }).click();
  await expect(subs.getByRole('textbox', { name: 'Item: Earlier' })).toHaveCount(0);

  await detail.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  const bar = page.getByRole('status').filter({ hasText: 'Card deleted.' });
  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  await page.getByRole('link', { name: title }).click();
  const again = page
    .getByRole('region', { name: 'Card', exact: true })
    .getByRole('region', { name: 'Checklist' });
  await expect(again.getByRole('textbox', { name: 'Item: Kept' })).toBeVisible();
  await expect(again.getByRole('textbox', { name: 'Item: Later' })).toBeVisible();
  // The one that was deleted before is still deleted.
  await expect(again.getByRole('textbox', { name: 'Item: Earlier' })).toHaveCount(0);
});

test.describe('seeing a list the way one wants', () => {
  const origin = (baseURL?: string) => new URL(baseURL ?? 'http://localhost').origin;

  /** The list's fields as the server holds them, by its title. */
  async function listFields(page: Page, baseURL: string | undefined, name: string) {
    const reply = await page.request.post('/api/sync', {
      headers: { origin: origin(baseURL) },
      data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
    });
    const rows = (await reply.json()).pull.rows as {
      table: string;
      fields: Record<string, { v: unknown }>;
    }[];
    return rows.find((r) => r.table === 'desk_list' && r.fields.title?.v === name)?.fields;
  }

  test('a list takes any colour: a suggestion is written at once, a colour of one’s own too, and both are the same after a reload and on the server', async ({
    page,
    baseURL,
  }) => {
    const { name } = await openNewList(page);
    const swatch = (hex: string) =>
      page
        .getByRole('navigation', { name: 'Lists' })
        .getByRole('link', { name: new RegExp(`^${name}`) })
        .locator('span[aria-hidden]')
        .first()
        .evaluate((el, expected) => {
          const probe = document.createElement('i');
          probe.style.background = expected;
          document.body.append(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return getComputedStyle(el).backgroundColor === want;
        }, hex);

    await page.getByRole('button', { name: `Colour of ${name}` }).click();
    await page.getByRole('radio', { name: 'Blue' }).click();
    await expect.poll(() => swatch('#2563eb')).toBe(true);
    await expect
      .poll(async () => (await listFields(page, baseURL, name))?.color?.v)
      .toBe('#2563eb');

    // Any colour at all, not only a suggestion: the native picker is given one, and it is written once it settles.
    await page.getByRole('button', { name: `Colour of ${name}` }).click();
    await page.getByLabel('Pick any colour').evaluate((input: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(input, '#13579b');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect
      .poll(async () => (await listFields(page, baseURL, name))?.color?.v)
      .toBe('#13579b');

    await page.reload();
    await expect.poll(() => swatch('#13579b')).toBe(true);
  });

  test('a sort other than Custom orders the tasks, takes away the handle so a drag does nothing, and is the same after a reload and on the server', async ({
    page,
    baseURL,
  }) => {
    const { name } = await openNewList(page);
    const [b, a, c] = [unique('B task'), unique('A task'), unique('C task')];
    for (const title of [b, a, c]) await add(page, title);
    await expect.poll(() => titles(page)).toEqual([c, a, b]);

    await page.getByLabel('Sort by').selectOption('title');
    await expect.poll(() => titles(page)).toEqual([a, b, c]);

    // A drag under a sort does nothing: the third row is dragged to the top, and nothing moves.
    const source = await page.getByRole('link', { name: c }).boundingBox();
    const target = await page.getByRole('link', { name: a }).boundingBox();
    if (!source || !target) throw new Error('rows are not on the page');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2, source.y - 8, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await titles(page)).toEqual([a, b, c]);

    await expect.poll(async () => (await listFields(page, baseURL, name))?.sort?.v).toBe('title');
    await page.reload();
    await expect(page.getByLabel('Sort by')).toHaveValue('title');
    await expect.poll(() => titles(page)).toEqual([a, b, c]);

    // Back to Custom, and the order the person made is there, and can be dragged again.
    await page.getByLabel('Sort by').selectOption('custom');
    await expect.poll(() => titles(page)).toEqual([c, a, b]);
  });

  test('the Completed section is open or closed as it was left, per list, and Active hides it', async ({
    page,
    baseURL,
  }) => {
    const { name } = await openNewList(page);
    const title = unique('Done thing');
    await add(page, title);
    await page.getByRole('checkbox', { name: `Done: ${title}` }).click();
    const heading = page.getByRole('button', { name: /Completed \(1\)/ });
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).toBeChecked();
    await expect
      .poll(async () => (await listFields(page, baseURL, name))?.showCompleted?.v)
      .toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByRole('checkbox', { name: `Done: ${title}` })).toBeVisible();

    // Another list has its own.
    const other = unique('Another list');
    await page.getByRole('button', { name: 'Add a list' }).click();
    await page.getByLabel('New list name').fill(other);
    await page.getByLabel('New list name').press('Enter');
    await page
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${other}`) })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: other })).toBeVisible();
    await add(page, unique('Another'));
    await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);

    // Active shows only what is still to do.
    await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await page.getByRole('radio', { name: 'Active' }).click();
    await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);
    await page.getByRole('radio', { name: 'All' }).click();
    await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();
  });

  test('Delete completed removes the done tasks, and Undo brings them back', async ({ page }) => {
    await openNewList(page);
    const [one, two, keep] = [unique('One'), unique('Two'), unique('Keep')];
    for (const title of [keep, two, one]) await add(page, title);
    for (const title of [one, two])
      await page.getByRole('checkbox', { name: `Done: ${title}` }).click();
    await page.getByRole('button', { name: /Completed \(2\)/ }).click();
    await page.getByRole('button', { name: 'Delete completed' }).click();
    await expect(page.getByRole('button', { name: /Completed/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: keep })).toBeVisible();

    const bar = page.getByRole('status').filter({ hasText: '2 completed cards deleted.' });
    await bar.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /Completed \(2\)/ })).toBeVisible();
  });
});

test.describe('moving a task and starring it', () => {
  const origin = (baseURL?: string) => new URL(baseURL ?? 'http://localhost').origin;

  /** How many checklist items the server holds for a card: they stay with it when it moves, and have no list of their own. */
  async function itemsOnServer(page: Page, baseURL: string | undefined, cardId: string) {
    const reply = await page.request.post('/api/sync', {
      headers: { origin: origin(baseURL) },
      data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
    });
    const rows = (await reply.json()).pull.rows as { table: string; cardId?: string }[];
    return rows.filter((r) => r.table === 'desk_check' && r.cardId === cardId).length;
  }

  async function tasksOnServer(page: Page, baseURL: string | undefined, wanted: string[]) {
    const reply = await page.request.post('/api/sync', {
      headers: { origin: origin(baseURL) },
      data: { protocol: 2, cursor: 0, mutations: [], limit: 2000 },
    });
    const rows = (await reply.json()).pull.rows as {
      table: string;
      id: string;
      listId?: string;
      fields: { title?: { v: string }; starred?: { v: boolean } };
    }[];
    return rows.filter((r) => r.table === 'desk_card' && wanted.includes(r.fields.title?.v ?? ''));
  }

  test('a card moves to another list with its checklist, at the top of it', async ({
    page,
    baseURL,
  }) => {
    const { name: from } = await openNewList(page);
    const to = unique('Destination');
    await page.getByRole('button', { name: 'Add a list' }).click();
    await page.getByLabel('New list name').fill(to);
    await page.getByLabel('New list name').press('Enter');
    await page
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${from}`) })
      .click();
    const title = unique('Mover');
    const sub = unique('Part');
    await add(page, title);
    await page.getByRole('link', { name: title }).click();
    const detail = page.getByRole('region', { name: 'Card', exact: true });
    await detail.getByLabel('Add an item').fill(sub);
    await detail.getByLabel('Add an item').press('Enter');
    await expect(detail.getByRole('textbox', { name: `Item: ${sub}` })).toBeVisible();

    await detail.getByLabel('List', { exact: true }).selectOption({ label: to });
    // It leaves this list, and is at the top of the other, subtask and all.
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);
    await expect
      .poll(async () => {
        const rows = await tasksOnServer(page, baseURL, [title]);
        const parent = rows.find((r) => r.fields.title?.v === title);
        return (
          parent?.listId !== undefined && (await itemsOnServer(page, baseURL, parent.id)) === 1
        );
      })
      .toBe(true);
    await page
      .getByRole('navigation', { name: 'Lists' })
      .getByRole('link', { name: new RegExp(`^${to}`) })
      .click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await page.getByRole('link', { name: title }).click();
    await expect(
      page
        .getByRole('region', { name: 'Card', exact: true })
        .getByRole('textbox', { name: `Item: ${sub}` }),
    ).toBeVisible();
  });

  test('a star is its own click target, survives a reload, and a subtask has none', async ({
    page,
    baseURL,
  }) => {
    await openNewList(page);
    const title = unique('Starry');
    await add(page, title);
    const row = page.getByRole('listitem').filter({ hasText: title });
    const star = row.getByRole('button', { name: 'Star' });
    await star.click();
    await expect(row.getByRole('button', { name: 'Remove the star' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // It did not open the task.
    await expect(page).not.toHaveURL(/\\?card=/);
    await expect
      .poll(async () => (await tasksOnServer(page, baseURL, [title]))[0]?.fields.starred?.v)
      .toBe(true);

    await page.reload();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: title })
        .getByRole('button', { name: 'Remove the star' }),
    ).toBeVisible();

    // In the detail too, and a subtask has no star there.
    await page.getByRole('link', { name: title }).click();
    const detail = page.getByRole('region', { name: 'Card', exact: true });
    await expect(detail.getByRole('button', { name: 'Remove the star' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await detail.getByLabel('Add an item').fill('A part');
    await detail.getByLabel('Add an item').press('Enter');
    const subtasks = detail.getByRole('region', { name: 'Checklist' });
    await expect(subtasks.getByRole('textbox', { name: 'Item: A part' })).toBeVisible();
    await expect(subtasks.getByRole('button', { name: /star/i })).toHaveCount(0);
  });
});

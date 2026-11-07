import { expect, test, type Page } from '@playwright/test';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * The keyboard (task 7.6, DESIGN.md §17.8): on the Desk, capture and complete with no mouse; on a board, a card moved to another list with no mouse; and a
 * letter typed into a field is a letter. The keys: n, /, j, k, e, Enter, Esc, ?.
 */
test.use({ viewport: { width: 1280, height: 800 } });

const unique = (stem: string) => `${stem} ${crypto.randomUUID().slice(0, 8)}`;
/** A frame between keys, as a person's fingers leave: a drag measures where things are after each move. */
const press = async (page: Page, keys: string[], wait = 250) => {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
  }
};

async function signedIn(page: Page) {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  // Home is where signing in lands; these tests are about the Desk.
  await page.goto('/desk');
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible();
}

test('on the Desk: n, type, Enter captures; j and k move among cards; e completes; Enter opens, Esc closes; / searches; ? helps', async ({
  page,
}) => {
  await signedIn(page);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  const name = unique('Keys');
  await page.getByRole('button', { name: 'Add a list' }).click();
  await page.getByLabel('New list name').fill(name);
  await page.getByLabel('New list name').press('Enter');
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: new RegExp(`^${name}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  const field = page.getByLabel('Add a card');
  const cards = page.locator('[data-shortcut-card]');
  const open = page.getByRole('region', { name: 'Card' });

  // Out of the field the list opens in (Escape leaves it), and n goes back to it.
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).not.toBeFocused();
  await page.keyboard.press('n');
  await expect(field).toBeFocused();
  // An n typed in the field is an n: nothing else happens, and the card is called what was typed.
  await page.keyboard.type('nine nonsense');
  await expect(field).toHaveValue('nine nonsense');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Buy milk');
  await page.keyboard.press('Enter');
  await expect(cards).toHaveText(['Buy milk', 'nine nonsense']);

  // j and k move the focus among the cards; the arrows do too, once a card has it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('j');
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press('k');
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cards.nth(0)).toBeFocused();

  // e completes the card in focus, and the focus goes on to the card that took its place.
  await page.keyboard.press('e');
  await expect(cards).toHaveText(['nine nonsense']);
  await expect(cards.nth(0)).toBeFocused();
  await expect(page.getByRole('button', { name: /Completed \(1\)/ })).toBeVisible();

  // Enter opens the card in focus, and Escape closes it.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?card=/);
  await expect(open.getByLabel('Title')).toHaveValue('nine nonsense');
  // An e and an n typed in the card's title are letters.
  await open.getByLabel('Title').focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' en');
  await expect(open.getByLabel('Title')).toHaveValue('nine nonsense en');
  await open.getByLabel('Title').press('Enter');
  // The title is saved before the keys that follow close the card.
  await expect(page.getByRole('link', { name: 'nine nonsense en' })).toBeVisible();
  // In a field the first Escape leaves it and the card stays; the next closes the card.
  await open.getByLabel('Title').focus();
  await page.keyboard.press('Escape');
  await expect(open.getByLabel('Title')).not.toBeFocused();
  await expect(page).toHaveURL(/\?card=/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/\?card=/);
  await expect(page.getByRole('link', { name: 'nine nonsense en' })).toBeVisible();

  // ? lists the keys, and Escape closes the list.
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('New card');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  // / goes to the search, where typing searches and Escape leaves.
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search the Desk' });
  await expect(search).toBeFocused();
  await page.keyboard.type('nonsense');
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeFocused();
});

test('on a board: n adds a card to the first list, j picks it, and Space and the arrows move it to the next list', async ({
  page,
}) => {
  await signedIn(page);
  await page.evaluate(() =>
    window.localStorage.setItem('tusk.sidebar', '{"page":{"state":"full","shown":"full"}}'),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create a workspace' })).toBeVisible();
  const workspace = unique('Keys');
  await page.getByRole('button', { name: 'Create a workspace' }).click();
  await page.getByRole('dialog', { name: 'Create a workspace' }).getByLabel('Name').fill(workspace);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toBeVisible();
  await page.getByRole('button', { name: 'Create board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create board' });
  await dialog.getByLabel('Name').fill(unique('Board'));
  await dialog.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}$/);
  await page.locator('button', { hasText: 'Add a list' }).click();
  await page.getByLabel('Name of the new list').fill('Doing');
  await page.getByRole('button', { name: 'Add list' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Doing' })).toBeVisible();

  const backlog = page.getByRole('region', { name: 'Backlog' });
  const doing = page.getByRole('region', { name: 'Doing' });
  const tiles = page.locator('[data-shortcut-card]');

  // n opens the add field of the first list; an n typed in it is an n.
  await page.keyboard.press('n');
  const add = page.getByLabel('Title of a new card in Backlog');
  await expect(add).toBeFocused();
  await page.keyboard.type('banana');
  await page.keyboard.press('Enter');
  await expect(backlog.locator('[data-shortcut-card]')).toHaveText(['banana']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // j takes the card, Space lifts it, the right arrow carries it to the next list, and Space puts it down.
  await page.keyboard.press('j');
  await expect(tiles.first()).toBeFocused();
  await press(page, ['Space', 'ArrowRight', 'Space']);
  await expect(doing.locator('[data-shortcut-card]')).toHaveText(['banana']);
  await expect(backlog.locator('[data-shortcut-card]')).toHaveCount(0);

  // It is kept.
  await page.reload();
  await expect(doing.locator('[data-shortcut-card]')).toHaveText(['banana']);

  // The workspace is deleted, so that the sidebar is as it was for the next test.
  await page.getByRole('link', { name: workspace, exact: true }).first().click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Workspace settings' }).click();
  await page.getByRole('button', { name: 'Delete workspace' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete workspace' });
  await confirm.getByLabel('Type the name to confirm').fill(workspace);
  await confirm.getByRole('button', { name: 'Delete this workspace' }).click();
  await expect(page.getByRole('heading', { level: 1, name: workspace })).toHaveCount(0);
});

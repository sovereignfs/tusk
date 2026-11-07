import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PROTOCOL_VERSION } from '../src/sync/format';
import { EMAIL, PASSWORD, ensureAccount, signOut, trySignIn } from './helpers';

/**
 * A key of one's own (task 14.2, DESIGN.md §9.1), on the second instance (`playwright.config.ts`) because it is one way and the first instance's account is
 * shared. **The account has one key for the whole run,** so it is made once, in the first browser, and the file it saves is what the second browser opens
 * it with: a person is offered it on the Desk and creates one, which they must save and say they saved; then, on a device that does not have it, the Desk is
 * locked and shows nothing of itself while boards and the Inbox are as they were, a key that is not theirs is told apart from one that is not a key, and
 * their own file opens it. WebKit, which cannot store the key as a key, keeps it sealed (the epic's finding), and this shows that works.
 */
test.use({ baseURL: 'http://localhost:3997', viewport: { width: 1280, height: 800 } });

// A throwaway key made by `age-keygen` for these tests: valid, and not the one this Desk is set up with.
const OTHER_KEY = 'AGE-SECRET-KEY-12V57LEMWYJJ90MPPM2SR3FNVRPX4MJ5ZU404FQ5LJSPNGSSN5G7Q4C83JF';
const keyFile = () => join(process.env.TUSK_E2E_DIR ?? '', 'tusk-key.txt');
const secret = 'Secret plan for the key tests';

test('a key is made here, saved and said to be saved, and turns on a Desk that works as it did', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'one account has one key: it is made once, in the first browser',
  );
  await ensureAccount(page, { skipKeyOffer: false });
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');

  // Offered once, on the Desk, with what it does and does not cover; the person says Skip, and goes on with a Desk in the clear, as most people will.
  const offer = page.getByRole('region', { name: 'A key for your Desk' });
  await expect(offer).toContainText('Boards are shared, and the server can read them');
  await offer.getByRole('button', { name: 'Skip' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  await page.getByLabel('Add a card').fill(secret);
  await page.getByLabel('Add a card').press('Enter');
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();
  const serverView = async () => {
    const reply = await page.request.post('/api/sync', {
      headers: { origin: 'http://localhost:3997' },
      data: { protocol: PROTOCOL_VERSION, cursor: 0, mutations: [] },
    });
    const text = await reply.text();
    const rows = (JSON.parse(text) as { pull: { rows: unknown[] } }).pull.rows.length;
    return text.includes('Secret plan') ? 'in the clear' : rows >= 2 ? 'sealed' : 'not yet';
  };
  await expect.poll(serverView).toBe('in the clear');

  // Later, from Settings, the Desk with things in it is moved to a key of its own, which has to be saved first.
  await page.goto('/account?section=data');
  await page.getByRole('button', { name: 'Turn on a key of my own' }).click();
  await offer.getByRole('button', { name: 'Create a key' }).click();
  await expect(offer).toContainText('Nobody can recover this key');
  const shown = (await offer.getByLabel('Your key').innerText()).trim();
  expect(shown).toMatch(/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/);

  // It cannot be turned on before the key is saved and the person says so.
  const turnOn = offer.getByRole('button', { name: 'Turn it on' });
  const confirm = offer.getByLabel('I have saved my key somewhere safe');
  await expect(turnOn).toBeDisabled();
  await expect(confirm).toBeDisabled();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    offer.getByRole('button', { name: 'Download the key file' }).click(),
  ]);
  await download.saveAs(keyFile());
  const saved = await readFile(keyFile(), 'utf8');
  expect(saved).toContain(shown);
  expect(saved).toMatch(/^# created: .+\n# public key: age1[a-z0-9]{58}\nAGE-SECRET-KEY-1/);
  await expect(turnOn).toBeDisabled();
  await confirm.check();
  await turnOn.click();
  await expect(offer).toHaveCount(0);

  // The Desk goes on working while it is sealed, and when it is done the server holds nothing of it in the clear, the card and the first list included.
  await expect(page.getByText('this device has it')).toBeVisible();
  await expect.poll(serverView, { timeout: 30_000 }).toBe('sealed');
  await expect
    .poll(async () => (await (await page.request.get('/api/encryption')).json()).mode)
    .toBe('personal');
  const everything = await (
    await page.request.post('/api/sync', {
      headers: { origin: 'http://localhost:3997' },
      data: { protocol: PROTOCOL_VERSION, cursor: 0, mutations: [] },
    })
  ).text();
  expect(everything).not.toContain('Secret plan');
  expect(everything).not.toContain('Backlog');
  await page.goto('/desk');
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();

  // Settings says so.
  await page.goto('/account?section=data');
  await expect(page.getByText('this device has it')).toBeVisible();
  await page.goto('/');
  await signOut(page);
  // A copy for the second browser, which must not be a file the first has open.
  await copyFile(keyFile(), `${keyFile()}.copy`);
});

test('on a device that does not have the key the Desk shows nothing of itself, and the saved file opens it', async ({
  page,
  browserName,
}) => {
  test.skip(!existsSync(keyFile()), 'the key is made by the first test, in the first browser');
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');
  const locked = page.getByRole('region', { name: 'Unlock your Desk' });
  await expect(locked).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Backlog/ })).toHaveCount(0);
  await expect(page.getByLabel('Add a card')).toHaveCount(0);

  // Boards and the Inbox are not the Desk's, and are as they were.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workspaces' }).first()).toBeVisible();
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox' }).first()).toBeVisible();
  await page.goto('/desk');
  await expect(locked).toBeVisible();

  // Not a key, and a key that is not this Desk's, are told apart; neither opens it.
  await locked.getByLabel('Or paste the key').fill('hello');
  await locked.getByRole('button', { name: 'Unlock' }).click();
  await expect(locked.getByRole('alert')).toContainText('does not look like an age key');
  await locked.getByLabel('Or paste the key').fill(OTHER_KEY);
  await locked.getByRole('button', { name: 'Unlock' }).click();
  await expect(locked.getByRole('alert')).toContainText('not the one this Desk was set up with');
  await expect(locked).toBeVisible();

  // The saved file opens it, and it is kept until sign-out, in whichever form this browser keeps it.
  await locked.getByLabel('Key file').setInputFiles(keyFile());
  await expect(locked).toHaveCount(0);
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();
  const kept = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tusk-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records: { kind: string }[] = await new Promise((resolve, reject) => {
      const request = db.transaction('identity').objectStore('identity').getAll();
      request.onsuccess = () => resolve(request.result as { kind: string }[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return records.map((record) => record.kind);
  });
  // Chromium stores the key itself; WebKit cannot, and seals it.
  expect(kept).toEqual([browserName === 'chromium' ? 'key' : 'sealed']);

  // Forgetting the key on this device locks the Desk again, and so does signing out.
  await page.goto('/account?section=data');
  await page.getByRole('button', { name: 'Forget the key on this device' }).click();
  // Waits for it to be forgotten, which is when Settings says so: a page left in the middle of the delete would leave the key where it was.
  await expect(page.getByText('this device does not have it')).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('region', { name: 'Unlock your Desk' })).toBeVisible();
  await locked.getByLabel('Key file').setInputFiles(keyFile());
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();
  await page.goto('/');
  await signOut(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('region', { name: 'Unlock your Desk' })).toBeVisible();
});

test('the account is deleted from Settings with the password, says what goes first, and then is not there to sign in to', async ({
  page,
  browserName,
}) => {
  // Last, and once: the account is the one this instance has, and the key tests above are done with it.
  test.skip(
    browserName !== 'webkit',
    'the account is deleted once, at the end, in the last browser',
  );
  // (This instance's accounts are its own now, so when this runs alone there is none yet, and it makes the one it deletes.)
  await ensureAccount(page, { skipKeyOffer: false });
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/account?section=data');
  await page.getByRole('button', { name: 'Delete my account…' }).click();
  const form = page.getByRole('form', { name: 'Delete account' });
  await expect(form).toContainText('This deletes your account, your Desk');
  await expect(form).toContainText('Deleted account');
  // The wrong password deletes nothing.
  await form.getByLabel('Your password').fill('not the password at all');
  await form.getByRole('button', { name: 'Delete my account for good' }).click();
  await expect(form.getByRole('alert')).toContainText('not your password');
  await form.getByLabel('Your password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Delete my account for good' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  // The account is gone: its address and password sign in to nothing.
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByText(/do not match/)).toBeVisible();
});

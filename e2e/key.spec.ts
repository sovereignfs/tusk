import { existsSync } from 'node:fs';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
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

  // Offered once, on the Desk, with what it does and does not cover.
  const offer = page.getByRole('region', { name: 'A key for your Desk' });
  await expect(offer).toContainText('Boards are shared, and the server can read them');
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

  // The Desk works as it always did, and a card is kept.
  await expect(page.getByRole('link', { name: /^Backlog/ })).toBeVisible();
  await page.getByLabel('Add a card').fill(secret);
  await page.getByLabel('Add a card').press('Enter');
  await expect(page.getByRole('link', { name: secret, exact: true })).toBeVisible();

  // Settings says so.
  await page.goto('/account?section=data');
  await expect(page.getByText('this device has it')).toBeVisible();
  await page.goto('/boards');
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
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: 'Boards' }).first()).toBeVisible();
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
  await page.goto('/boards');
  await signOut(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/desk');
  await expect(page.getByRole('region', { name: 'Unlock your Desk' })).toBeVisible();
});

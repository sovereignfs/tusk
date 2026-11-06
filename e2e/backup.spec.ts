import { expect, test } from '@playwright/test';
import { FakeGitHub } from '../src/providers/testing/fake-github';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * Connecting a repository (task 10.3, DESIGN.md §21.2), in the page: it says plainly what will be sent and where, refuses a public repository in words that
 * say what to do, keeps the token out of the page once it is sent, and disconnecting puts the form back. GitHub here is `FakeGitHub` on a real git repository,
 * on the port the instance was told (`playwright.config.ts`).
 */
test.use({ viewport: { width: 1280, height: 800 } });

const TOKEN = 'github_pat_E2E_PLANTED_0123456789';
let fake: FakeGitHub;

test.beforeAll(async () => {
  fake = await FakeGitHub.start(3998);
  fake.addToken(TOKEN, { write: true });
});
test.afterAll(async () => fake.stop());

test.setTimeout(150_000);

test('a repository is connected with a token, a public one is refused in words, and disconnecting puts the form back', async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const mine = { owner: 'ada', name: `backups-${suffix}` };
  const open = { owner: 'ada', name: `open-${suffix}` };
  await fake.createRepository(mine);
  await fake.createRepository(open, { private: false });

  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
  await page.goto('/account?section=data');
  await expect(page.getByRole('heading', { name: 'Backup to git' })).toBeVisible();
  await expect(page.getByText(/only a private repository can be connected/i)).toBeVisible();

  const repository = page.getByLabel('Repository');
  const token = page.getByLabel('Token');
  await repository.fill(`${open.owner}/${open.name}`);
  await token.fill(TOKEN);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('region', { name: 'Data' }).getByRole('alert')).toContainText(
    'That repository is public',
  );
  // Nothing was connected, and what GitHub said is not shown.
  await expect(page.getByText(/^Connected to/)).toHaveCount(0);

  await repository.fill(`https://github.com/${mine.owner}/${mine.name}`);
  await page.getByRole('button', { name: 'Connect' }).click();
  // The address was on GitHub itself, and this instance's GitHub is the fake: another host, said so.
  await expect(page.getByRole('region', { name: 'Data' }).getByRole('alert')).toContainText(
    'Only repositories on GitHub',
  );

  await repository.fill(`${mine.owner}/${mine.name}`);
  await page.getByRole('button', { name: 'Connect' }).click();
  const connected = page.getByRole('status').filter({ hasText: 'Connected to' });
  await expect(connected).toContainText(`${mine.owner}/${mine.name}`);
  await expect(connected).toContainText('main');
  // The token is not in the page, or in the form that is gone.
  await expect(page.getByLabel('Token')).toHaveCount(0);
  expect(await page.content()).not.toContain('E2E_PLANTED');

  // Back up now puts a file in the repository, under tusk/, and the page links to it.
  await expect(page.getByText('No backup has been made yet.')).toBeVisible();
  const data = page.getByRole('region', { name: 'Data' });
  await page.getByRole('button', { name: 'Back up now' }).click();
  const last = page.getByText(/^Last backup:/);
  // Both browsers use one account, and a backup is at most once a minute for it: the second to get here waits out the first's.
  const limited = data.getByRole('alert').filter({ hasText: 'Wait a minute' });
  await expect(last.or(limited)).toBeVisible();
  if (await limited.isVisible()) {
    await page.waitForTimeout(61_000);
    await page.getByRole('button', { name: 'Back up now' }).click();
  }
  await expect(last).toBeVisible();
  const link = last.getByRole('link');
  await expect(link).toHaveText(/^tusk\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
  const written = Object.keys(await fake.files(mine)).filter((path) => path.startsWith('tusk/'));
  expect(written).toEqual([await link.innerText()]);
  expect(JSON.parse((await fake.files(mine))[written[0] ?? ''] ?? '')).toMatchObject({
    format: 'tusk',
    scope: 'everything',
  });
  // And no more than once a minute.
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(data.getByRole('alert')).toContainText('Wait a minute');

  // It is the server that remembers.
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Connected to' })).toContainText(
    mine.name,
  );
  expect(await page.content()).not.toContain('E2E_PLANTED');

  // Automatic backups: chosen, how often, kept after a reload, and put back to manual.
  const how = page
    .getByRole('group', { name: 'How backups are made' })
    .or(page.getByLabel('How backups are made'));
  await expect(how).toBeVisible();
  await page.getByText('Automatically', { exact: true }).click();
  await expect(page.getByText(/Next check:/)).toBeVisible();
  await page.getByLabel('How often').selectOption('weekly');
  await page.reload();
  await expect(page.getByLabel('How often')).toHaveValue('weekly');
  await expect(page.getByText(/Next check:/)).toBeVisible();
  await page.getByText('Only when I ask', { exact: true }).click();
  await expect(page.getByText(/Next check:/)).toHaveCount(0);
  await expect(page.getByLabel('How often')).toHaveCount(0);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByLabel('Token')).toBeVisible();
  await expect(page.getByText(/^Connected to/)).toHaveCount(0);
  // Disconnecting left the repository as it was.
  expect(Object.keys(await fake.files(mine)).filter((path) => path.startsWith('tusk/'))).toEqual(
    written,
  );
});

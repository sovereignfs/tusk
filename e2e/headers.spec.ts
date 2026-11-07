import { expect, test } from '@playwright/test';
import { ROUTES } from '../src/access/routes';
import { EMAIL, PASSWORD, ensureAccount, trySignIn } from './helpers';

/**
 * What is a person's is never kept by a cache (task 11.3, DESIGN.md §24): **every page and every route for a signed-in account that has no parameter is answered
 * `no-store`**, a shared cache between the server and the browser included. The addresses come from the table of who may call what (`src/access/routes.ts`), so
 * a new one is held to it without being added here.
 */
test('every signed-in page and route is answered with no-store', async ({ page }) => {
  await ensureAccount(page);
  await trySignIn(page, EMAIL, PASSWORD);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();

  const addresses: string[] = [];
  for (const rule of ROUTES) {
    if (rule.route.includes('[')) continue;
    if (rule.page?.kind === 'account') addresses.push(rule.route);
    if (rule.methods?.GET?.kind === 'account') addresses.push(rule.route);
  }
  expect(addresses.length).toBeGreaterThan(15);

  const lacking: string[] = [];
  for (const address of addresses) {
    const reply = await page.request.get(address, { maxRedirects: 0 });
    const control = reply.headers()['cache-control'] ?? '';
    // What carries something of a person is a success; a redirect (to GitHub, from the App's install), a refusal and a 404 carry nothing (and say so with no body).
    if (reply.ok() && !/no-store/.test(control))
      lacking.push(`${address} ${reply.status()} ${control || '(no cache-control)'}`);
  }
  expect(lacking).toEqual([]);
});

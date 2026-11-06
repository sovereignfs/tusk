import { sql } from 'drizzle-orm';
import { createAuth } from '../src/auth/auth';
import type { AuthSettings } from '../src/auth/config';
import { loadConfig } from '../src/config';
import { processEnv } from '../src/config/env';
import { type Database } from '../src/db/client';
import { type DatabaseConfig } from '../src/db/config';
import { getStores } from '../src/db/boot';
import { dbAll, dbGet, dbRun } from '../src/db/exec';
import * as postgresSchema from '../src/db/schema/postgres';
import * as sqliteSchema from '../src/db/schema/sqlite';
import { many } from '../src/position';
import { applyMutation } from '../src/sync/apply';
import type { Change, Mutation, SyncTable } from '../src/sync/format';
import { tableOf } from '../src/sync/tables';
import { TUSK_NAMESPACE, uuid5 } from '../src/uuid5';
import { firstListId } from '../src/actions/lists';
import { removeWorkspaceSeed, seedWorkspace } from './seed-workspace';

/**
 * A realistic account for development (task 11.1). It goes **through the store**: the same `applyMutation` the sync endpoint uses, so that what it
 * makes is what the app would have made, with the checks the app makes, and nothing is written to a table directly except to take it away again.
 *
 * - **Idempotent.** Every id is derived from the account and a name, and every mutation has a fixed id, so running it again finds all of it done and
 *   changes nothing.
 * - **Local only.** It refuses a database that is not on this machine: it makes an account with a password that is written in this file.
 * - **Removes only its own.** `--reset` deletes the rows whose ids it would make, and the account it made, and makes them again.
 * - It grows with the features: a feature that has a shape worth looking at adds it here, in the task that builds it.
 *   Checklists are here (none done, some, and all while the card is open); overdue, due today, upcoming, repeating and starred are not yet.
 */
export const SEED_EMAIL = 'seed@example.test';
/** A password for a development database on this machine, and for nothing else. */
export const SEED_PASSWORD = 'tusk-development-only';
export const SEED_NAME = 'Seed';
/** The second account (task 11.6): a member of the seeded workspace, with the same development-only password. */
export const SEED2_EMAIL = 'seed2@example.test';
export const SEED2_NAME = 'Seed Two';

/** Whether a database is on this machine: a file always is, and a service is when its host is. */
export function isLocalDatabase(config: DatabaseConfig): boolean {
  const local = (host: string) =>
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || host.endsWith('.localhost');
  if (config.dialect === 'postgres') return local(new URL(config.url).hostname);
  if (config.form === 'file') return true;
  return local(new URL(config.url).hostname) && local(new URL(config.adminUrl).hostname);
}

const schema = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

interface Plan {
  mutations: Mutation[];
  /** Every row id the seed makes, so that a reset knows what is its own. */
  ids: { desk_list: string[]; desk_card: string[]; desk_check: string[]; desk_series: string[] };
}

const LONG_TITLE =
  `${'A title that goes on and on, as a person who pastes a paragraph into the field would make one. '.repeat(8)}`.slice(
    0,
    500,
  );
const LONG_DESCRIPTION = Array.from(
  { length: 40 },
  (_, i) => `Line ${i + 1} of a long description that a person kept about this one.`,
).join('\n');

/** What the seed makes, for an account. Pure, so that a test can look at all of it and a reset can name it. */
export function planSeed(accountId: string): Plan {
  const id = (name: string) => uuid5(`seed:${accountId}:${name}`, TUSK_NAMESPACE);
  const lists = [
    { key: 'first', id: firstListId(accountId), title: 'Backlog', color: '#6b7280' },
    { key: 'work', id: id('list:work'), title: 'Work', color: '#2563eb' },
    { key: 'groceries', id: id('list:groceries'), title: 'Groceries', color: '#16a34a' },
    { key: 'errands', id: id('list:errands'), title: 'Errands', color: '#d97706' },
    { key: 'someday', id: id('list:someday'), title: 'Someday', color: '#9ca3af' },
    { key: 'empty', id: id('list:empty'), title: 'An empty list', color: '#dc2626' },
  ] as const;
  const listPositions = many(null, null, lists.length);

  const cards: { list: string; key: string; title: string; description?: string; done?: number }[] =
    [
      {
        list: 'first',
        key: 'plants',
        title: 'Water the plants',
        description: 'The fern twice a week.',
      },
      { list: 'first', key: 'bank', title: 'Call the bank' },
      { list: 'first', key: 'long', title: LONG_TITLE, description: LONG_DESCRIPTION },
      { list: 'first', key: 'filed', title: 'File the receipts', done: 1_793_000_000_000 },
      { list: 'first', key: 'booked', title: 'Book the dentist', done: 1_793_100_000_000 },
      {
        list: 'work',
        key: 'report',
        title: 'Finish the quarterly report',
        description: 'Numbers from finance first.',
      },
      { list: 'work', key: 'review', title: 'Review the pull request' },
      { list: 'work', key: 'reply', title: 'Reply to the vendor', done: 1_793_200_000_000 },
      { list: 'groceries', key: 'milk', title: 'Oat milk' },
      { list: 'groceries', key: 'bread', title: 'Bread' },
      ...Array.from({ length: 40 }, (_, i) => ({
        list: 'errands',
        key: `errand-${i}`,
        title: `Errand number ${i + 1}`,
      })),
    ];

  // Checklists at nothing done, part of them, and all of them while the card is still open (finishing the parts is not finishing the thing).
  const items: { card: string; key: string; title: string; done?: number }[] = [
    { card: 'plants', key: 'plants-1', title: 'The fern' },
    { card: 'plants', key: 'plants-2', title: 'The ivy' },
    { card: 'plants', key: 'plants-3', title: 'The cactus, barely' },
    { card: 'report', key: 'report-1', title: 'Get the numbers', done: 1_793_300_000_000 },
    { card: 'report', key: 'report-2', title: 'Write the summary' },
    { card: 'report', key: 'report-3', title: 'Check the charts' },
    { card: 'review', key: 'review-1', title: 'Read the description', done: 1_793_400_000_000 },
    { card: 'review', key: 'review-2', title: 'Run it', done: 1_793_410_000_000 },
  ];

  const changes: Change[] = lists.map((list, i) => ({
    table: 'desk_list',
    id: list.id,
    position: listPositions[i] as string,
    fields: { title: { v: list.title }, color: { v: list.color }, sort: { v: 'custom' } },
  }));
  const cardIds: string[] = [];
  const checkIds: string[] = [];
  const byList = new Map<string, typeof cards>();
  for (const card of cards) byList.set(card.list, [...(byList.get(card.list) ?? []), card]);
  for (const [listKey, group] of byList) {
    const list = lists.find((l) => l.key === listKey);
    if (!list) continue;
    const positions = many(null, null, group.length);
    group.forEach((card, i) => {
      const cardId = id(`card:${card.key}`);
      cardIds.push(cardId);
      changes.push({
        table: 'desk_card',
        id: cardId,
        listId: list.id,
        position: positions[i] as string,
        fields: {
          title: { v: card.title },
          ...(card.description !== undefined ? { description: { v: card.description } } : {}),
          ...(card.done !== undefined ? { completedAt: { v: card.done } } : {}),
        },
      });
    });
  }

  for (const cardKey of new Set(items.map((item) => item.card))) {
    const mine = items.filter((item) => item.card === cardKey);
    const positions = many(null, null, mine.length);
    mine.forEach((item, i) => {
      const itemId = id(`check:${item.key}`);
      checkIds.push(itemId);
      changes.push({
        table: 'desk_check',
        id: itemId,
        cardId: id(`card:${cardKey}`),
        position: positions[i] as string,
        fields: {
          title: { v: item.title },
          ...(item.done !== undefined ? { completedAt: { v: item.done } } : {}),
        },
      });
    });
  }

  // One mutation of the lists, and one of the cards of each list with their checklists, as a person would have made them, each with an id that is the
  // same every time.
  const cardsOfList = (listKey: string) =>
    new Set((byList.get(listKey) ?? []).map((card) => id(`card:${card.key}`)));
  const mutations: Mutation[] = [
    { mutationId: id('mutation:lists'), changes: changes.filter((c) => c.table === 'desk_list') },
    ...[...byList.keys()].map((listKey) => ({
      mutationId: id(`mutation:cards:${listKey}`),
      changes: changes.filter(
        (c) =>
          (c.table === 'desk_card' && c.listId === lists.find((l) => l.key === listKey)?.id) ||
          (c.table === 'desk_check' &&
            c.cardId !== undefined &&
            cardsOfList(listKey).has(c.cardId)),
      ),
    })),
  ];
  return {
    mutations,
    ids: {
      desk_list: lists.map((l) => l.id),
      desk_card: cardIds,
      desk_check: checkIds,
      desk_series: [],
    },
  };
}

export interface SeedResult {
  accountId: string;
  created: boolean;
  /** The second account, and the shared workspace's steps (task 11.6). */
  secondAccountId: string;
  workspace: { created: boolean; steps: number };
  lists: number;
  cards: number;
  checks: number;
}

/** The account's id, if it exists. */
async function findUser(auth: Database, email = SEED_EMAIL): Promise<string | undefined> {
  const user = schema(auth).user;
  return (await dbGet<{ id: string }>(auth, sql`SELECT id FROM ${user} WHERE email = ${email}`))
    ?.id;
}

/** Makes the account through better-auth, with sign-up open for this one call whatever the instance says: it is making a development account. */
async function makeUser(
  auth: Database,
  settings: AuthSettings,
  email = SEED_EMAIL,
  name = SEED_NAME,
): Promise<string> {
  const instance = createAuth({
    settings: { ...settings, signUp: 'open' },
    name: 'Tusk',
    database: auth,
  });
  const made = await instance.api.signUpEmail({
    body: { name, email, password: SEED_PASSWORD },
  });
  return made.user.id;
}

/** Takes an account away: its settings row, its sessions and the account itself. */
async function removeUser(
  stores: { app: Database; auth: Database },
  accountId: string,
): Promise<void> {
  const a = schema(stores.auth);
  await dbRun(
    stores.app,
    sql`DELETE FROM ${schema(stores.app).accountSettings} WHERE account_id = ${accountId}`,
  );
  await dbRun(stores.auth, sql`DELETE FROM ${a.session} WHERE user_id = ${accountId}`);
  await dbRun(stores.auth, sql`DELETE FROM ${a.account} WHERE user_id = ${accountId}`);
  await dbRun(stores.auth, sql`DELETE FROM ${a.user} WHERE id = ${accountId}`);
}

/** Deletes what the seed made, and the account, and nothing else. */
export async function removeSeed(stores: { app: Database; auth: Database }): Promise<boolean> {
  const accountId = await findUser(stores.auth);
  const second = await findUser(stores.auth, SEED2_EMAIL);
  // The shared workspace first, by deleting it through the door, so that what is below it goes with it and nothing is left pointing at the accounts.
  if (accountId)
    await removeWorkspaceSeed(
      stores.app,
      { one: accountId, ...(second ? { two: second } : {}) },
      Date.now(),
    );
  if (second) await removeUser(stores, second);
  if (!accountId) return second !== undefined;
  const { app, auth } = stores;
  const plan = planSeed(accountId);
  const tables = schema(app);
  const mutationIds = plan.mutations.map((m) => m.mutationId);
  // Items first, then their cards, then the lists, as a purge does.
  for (const name of ['desk_check', 'desk_card', 'desk_series', 'desk_list'] as const) {
    for (const rowId of plan.ids[name])
      await dbRun(
        app,
        sql`DELETE FROM ${tableOf(app, name)} WHERE id = ${rowId} AND owner_id = ${accountId}`,
      );
  }
  for (const mutationId of mutationIds) {
    await dbRun(
      app,
      sql`DELETE FROM ${tables.appliedMutation} WHERE account_id = ${accountId} AND id = ${mutationId}`,
    );
  }
  await dbRun(app, sql`DELETE FROM ${tables.accountSettings} WHERE account_id = ${accountId}`);
  const a = schema(auth);
  await dbRun(auth, sql`DELETE FROM ${a.session} WHERE user_id = ${accountId}`);
  await dbRun(auth, sql`DELETE FROM ${a.account} WHERE user_id = ${accountId}`);
  await dbRun(auth, sql`DELETE FROM ${a.user} WHERE id = ${accountId}`);
  return true;
}

export async function runSeed(
  stores: { app: Database; auth: Database },
  settings: AuthSettings,
  options: { now?: number } = {},
): Promise<SeedResult> {
  let accountId = await findUser(stores.auth);
  const created = accountId === undefined;
  accountId ??= await makeUser(stores.auth, settings);

  const now = options.now ?? Date.now();
  const secondAccountId =
    (await findUser(stores.auth, SEED2_EMAIL)) ??
    (await makeUser(stores.auth, settings, SEED2_EMAIL, SEED2_NAME));
  for (const mutation of planSeed(accountId).mutations) {
    const result = await applyMutation(stores.app, accountId, mutation, { now });
    if (result.status === 'refused')
      throw new Error(`the seed was refused (${result.code}) for mutation ${mutation.mutationId}`);
  }
  const workspace = await seedWorkspace(
    stores.app,
    stores.auth,
    { one: accountId, two: secondAccountId },
    { now },
  );
  const count = async (name: SyncTable) =>
    Number(
      (
        await dbAll<{ n: number | string }>(
          stores.app,
          sql`SELECT COUNT(*) AS n FROM ${tableOf(stores.app, name)} WHERE owner_id = ${accountId}`,
        )
      )[0]?.n ?? 0,
    );
  return {
    accountId,
    created,
    secondAccountId,
    workspace,
    lists: await count('desk_list'),
    cards: await count('desk_card'),
    checks: await count('desk_check'),
  };
}

export async function main(argv: string[]): Promise<number> {
  const loaded = loadConfig(processEnv());
  if (!loaded.ok) {
    console.error('The settings are wrong:');
    for (const problem of loaded.problems) console.error(`  - ${problem}`);
    return 1;
  }
  if (!isLocalDatabase(loaded.config.database.database)) {
    console.error(
      'Refused: the database is not on this machine, and the seed makes an account with a password that is written in its source.',
    );
    return 1;
  }
  if (!loaded.config.auth) {
    console.error(
      'Sign-in is not set up (TUSK_AUTH_LOCAL, TUSK_AUTH_SECRET, TUSK_URL), and the seed needs an account.',
    );
    return 1;
  }
  const stores = await getStores(loaded.config.database);
  try {
    const remove = argv.includes('--remove') || argv.includes('--reset');
    if (remove)
      console.log(
        (await removeSeed(stores))
          ? 'Removed the seed account and what it made.'
          : 'There was no seed account.',
      );
    if (argv.includes('--remove')) return 0;
    const result = await runSeed(stores, loaded.config.auth);
    console.log(
      `${result.created ? 'Made' : 'Found'} ${SEED_EMAIL}; it has ${result.lists} lists, ${result.cards} cards and ${result.checks} checklist items.`,
    );
    console.log(
      `${SEED2_EMAIL} is a member of the workspace "Seed Studio" (${result.workspace.steps} steps ${result.workspace.created ? 'made' : 'found done'}): a public board, a private one, an archived one and a published one.`,
    );
    console.log(`Sign in with either address and the password in scripts/seed.ts (SEED_PASSWORD).`);
    return 0;
  } finally {
    await stores.close();
  }
}

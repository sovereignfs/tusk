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
import type { Change, Mutation } from '../src/sync/format';
import { TUSK_NAMESPACE, uuid5 } from '../src/uuid5';
import { firstListId } from '../src/actions/lists';

/**
 * A realistic account for development (task 11.1). It goes **through the store**: the same `applyMutation` the sync endpoint uses, so that what it
 * makes is what the app would have made, with the checks the app makes, and nothing is written to a table directly except to take it away again.
 *
 * - **Idempotent.** Every id is derived from the account and a name, and every mutation has a fixed id, so running it again finds all of it done and
 *   changes nothing.
 * - **Local only.** It refuses a database that is not on this machine: it makes an account with a password that is written in this file.
 * - **Removes only its own.** `--reset` deletes the rows whose ids it would make, and the account it made, and makes them again.
 * - It grows with the features: a feature that has a shape worth looking at adds it here, in the task that builds it.
 *   Subtasks are here (none done, some, and all while the parent is open); overdue, due today, upcoming, repeating and starred are not yet.
 */
export const SEED_EMAIL = 'seed@example.test';
/** A password for a development database on this machine, and for nothing else. */
export const SEED_PASSWORD = 'tusk-development-only';
export const SEED_NAME = 'Seed';

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
  ids: { list: string[]; task: string[]; series: string[] };
}

const LONG_TITLE =
  `${'A title that goes on and on, as a person who pastes a paragraph into the field would make one. '.repeat(8)}`.slice(
    0,
    500,
  );
const LONG_NOTES = Array.from(
  { length: 40 },
  (_, i) => `Line ${i + 1} of some long notes that a person kept about this one.`,
).join('\n');

/** What the seed makes, for an account. Pure, so that a test can look at all of it and a reset can name it. */
export function planSeed(accountId: string): Plan {
  const id = (name: string) => uuid5(`seed:${accountId}:${name}`, TUSK_NAMESPACE);
  const lists = [
    { key: 'first', id: firstListId(accountId), title: 'My tasks', color: 'black' },
    { key: 'work', id: id('list:work'), title: 'Work', color: 'blue' },
    { key: 'groceries', id: id('list:groceries'), title: 'Groceries', color: 'green' },
    { key: 'errands', id: id('list:errands'), title: 'Errands', color: 'amber' },
    { key: 'someday', id: id('list:someday'), title: 'Someday', color: 'grey' },
    { key: 'empty', id: id('list:empty'), title: 'An empty list', color: 'red' },
  ] as const;
  const listPositions = many(null, null, lists.length);

  const tasks: { list: string; key: string; title: string; notes?: string; done?: number }[] = [
    { list: 'first', key: 'plants', title: 'Water the plants', notes: 'The fern twice a week.' },
    { list: 'first', key: 'bank', title: 'Call the bank' },
    { list: 'first', key: 'long', title: LONG_TITLE, notes: LONG_NOTES },
    { list: 'first', key: 'filed', title: 'File the receipts', done: 1_793_000_000_000 },
    { list: 'first', key: 'booked', title: 'Book the dentist', done: 1_793_100_000_000 },
    {
      list: 'work',
      key: 'report',
      title: 'Finish the quarterly report',
      notes: 'Numbers from finance first.',
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

  // Subtasks at nothing done, part of them, and all of them while the parent is still open (finishing the parts is not finishing the thing).
  const subtasks: { parent: string; key: string; title: string; done?: number }[] = [
    { parent: 'plants', key: 'plants-1', title: 'The fern' },
    { parent: 'plants', key: 'plants-2', title: 'The ivy' },
    { parent: 'plants', key: 'plants-3', title: 'The cactus, barely' },
    { parent: 'report', key: 'report-1', title: 'Get the numbers', done: 1_793_300_000_000 },
    { parent: 'report', key: 'report-2', title: 'Write the summary' },
    { parent: 'report', key: 'report-3', title: 'Check the charts' },
    { parent: 'review', key: 'review-1', title: 'Read the description', done: 1_793_400_000_000 },
    { parent: 'review', key: 'review-2', title: 'Run it', done: 1_793_410_000_000 },
  ];

  const changes: Change[] = lists.map((list, i) => ({
    table: 'list',
    id: list.id,
    position: listPositions[i] as string,
    fields: { title: { v: list.title }, color: { v: list.color }, sort: { v: 'custom' } },
  }));
  const taskIds: string[] = [];
  const byList = new Map<string, typeof tasks>();
  for (const task of tasks) byList.set(task.list, [...(byList.get(task.list) ?? []), task]);
  for (const [listKey, group] of byList) {
    const list = lists.find((l) => l.key === listKey);
    if (!list) continue;
    const positions = many(null, null, group.length);
    group.forEach((task, i) => {
      const taskId = id(`task:${task.key}`);
      taskIds.push(taskId);
      changes.push({
        table: 'task',
        id: taskId,
        listId: list.id,
        parentId: null,
        position: positions[i] as string,
        fields: {
          title: { v: task.title },
          ...(task.notes !== undefined ? { notes: { v: task.notes } } : {}),
          ...(task.done !== undefined ? { completedAt: { v: task.done } } : {}),
        },
      });
    });
  }

  const parentOf = (key: string) => tasks.find((t) => t.key === key);
  for (const parentKey of new Set(subtasks.map((sub) => sub.parent))) {
    const parent = parentOf(parentKey);
    const list = lists.find((l) => l.key === parent?.list);
    if (!parent || !list) continue;
    const mine = subtasks.filter((sub) => sub.parent === parentKey);
    const positions = many(null, null, mine.length);
    mine.forEach((sub, i) => {
      const subId = id(`task:${sub.key}`);
      taskIds.push(subId);
      changes.push({
        table: 'task',
        id: subId,
        listId: list.id,
        parentId: id(`task:${parentKey}`),
        position: positions[i] as string,
        fields: {
          title: { v: sub.title },
          ...(sub.done !== undefined ? { completedAt: { v: sub.done } } : {}),
        },
      });
    });
  }

  // One mutation of the lists, and one of the tasks of each list, as a person would have made them, each with an id that is the same every time.
  const mutations: Mutation[] = [
    { mutationId: id('mutation:lists'), changes: changes.filter((c) => c.table === 'list') },
    ...[...byList.keys()].map((listKey) => ({
      mutationId: id(`mutation:tasks:${listKey}`),
      changes: changes.filter(
        (c) => c.table === 'task' && c.listId === lists.find((l) => l.key === listKey)?.id,
      ),
    })),
  ];
  return { mutations, ids: { list: lists.map((l) => l.id), task: taskIds, series: [] } };
}

export interface SeedResult {
  accountId: string;
  created: boolean;
  lists: number;
  tasks: number;
}

/** The account's id, if it exists. */
async function findUser(auth: Database): Promise<string | undefined> {
  const user = schema(auth).user;
  return (
    await dbGet<{ id: string }>(auth, sql`SELECT id FROM ${user} WHERE email = ${SEED_EMAIL}`)
  )?.id;
}

/** Makes the account through better-auth, with sign-up open for this one call whatever the instance says: it is making a development account. */
async function makeUser(auth: Database, settings: AuthSettings): Promise<string> {
  const instance = createAuth({
    settings: { ...settings, signUp: 'open' },
    name: 'Tusk',
    database: auth,
  });
  const made = await instance.api.signUpEmail({
    body: { name: SEED_NAME, email: SEED_EMAIL, password: SEED_PASSWORD },
  });
  return made.user.id;
}

/** Deletes what the seed made, and the account, and nothing else. */
export async function removeSeed(stores: { app: Database; auth: Database }): Promise<boolean> {
  const accountId = await findUser(stores.auth);
  if (!accountId) return false;
  const { app, auth } = stores;
  const plan = planSeed(accountId);
  const tables = schema(app);
  const mutationIds = plan.mutations.map((m) => m.mutationId);
  const owned = async (table: unknown, ids: string[]) => {
    for (const rowId of ids)
      await dbRun(
        app,
        sql`DELETE FROM ${table as never} WHERE id = ${rowId} AND owner_id = ${accountId}`,
      );
  };
  await owned(tables.task, plan.ids.task);
  await owned(tables.list, plan.ids.list);
  await owned(tables.series, plan.ids.series);
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
  for (const mutation of planSeed(accountId).mutations) {
    const result = await applyMutation(stores.app, accountId, mutation, { now });
    if (result.status === 'refused')
      throw new Error(`the seed was refused (${result.code}) for mutation ${mutation.mutationId}`);
  }
  const tables = schema(stores.app);
  const count = async (table: unknown) =>
    Number(
      (
        await dbAll<{ n: number | string }>(
          stores.app,
          sql`SELECT COUNT(*) AS n FROM ${table as never} WHERE owner_id = ${accountId}`,
        )
      )[0]?.n ?? 0,
    );
  return { accountId, created, lists: await count(tables.list), tasks: await count(tables.task) };
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
      `${result.created ? 'Made' : 'Found'} ${SEED_EMAIL}; it has ${result.lists} lists and ${result.tasks} tasks.`,
    );
    console.log(`Sign in with that address and the password in scripts/seed.ts (SEED_PASSWORD).`);
    return 0;
  } finally {
    await stores.close();
  }
}

import { sql } from 'drizzle-orm';
import { type Parsed, bool, hhmm, oneOf } from '../access/parse';
import type { Database } from '../db/client';
import { dbGet, dbRun } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { isValidZone } from '../time';
import {
  NOTICE_KINDS,
  type NoticeKind,
  WORKSPACE_SORTS,
  type WorkspaceSort,
} from '../workspaces/format';

/**
 * What an account keeps with the account and not on a device (DESIGN.md §19), so that it is the same on every one: how the boards index sorts the
 * person's own workspaces, their time zone, which the browser reports so that the server's jobs agree with the person's own clock (§11), and the kinds of
 * notice they have turned off (§16), which are then not written at all. **A closed record**, like an operation: the keys it takes and nothing else, at
 * least one, so that a device cannot write what the server does not read. `PATCH /api/settings` carries it, and `GET` reads it.
 */
export interface SettingsChange {
  readonly workspaceSort?: WorkspaceSort;
  readonly timeZone?: string;
  /** The kinds turned off; the rest are on. */
  readonly noticesOff?: readonly NoticeKind[];
  /** The daily brief on or off, and when it is sent (`HH:MM` in the account's zone) (§25.2). */
  readonly briefOn?: boolean;
  readonly briefAt?: string;
  /** A reminder when a card is due, at its time. */
  readonly remindersOn?: boolean;
  /** What is sent outside the app goes by email too: refused where the server has no mail. */
  readonly emailOn?: boolean;
  /** The kinds of Inbox notice that are also sent outside the app. */
  readonly sentKinds?: readonly NoticeKind[];
}

export interface Settings {
  readonly workspaceSort: WorkspaceSort;
  readonly timeZone: string;
  readonly noticesOff: readonly NoticeKind[];
  readonly briefOn: boolean;
  readonly briefAt: string;
  readonly remindersOn: boolean;
  readonly emailOn: boolean;
  readonly sentKinds: readonly NoticeKind[];
}

/** What can work on this server, which the settings screen is built from and which a change is held to (§19): nothing is offered that cannot be delivered. */
export interface Capabilities {
  /** The server has mail. */
  readonly email: boolean;
  /** The server has VAPID keys, so a device can be offered Push. */
  readonly push: boolean;
  /** The account signs in through a core, which can carry a notification to the person's other apps. */
  readonly core: boolean;
}

const KEYS = [
  'workspaceSort',
  'timeZone',
  'noticesOff',
  'briefOn',
  'briefAt',
  'remindersOn',
  'emailOn',
  'sentKinds',
];

/** A list of notice kinds, each once, or why not. */
function kinds(value: unknown, name: string): Parsed<NoticeKind[]> {
  const kind = oneOf(...NOTICE_KINDS);
  if (!Array.isArray(value) || value.length > NOTICE_KINDS.length)
    return { ok: false, reason: `${name}: not a list of kinds` };
  const out: NoticeKind[] = [];
  for (const each of value) {
    const parsed = kind(each);
    if (!parsed.ok) return { ok: false, reason: `${name}: not a kind of notice` };
    if (!out.includes(parsed.value)) out.push(parsed.value);
  }
  return { ok: true, value: out };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSettingsChange(
  value: unknown,
  can: Pick<Capabilities, 'email'> = { email: true },
): Parsed<SettingsChange> {
  if (!isRecord(value)) return { ok: false, reason: 'not settings' };
  const given = Object.keys(value);
  if (given.length === 0) return { ok: false, reason: 'no setting' };
  if (given.some((key) => !KEYS.includes(key)))
    return { ok: false, reason: 'names a setting there is not' };
  const change: {
    -readonly [K in keyof SettingsChange]?: SettingsChange[K];
  } = {};
  if ('workspaceSort' in value) {
    const sort = oneOf(...WORKSPACE_SORTS)(value.workspaceSort);
    if (!sort.ok) return { ok: false, reason: 'workspaceSort: not a sort' };
    change.workspaceSort = sort.value;
  }
  if ('timeZone' in value) {
    // A zone this runtime does not know is refused here, and a zone that has gone bad since is UTC wherever it is used (`src/time.ts`).
    if (!isValidZone(value.timeZone)) return { ok: false, reason: 'timeZone: not a zone' };
    change.timeZone = value.timeZone;
  }
  if ('noticesOff' in value) {
    const list = kinds(value.noticesOff, 'noticesOff');
    if (!list.ok) return list;
    change.noticesOff = list.value;
  }
  if ('sentKinds' in value) {
    const list = kinds(value.sentKinds, 'sentKinds');
    if (!list.ok) return list;
    change.sentKinds = list.value;
  }
  for (const name of ['briefOn', 'remindersOn', 'emailOn'] as const) {
    if (!(name in value)) continue;
    const flag = bool(value[name]);
    if (!flag.ok) return { ok: false, reason: `${name}: true or false` };
    change[name] = flag.value;
  }
  // Mail is a thing the server has or has not: turning it on where there is none is refused here, and not only left unoffered by the screen.
  if (change.emailOn === true && !can.email)
    return { ok: false, reason: 'emailOn: this server has no mail' };
  if ('briefAt' in value) {
    const time = hhmm(value.briefAt);
    if (!time.ok) return { ok: false, reason: 'briefAt: not a time' };
    change.briefAt = time.value;
  }
  return { ok: true, value: change };
}

const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

/** A boolean as the database holds it: a number for SQLite, a boolean for PostgreSQL. */
const flag = (database: Database, value: boolean) =>
  database.dialect === 'postgres' ? value : value ? 1 : 0;

/** Writes the account's own row, made if it is the first thing the account has kept (the sync counter makes the same row, and neither undoes the other). */
export async function saveSettings(
  database: Database,
  accountId: string,
  change: SettingsChange,
  now: number,
): Promise<void> {
  // Each setting named, with the column it is kept in and the value as the database holds it.
  const given: [string, string | number | boolean][] = [];
  if (change.workspaceSort) given.push(['workspace_sort', change.workspaceSort]);
  if (change.timeZone) given.push(['time_zone', change.timeZone]);
  if (change.noticesOff) given.push(['notices_off', change.noticesOff.join(',')]);
  if (change.briefOn !== undefined) given.push(['brief_on', flag(database, change.briefOn)]);
  if (change.briefAt) given.push(['brief_at', change.briefAt]);
  if (change.remindersOn !== undefined)
    given.push(['reminders_on', flag(database, change.remindersOn)]);
  if (change.emailOn !== undefined) given.push(['email_on', flag(database, change.emailOn)]);
  if (change.sentKinds) given.push(['sent_kinds', change.sentKinds.join(',')]);
  if (given.length === 0) return;
  // The names are ours, a closed list above, and the values are bound.
  const columns = given.map(([name]) => sql.raw(name));
  const sets = given.map(([name, value]) => sql`${sql.raw(name)} = ${value}`);
  await dbRun(
    database,
    sql`INSERT INTO ${table(database)} (account_id, seq, created_at, ${sql.join(columns, sql`, `)})
        VALUES (${accountId}, 0, ${now}, ${sql.join(
          given.map(([, value]) => sql`${value}`),
          sql`, `,
        )})
        ON CONFLICT (account_id) DO UPDATE SET ${sql.join(sets, sql`, `)}`,
  );
}

const kindsOf = (list: string | undefined): NoticeKind[] =>
  (list ?? '')
    .split(',')
    .filter((each): each is NoticeKind => (NOTICE_KINDS as readonly string[]).includes(each));

/** What the account keeps, with the defaults for what it has not set. */
export async function readSettings(database: Database, accountId: string): Promise<Settings> {
  const row = await dbGet<{
    sort: string;
    zone: string;
    off: string;
    briefOn: number | boolean;
    briefAt: string;
    remindersOn: number | boolean;
    emailOn: number | boolean;
    sent: string;
  }>(
    database,
    sql`SELECT workspace_sort AS sort, time_zone AS zone, notices_off AS off, brief_on AS "briefOn", brief_at AS "briefAt",
               reminders_on AS "remindersOn", email_on AS "emailOn", sent_kinds AS sent
        FROM ${table(database)} WHERE account_id = ${accountId}`,
  );
  const sort = (WORKSPACE_SORTS as readonly string[]).includes(row?.sort ?? '')
    ? (row?.sort as WorkspaceSort)
    : 'name';
  return {
    workspaceSort: sort,
    timeZone: row?.zone ?? 'UTC',
    noticesOff: kindsOf(row?.off),
    briefOn: Boolean(Number(row?.briefOn ?? 0)),
    briefAt: row?.briefAt ?? '08:00',
    remindersOn: Boolean(Number(row?.remindersOn ?? 0)),
    emailOn: Boolean(Number(row?.emailOn ?? 0)),
    sentKinds: kindsOf(row?.sent),
  };
}

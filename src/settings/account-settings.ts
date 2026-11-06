import { sql } from 'drizzle-orm';
import { type Parsed, oneOf } from '../access/parse';
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
}

export interface Settings {
  readonly workspaceSort: WorkspaceSort;
  readonly timeZone: string;
  readonly noticesOff: readonly NoticeKind[];
}

const KEYS = ['workspaceSort', 'timeZone', 'noticesOff'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSettingsChange(value: unknown): Parsed<SettingsChange> {
  if (!isRecord(value)) return { ok: false, reason: 'not settings' };
  const given = Object.keys(value);
  if (given.length === 0) return { ok: false, reason: 'no setting' };
  if (given.some((key) => !KEYS.includes(key)))
    return { ok: false, reason: 'names a setting there is not' };
  const change: { workspaceSort?: WorkspaceSort; timeZone?: string; noticesOff?: NoticeKind[] } =
    {};
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
    const list = value.noticesOff;
    const kind = oneOf(...NOTICE_KINDS);
    if (!Array.isArray(list) || list.length > NOTICE_KINDS.length)
      return { ok: false, reason: 'noticesOff: not a list of kinds' };
    const kinds: NoticeKind[] = [];
    for (const each of list) {
      const parsed = kind(each);
      if (!parsed.ok) return { ok: false, reason: 'noticesOff: not a kind of notice' };
      if (!kinds.includes(parsed.value)) kinds.push(parsed.value);
    }
    change.noticesOff = kinds;
  }
  return { ok: true, value: change };
}

const table = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;

/** Writes the account's own row, made if it is the first thing the account has kept (the sync counter makes the same row, and neither undoes the other). */
export async function saveSettings(
  database: Database,
  accountId: string,
  change: SettingsChange,
  now: number,
): Promise<void> {
  const off = change.noticesOff?.join(',');
  const sets = [
    ...(change.workspaceSort ? [sql`workspace_sort = ${change.workspaceSort}`] : []),
    ...(change.timeZone ? [sql`time_zone = ${change.timeZone}`] : []),
    ...(off !== undefined ? [sql`notices_off = ${off}`] : []),
  ];
  if (sets.length === 0) return;
  await dbRun(
    database,
    sql`INSERT INTO ${table(database)} (account_id, seq, created_at, workspace_sort, time_zone, notices_off)
        VALUES (${accountId}, 0, ${now}, ${change.workspaceSort ?? 'name'}, ${change.timeZone ?? 'UTC'}, ${off ?? ''})
        ON CONFLICT (account_id) DO UPDATE SET ${sql.join(sets, sql`, `)}`,
  );
}

/** What the account keeps, with the defaults for what it has not set. */
export async function readSettings(database: Database, accountId: string): Promise<Settings> {
  const row = await dbGet<{ sort: string; zone: string; off: string }>(
    database,
    sql`SELECT workspace_sort AS sort, time_zone AS zone, notices_off AS off FROM ${table(database)} WHERE account_id = ${accountId}`,
  );
  const sort = (WORKSPACE_SORTS as readonly string[]).includes(row?.sort ?? '')
    ? (row?.sort as WorkspaceSort)
    : 'name';
  return {
    workspaceSort: sort,
    timeZone: row?.zone ?? 'UTC',
    noticesOff: (row?.off ?? '')
      .split(',')
      .filter((each): each is NoticeKind => (NOTICE_KINDS as readonly string[]).includes(each)),
  };
}

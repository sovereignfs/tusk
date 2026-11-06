import { sql } from 'drizzle-orm';
import { type Parsed, oneOf } from '../access/parse';
import type { Database } from '../db/client';
import { dbRun } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { isValidZone } from '../time';
import { WORKSPACE_SORTS, type WorkspaceSort } from '../workspaces/format';

/**
 * What an account keeps with the account and not on a device (DESIGN.md §19), so that it is the same on every one: how the boards index sorts the
 * person's own workspaces, and their time zone, which the browser reports so that the server's jobs agree with the person's own clock (§11).
 * **A closed record**, like an operation: the keys it takes and nothing else, at least one, so that a device cannot write what the server does not read.
 * `PATCH /api/settings` carries it.
 */
export interface SettingsChange {
  readonly workspaceSort?: WorkspaceSort;
  readonly timeZone?: string;
}

const KEYS = ['workspaceSort', 'timeZone'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSettingsChange(value: unknown): Parsed<SettingsChange> {
  if (!isRecord(value)) return { ok: false, reason: 'not settings' };
  const given = Object.keys(value);
  if (given.length === 0) return { ok: false, reason: 'no setting' };
  if (given.some((key) => !KEYS.includes(key)))
    return { ok: false, reason: 'names a setting there is not' };
  const change: { workspaceSort?: WorkspaceSort; timeZone?: string } = {};
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
  return { ok: true, value: change };
}

/** Writes the account's own row, made if it is the first thing the account has kept (the sync counter makes the same row, and neither undoes the other). */
export async function saveSettings(
  database: Database,
  accountId: string,
  change: SettingsChange,
  now: number,
): Promise<void> {
  const table =
    database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;
  const sets = [
    ...(change.workspaceSort ? [sql`workspace_sort = ${change.workspaceSort}`] : []),
    ...(change.timeZone ? [sql`time_zone = ${change.timeZone}`] : []),
  ];
  if (sets.length === 0) return;
  await dbRun(
    database,
    sql`INSERT INTO ${table} (account_id, seq, created_at, workspace_sort, time_zone)
        VALUES (${accountId}, 0, ${now}, ${change.workspaceSort ?? 'name'}, ${change.timeZone ?? 'UTC'})
        ON CONFLICT (account_id) DO UPDATE SET ${sql.join(sets, sql`, `)}`,
  );
}

import { sql } from 'drizzle-orm';
import { type Parsed, oneOf } from '../access/parse';
import type { Database } from '../db/client';
import { dbRun } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { WORKSPACE_SORTS, type WorkspaceSort } from '../workspaces/format';

/**
 * What an account keeps with the account and not on a device (DESIGN.md §19), so that it is the same on every one. So far: how the boards index sorts
 * the person's own workspaces. **A closed record**, like an operation: the keys it takes and nothing else, so that a device cannot write what the
 * server does not read. `PATCH /api/settings` carries it.
 */
export interface SettingsChange {
  readonly workspaceSort: WorkspaceSort;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSettingsChange(value: unknown): Parsed<SettingsChange> {
  if (!isRecord(value)) return { ok: false, reason: 'not settings' };
  if (Object.keys(value).some((key) => key !== 'workspaceSort'))
    return { ok: false, reason: 'names a setting there is not' };
  const sort = oneOf(...WORKSPACE_SORTS)(value.workspaceSort);
  if (!sort.ok) return { ok: false, reason: 'workspaceSort: not a sort' };
  return { ok: true, value: { workspaceSort: sort.value } };
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
  await dbRun(
    database,
    sql`INSERT INTO ${table} (account_id, seq, created_at, workspace_sort) VALUES (${accountId}, 0, ${now}, ${change.workspaceSort})
        ON CONFLICT (account_id) DO UPDATE SET workspace_sort = ${change.workspaceSort}`,
  );
}

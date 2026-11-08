import { sql } from 'drizzle-orm';
import type { Operator } from '../crypto/operator';
import type { Directory } from '../auth/directory';
import type { Database } from '../db/client';
import { dbGet, transaction } from '../db/exec';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { LocalRow } from '../local/rows';
import { readEncryption } from '../encryption/state';
import { type TuskExport, buildDesk, buildSealedDesk, envelope } from '../portability/format';
import { pull } from '../sync/pull';
import { exportOwned, ownedStamps } from '../workspaces/export';
import { backupFingerprint } from './path';

/**
 * What a backup holds, read on the server (DESIGN.md §21.3): the "everything" file of §20, the Desk and every workspace the person owns, and the fingerprint
 * of it. **It is read in one short transaction that is over before any call to a git host.** The Desk is read the way a device reads it from nothing, by
 * pulling from zero (`pull`, which never skips a row), and made into the file by the same `buildDesk` the browser uses, so that the two files are alike.

 * A Desk with a key of its own is written sealed (`buildSealedDesk`): the server cannot open it, and a backup is as private as the database (task 14.5).
 */
export interface Snapshot {
  readonly file: TuskExport;
  readonly fingerprint: string;
}

const PAGE = 2000;

export async function takeSnapshot(
  database: Database,
  directory: Pick<Directory, 'profiles'>,
  accountId: string,
  now: Date,
  operator?: Operator,
): Promise<Snapshot> {
  return transaction(database, async (tx) => {
    const settings =
      tx.dialect === 'postgres' ? postgresSchema.accountSettings : sqliteSchema.accountSettings;
    const row = await dbGet<{ seq: number | string }>(
      tx,
      sql`SELECT seq FROM ${settings} WHERE account_id = ${accountId}`,
    );
    const seq = Number(row?.seq ?? 0);

    const rows: LocalRow[] = [];
    for (let cursor = 0; ;) {
      const page = await pull(tx, accountId, cursor, {
        limit: PAGE,
        ...(operator ? { operator } : {}),
      });
      rows.push(...page.rows);
      cursor = page.cursor;
      if (!page.more) break;
    }
    const of = (table: LocalRow['table']) => rows.filter((each) => each.table === table);
    const deskRows = {
      lists: of('desk_list'),
      cards: of('desk_card'),
      checks: of('desk_check'),
      series: of('desk_series'),
    };
    // A Desk with a key of its own is written as the server has it: ciphertext in every field and each list's wrapped key, and `"encrypted": true` (§9.4).
    const sealed = (await readEncryption(tx, accountId)).mode !== 'none';
    const workspaces = await exportOwned(tx, directory, accountId);
    const stamps = await ownedStamps(tx, accountId);
    return {
      file: envelope(
        'everything',
        sealed
          ? { sealedDesk: buildSealedDesk(deskRows), workspaces }
          : { desk: buildDesk(deskRows), workspaces },
        now,
      ),
      fingerprint: backupFingerprint(seq, stamps),
    };
  });
}

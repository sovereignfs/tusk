import type { Database } from '../db/client';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import type { SyncTable } from './format';

/**
 * The table of each name that syncs, on the database's dialect (DESIGN.md §23.3). The names a device sends are `SyncTable`s, which are the tables'
 * own names; this is the one place that maps one to the schema's object, so that no code indexes a schema by a name a device chose.
 */
export function tableOf(database: Database, name: SyncTable) {
  const schema = database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
  switch (name) {
    case 'desk_list':
      return schema.deskList;
    case 'desk_card':
      return schema.deskCard;
    case 'desk_check':
      return schema.deskCheck;
    case 'desk_series':
      return schema.deskSeries;
  }
}

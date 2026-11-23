import { CORE_SIGN_IN_MIGRATIONS_TABLE, coreSignInMigrations } from '@sovereignfs/auth/core';
import { runMigrations, type Database } from '@sovereignfs/auth/database';
import {
  ACCOUNT_MIGRATIONS_TABLE,
  accountMigrations,
  adoptAccountTables,
  type AdoptionResult,
} from '@sovereignfs/auth/server';
import { VAULT_MIGRATIONS_TABLE, vaultMigrations } from '@sovereignfs/sdk/vault';
import { SDK_STORE_MIGRATIONS_TABLE, sdkStoreMigrations } from './sdk-stores';

const migrateCore = (database: Database) =>
  runMigrations(database, coreSignInMigrations(database.family), {
    table: CORE_SIGN_IN_MIGRATIONS_TABLE,
  });

/**
 * The auth store onto `@sovereignfs/auth` (auth.md §8.1), run at every start after Tusk's own auth migrations, which made better-auth's
 * tables under their singular names up to 0.3.0 and still make them in a new store, so every store takes one road.
 *
 * 1. `adoptAccountTables` renames them onto the package's, adds its columns and tables and marks every password for 90 days, once: Tusk
 *    stored a hash of the password itself, so every password moves to a hash of the sign-in value at its next sign-in (`/sign-in`).
 * 2. The package's migrations, the core sign-in's, the SDK's store and the vault's, each under its own history, every time: a later release
 *    of the package adds its migrations here. The vault is only its id, the salt of the sign-in value (`/api/sign-in-salt`, sdk §9.5).
 *
 * Every step is safe to run again.
 */
export async function migrateAuthStore(database: Database): Promise<AdoptionResult> {
  // The core sign-in's tables are made whether or not core is a way in now: core can be turned on later, and the move fills them.
  const result = await adoptAccountTables(database, { core: { migrate: migrateCore } });
  await runMigrations(database, accountMigrations(database.family), {
    table: ACCOUNT_MIGRATIONS_TABLE,
  });
  await migrateCore(database);
  await runMigrations(database, sdkStoreMigrations(database.family), {
    table: SDK_STORE_MIGRATIONS_TABLE,
  });
  await runMigrations(database, vaultMigrations(database.family), {
    table: VAULT_MIGRATIONS_TABLE,
  });
  return result;
}

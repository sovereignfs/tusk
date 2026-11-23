// Generate a migration for both dialects and both stores, with the same name, so that a
// reviewer reads files called 0001_<name>.sql and not random words.
//
//   pnpm db:generate <name>     e.g. pnpm db:generate add_connection
//
// Generating is the only way a migration is made: `drizzle-kit push` is never used
// (DESIGN.md §22.1). CI runs this with the committed schemas and fails if it would
// write anything, so a schema change without its migration cannot merge.
import { spawnSync } from 'node:child_process';

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
  console.error('usage: pnpm db:generate <name>   (lowercase letters, digits and underscores)');
  process.exit(2);
}

// The app's store, one dialect at a time; one with no change writes nothing. The auth store's tables are
// @sovereignfs/auth's, migrated by the package: its own migrations here (`migrations/auth`) are the 0.3.0
// shape the package moves from, and are never generated again.
const configs = ['sqlite', 'postgres'];
for (const config of configs) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'generate', `--config=drizzle.${config}.config.ts`, `--name=${name}`],
    {
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

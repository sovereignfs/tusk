import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema/postgres/app.ts', './src/db/schema/postgres/workspaces.ts'],
  out: './migrations/postgres',
  dialect: 'postgresql',
});

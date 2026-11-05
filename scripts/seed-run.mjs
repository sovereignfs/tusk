// A realistic account to develop against: `pnpm seed`, or `pnpm seed -- --reset` to start it again and `--remove` to take it away. The work is in
// `scripts/seed.ts`; this only runs it, through `jiti`, which reads TypeScript, so that it uses the app's own code and not a copy of it.
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { main } = await jiti.import('./seed.ts');
process.exit(await main(process.argv.slice(2)));

// `pnpm encrypt-data status | seal | open`: moves a development database to or from the operator key (`scripts/encrypt-data.ts`, which has the work and the
// rules), through `jiti` so that it uses the app's own code. The image has the same script as a bundle: `node tools/encrypt-data.mjs`.
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { main } = await jiti.import('./encrypt-data.ts');
process.exit(await main(process.argv.slice(2)));

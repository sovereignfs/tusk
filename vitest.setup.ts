import { ringOf } from './src/crypto/keys';
import { configureOperator } from './src/workspaces/content';

/**
 * `TUSK_TEST_OPERATOR=on pnpm test` runs every test with the operator key set (DESIGN.md §9.5, task 14.7): the workspace role matrix, activity, the Inbox,
 * publishing, export and import all pass with each content column sealed, which is what shows that every one of them goes through `src/workspaces/content.ts`.
 * A test that looks into the database for plain content is for the mode off, and says so with `describe.skipIf(operatorTests)`.
 */
if (process.env.TUSK_TEST_OPERATOR === 'on') configureOperator(ringOf(Buffer.alloc(32, 42)));

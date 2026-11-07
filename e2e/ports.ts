/**
 * Every port the browser tests use, each shifted by `TUSK_E2E_PORT_OFFSET`, so that several runs can share a machine: `scripts/e2e-shard.mjs` gives each of its
 * shards a hundred of its own, and each then has its own instances, databases and fake services. With none set they are the ports the tests have always used.
 * Plain TypeScript with no syntax Node cannot strip, since `e2e/fake-sovereign-server.ts` is run by Node and reads this too.
 */
const offset = Number(process.env.TUSK_E2E_PORT_OFFSET ?? 0);
if (!Number.isInteger(offset) || offset < 0 || offset > 20_000) {
  throw new Error('TUSK_E2E_PORT_OFFSET must be a whole number from 0 to 20000');
}

export const PORTS = {
  /** The app under test, on the database the environment names. */
  app: 3999 + offset,
  /** Where the fake GitHub of `e2e/backup.spec.ts` listens. */
  github: 3998 + offset,
  /** The instance for a key of one's own (`e2e/key.spec.ts`). */
  keys: 3997 + offset,
  /** The instance for how an account signs in (`e2e/security.spec.ts`). */
  security: 3996 + offset,
  /** The instance that takes only Sovereign, and the one that takes both ways (`e2e/sovereign.spec.ts`). */
  sovereign: 3995 + offset,
  both: 3994 + offset,
  /** The fake Sovereign: the OIDC provider, and the control port a test says who signs in next on. */
  coreAuth: 3190 + offset,
  coreControl: 3191 + offset,
} as const;

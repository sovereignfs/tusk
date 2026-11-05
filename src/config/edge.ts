/**
 * What the proxy needs of the settings. It runs on the Edge runtime, where `node:fs` is not there, so it cannot use `./env` (which reads secret
 * files), and it needs only three settings, none of them a secret. `process.env` is read here, in `src/config`, as everywhere (see
 * `process-env.test.ts`). Nothing in this file may import a Node built-in.
 */
export function edgeSettings(env: Record<string, string | undefined> = process.env): {
  /** The app is served over https (`TASKS_URL`). */
  secure: boolean;
  /** `next dev`. */
  development: boolean;
  /** Local sign-in is on (`TASKS_AUTH_LOCAL`): when it is not, the sign-in pages do not exist. */
  authLocal: boolean;
} {
  const local = (env.TASKS_AUTH_LOCAL ?? '').trim().toLowerCase();
  return {
    authLocal: local === '1' || local === 'true',
    secure: (env.TASKS_URL ?? '').startsWith('https://'),
    development: env.NODE_ENV === 'development',
  };
}

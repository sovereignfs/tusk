/**
 * What the proxy needs of the settings. It runs on the Edge runtime, where `node:fs` is not there, so it cannot use `./env` (which reads secret
 * files), and it needs only two settings, neither of them a secret. `process.env` is read here, in `src/config`, as everywhere (see
 * `process-env.test.ts`). Nothing in this file may import a Node built-in.
 */
export function edgeSettings(env: Record<string, string | undefined> = process.env): {
  /** The app is served over https (`TASKS_URL`). */
  secure: boolean;
  /** `next dev`. */
  development: boolean;
} {
  return {
    secure: (env.TASKS_URL ?? '').startsWith('https://'),
    development: env.NODE_ENV === 'development',
  };
}

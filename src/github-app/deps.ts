import { getConfig } from '../config/current';
import { getDatabase } from '../db/boot';
import { GitHubProvider } from '../providers/github';
import { RateLimiter } from '../limits/rate';
import type { AppDeps } from './endpoint';
import { installationTokens } from './server';

/** What the App's routes are handed, or undefined when no App is set up (they then answer 404). */
export async function appDeps(): Promise<AppDeps | undefined> {
  const config = getConfig();
  const tokens = installationTokens();
  if (!config.githubApp || !config.url || !tokens) return undefined;
  const database = await getDatabase();
  return {
    app: config.githubApp,
    url: config.url,
    apiUrl: config.githubApiUrl,
    database,
    now: Date.now,
    limiter: new RateLimiter(database),
    providerFor: async (installationId) =>
      new GitHubProvider({
        token: await tokens.forInstallation(installationId),
        apiUrl: config.githubApiUrl,
      }),
  };
}

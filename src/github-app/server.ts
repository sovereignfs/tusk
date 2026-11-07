import { getConfig } from '../config/current';
import { InstallationTokens } from './tokens';

/**
 * The server's token source for the GitHub App: one for the process, so that a token held in memory is used by every request and job. Undefined when no App
 * is set up. Never for a test, which makes its own.
 */
const KEY = Symbol.for('tusk.installation-tokens');
type Holder = { [KEY]?: InstallationTokens | undefined };

export function installationTokens(): InstallationTokens | undefined {
  const config = getConfig();
  if (!config.githubApp) return undefined;
  const holder = globalThis as Holder;
  holder[KEY] ??= new InstallationTokens({
    appId: config.githubApp.appId,
    privateKey: config.githubApp.privateKey,
    apiUrl: config.githubApiUrl,
  });
  return holder[KEY];
}

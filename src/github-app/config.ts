import { createPrivateKey } from 'node:crypto';
import type { Problem } from '../config';

/**
 * The GitHub App (DESIGN.md §21.2), if the operator registered one: all six settings or none (`loadConfig` stops on some). With it a person connects a repository
 * by installing the App on it, and Tusk keeps no token: it signs for a short-lived one when it needs one.
 *
 *   TUSK_GITHUB_APP_ID               the App's id (a number), the `iss` of the JWT it signs
 *   TUSK_GITHUB_APP_SLUG             its name in GitHub's addresses, where it is installed from (github.com/apps/<slug>)
 *   TUSK_GITHUB_APP_CLIENT_ID        its OAuth client, to ask GitHub who the person is on the way back
 *   TUSK_GITHUB_APP_CLIENT_SECRET    and its secret
 *   TUSK_GITHUB_APP_WEBHOOK_SECRET   signs what GitHub tells Tusk (an installation removed)
 *   TUSK_GITHUB_APP_PRIVATE_KEY      the App's private key (PEM; a file with `_FILE`, or one line with `\n` for the line breaks)
 */
export interface GitHubAppSettings {
  readonly appId: string;
  readonly slug: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly privateKey: string;
}

export const REDIRECT_PATH = '/api/backup/app/callback';

type Read = (name: string) => string | undefined;

/** The settings, or `undefined` when the App is not set up (or a problem was pushed: a partial set is reported by the caller's group check). */
export function resolveGitHubApp(
  read: Read,
  url: string | undefined,
  problems: Problem[],
): GitHubAppSettings | undefined {
  const names = [
    'TUSK_GITHUB_APP_ID',
    'TUSK_GITHUB_APP_SLUG',
    'TUSK_GITHUB_APP_CLIENT_ID',
    'TUSK_GITHUB_APP_CLIENT_SECRET',
    'TUSK_GITHUB_APP_WEBHOOK_SECRET',
    'TUSK_GITHUB_APP_PRIVATE_KEY',
  ] as const;
  const [appId, slug, clientId, clientSecret, webhookSecret, rawKey] = names.map(read);
  if (!appId || !slug || !clientId || !clientSecret || !webhookSecret || !rawKey) return undefined;

  let ok = true;
  if (!/^\d{1,20}$/.test(appId)) {
    problems.push('TUSK_GITHUB_APP_ID is the App’s number.');
    ok = false;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(slug)) {
    problems.push(
      'TUSK_GITHUB_APP_SLUG is the App’s name in GitHub’s addresses (letters, digits and hyphens).',
    );
    ok = false;
  }
  if (url === undefined) {
    problems.push(
      'The GitHub App is set, so TUSK_URL (the address GitHub sends people back to) is required.',
    );
    ok = false;
  }
  const privateKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not rsa');
  } catch {
    problems.push('TUSK_GITHUB_APP_PRIVATE_KEY is not an RSA private key in PEM form.');
    ok = false;
  }
  return ok ? { appId, slug, clientId, clientSecret, webhookSecret, privateKey } : undefined;
}

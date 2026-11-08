import { resolveAuth, type AuthSettings } from '../auth/config';
import { resolveGitHubApp, type GitHubAppSettings } from '../github-app/config';
import { resolveMail } from '../mail/config';
import type { MailSettings } from '../mail/mailer';
import { type KeyRing, parseKey, ringOf } from '../crypto/keys';
import { DatabaseConfigError, resolveDatabaseSettings, type DatabaseSettings } from '../db/config';
import { checkApiUrl, DEFAULT_API_URL } from '../providers/github/provider';
import { ProviderError } from '../providers/types';
import { readSetting, SettingFileError, type Env, type ReadFile } from './env';

/** What the app was told, once it has been checked. It grows as the tasks that read a setting are built. */
export interface Config {
  /** The address people use, with no path. Absent when the app is run with no sign-in, which only a development machine does. */
  readonly url: string | undefined;
  /** Whether this process runs the background jobs (DESIGN.md §5): off for all but one process when several share a database. */
  readonly worker: boolean;
  /** How people sign in, or `undefined` when no way is on: there is then no sign-in, and its addresses answer 404 (DESIGN.md §6). */
  readonly auth: AuthSettings | undefined;
  /** Which database, and how to wait for it and migrate it (DESIGN.md §22.1). */
  readonly database: DatabaseSettings;
  /** The instance key, and the one it replaces while credentials are moved to it; absent when there is none, and nothing that needs one is offered (DESIGN.md §21.2). */
  readonly encryption: KeyRing | undefined;
  /** Where GitHub's API is: `https://api.github.com`, or an Enterprise Server's. https, or http on this machine alone (DESIGN.md §21.5). */
  readonly githubApiUrl: string;
  /** `TUSK_DB_ENCRYPTION=on` (DESIGN.md §9.5): the server seals content with the instance key, and personal keys are not offered to anyone. */
  readonly operatorEncryption: boolean;
  /** The GitHub App, when the operator registered one (DESIGN.md §21.2); then a repository can be connected without a token. */
  readonly githubApp: GitHubAppSettings | undefined;
  /** Where mail goes, or `undefined`: then an address is not verified, a password is not reset by mail, and no screen or route offers either (DESIGN.md §6). */
  readonly mail: MailSettings | undefined;
  /** The keys Web Push is sent with (DESIGN.md §25.2), when the operator gave all three; then a device can be offered Push, and without them none is. */
  readonly push: PushSettings | undefined;
}

/** VAPID: the application server key pair and the address that identifies the operator to the push services. */
export interface PushSettings {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

/** One thing that is wrong, in words that name the setting and never its value. */
export type Problem = string;

export type LoadResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/**
 * Settings that only make sense together: all of them or none. A partial set stops the server at start-up, because the part that is missing
 * would otherwise be found at the moment a person needs it. `secret` marks the ones that may arrive as `NAME_FILE`.
 */
const GROUPS: readonly { readonly what: string; readonly names: readonly string[] }[] = [
  {
    what: 'Sovereign sign-in',
    names: ['TUSK_CORE_URL', 'TUSK_CORE_CLIENT_ID', 'TUSK_CORE_CLIENT_SECRET'],
  },
  {
    what: 'Web Push',
    names: ['TUSK_VAPID_PUBLIC_KEY', 'TUSK_VAPID_PRIVATE_KEY', 'TUSK_VAPID_SUBJECT'],
  },
  {
    what: 'the GitHub App',
    names: [
      'TUSK_GITHUB_APP_ID',
      'TUSK_GITHUB_APP_SLUG',
      'TUSK_GITHUB_APP_CLIENT_ID',
      'TUSK_GITHUB_APP_CLIENT_SECRET',
      'TUSK_GITHUB_APP_WEBHOOK_SECRET',
      'TUSK_GITHUB_APP_PRIVATE_KEY',
    ],
  },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** localhost, an address on this machine, or a name under `.localhost`: the only places plain http is allowed. */
function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

const KEY_HELP =
  'It is 32 random bytes, in base64, URL-safe base64 or hex (openssl rand -base64 32).';

/** The instance key and the previous one, as a ring, or what is wrong with them. */
function checkKeys(
  current: string | undefined,
  previous: string | undefined,
  problems: Problem[],
): KeyRing | undefined {
  const key = current === undefined ? undefined : parseKey(current);
  const old = previous === undefined ? undefined : parseKey(previous);
  if (current !== undefined && key === undefined)
    problems.push(`TUSK_ENCRYPTION_KEY is not a key. ${KEY_HELP}`);
  if (previous !== undefined && old === undefined)
    problems.push(`TUSK_ENCRYPTION_KEY_PREVIOUS is not a key. ${KEY_HELP}`);
  if (previous !== undefined && current === undefined)
    problems.push(
      'TUSK_ENCRYPTION_KEY_PREVIOUS is given, and there is no TUSK_ENCRYPTION_KEY to move the credentials to.',
    );
  if (key && old && key.equals(old))
    problems.push('TUSK_ENCRYPTION_KEY_PREVIOUS is the same key as TUSK_ENCRYPTION_KEY.');
  return ringOf(key, old);
}

/** Checks `TUSK_URL`. Returns the origin to keep, or says what is wrong. */
function checkUrl(value: string): { url: string } | { problem: Problem } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { problem: 'TUSK_URL is not an address. Give it as https://tusk.example.com.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { problem: 'TUSK_URL must be an http or https address.' };
  }
  if (parsed.protocol === 'http:' && !isLocalHost(parsed.hostname)) {
    return {
      problem:
        'TUSK_URL must be https, except on localhost: passkeys, emailed links and the sign-in redirect are made from it.',
    };
  }
  if (parsed.username || parsed.password) {
    return { problem: 'TUSK_URL must not carry a user name or password.' };
  }
  if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    return { problem: 'TUSK_URL is the address with no path, query or fragment.' };
  }
  return { url: parsed.origin };
}

/**
 * Reads and checks every setting the app has been told. It never throws and never reads the process: the environment and the way to read a
 * file are given, so a test can try every mistake. A message names a setting, and a value appears in none.
 */
export function loadConfig(env: Env, readFile?: ReadFile): LoadResult {
  const problems: Problem[] = [];

  // A setting that is a file may fail to be read; that is a problem of its own and not a crash.
  const read = (name: string): string | undefined => {
    try {
      return readSetting(env, name, readFile);
    } catch (error) {
      if (error instanceof SettingFileError) {
        problems.push(error.message);
        return undefined;
      }
      throw error;
    }
  };

  let url: string | undefined;
  const rawUrl = read('TUSK_URL');
  if (rawUrl !== undefined) {
    const checked = checkUrl(rawUrl);
    if ('problem' in checked) problems.push(checked.problem);
    else url = checked.url;
  }

  // Signing in: checked with the address, since links, cookies and passkeys are made from it.
  const auth = resolveAuth(read, url, problems);

  const rawWorker = read('TUSK_WORKER');
  if (rawWorker !== undefined && rawWorker !== 'on' && rawWorker !== 'off') {
    problems.push('TUSK_WORKER is on or off.');
  }

  for (const group of GROUPS) {
    const given = group.names.filter((name) => read(name) !== undefined);
    if (given.length > 0 && given.length < group.names.length) {
      const missing = group.names.filter((name) => !given.includes(name));
      problems.push(
        `${group.what} needs all of its settings or none, and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
      );
    }
  }

  // The instance key (DESIGN.md §9.2, §21.2). Optional until something is stored; a key that is given must be a key, and a message names the setting and
  // never what was given.
  const encryption = checkKeys(
    read('TUSK_ENCRYPTION_KEY'),
    read('TUSK_ENCRYPTION_KEY_PREVIOUS'),
    problems,
  );

  // The operator's own encryption (§9.5, task 14.7): the server seals content with the instance key, so the key is required, and there is no default.
  const rawOperator = read('TUSK_DB_ENCRYPTION');
  if (rawOperator !== undefined && rawOperator !== 'on' && rawOperator !== 'off') {
    problems.push('TUSK_DB_ENCRYPTION is on or off.');
  } else if (rawOperator === 'on' && !encryption) {
    problems.push(
      'TUSK_DB_ENCRYPTION=on needs TUSK_ENCRYPTION_KEY, the key content is sealed with. It is 32 random bytes, in base64, URL-safe base64 or hex (openssl rand -base64 32).',
    );
  }

  // The address of GitHub's API: an address that would send a token over plain http to another machine stops the server, naming the setting.
  let githubApiUrl = DEFAULT_API_URL;
  const rawGithubApi = read('TUSK_GITHUB_API_URL');
  if (rawGithubApi !== undefined) {
    try {
      githubApiUrl = checkApiUrl(rawGithubApi);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      problems.push(
        'TUSK_GITHUB_API_URL is an https address with no user, query or fragment (http only for localhost).',
      );
    }
  }

  // The GitHub App is optional, all of it or none; a key that is not a key stops the server here and not at the first person's try.
  const githubApp = resolveGitHubApp(read, url, problems);

  // Mail is optional, but a host with no sender would send nothing anyone could answer, so it stops here rather than at the first message.
  const mail = resolveMail(read, problems);

  // Web Push (DESIGN.md §25.2): the three together or none (the group check says which is missing); given, each must be what a push service accepts.
  let push: PushSettings | undefined;
  const vapid = [
    read('TUSK_VAPID_PUBLIC_KEY'),
    read('TUSK_VAPID_PRIVATE_KEY'),
    read('TUSK_VAPID_SUBJECT'),
  ];
  if (vapid.every((value) => value !== undefined)) {
    const [publicKey, privateKey, subject] = vapid as [string, string, string];
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey))
      problems.push(
        'TUSK_VAPID_PUBLIC_KEY is the public key of a VAPID pair, in URL-safe base64 (npx web-push generate-vapid-keys).',
      );
    else if (!/^[A-Za-z0-9_-]{40,50}$/.test(privateKey))
      problems.push(
        'TUSK_VAPID_PRIVATE_KEY is the private key of a VAPID pair, in URL-safe base64 (npx web-push generate-vapid-keys).',
      );
    else if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject))
      problems.push(
        'TUSK_VAPID_SUBJECT is a mailto: or https: address that identifies you to the push services.',
      );
    else if (!encryption)
      problems.push(
        'Web Push (TUSK_VAPID_*) needs TUSK_ENCRYPTION_KEY, which seals the keys each device gives (openssl rand -base64 32).',
      );
    else push = { publicKey, privateKey, subject };
  }

  // The database: which of the three forms, and the address it needs. A secret address may arrive as a file.
  let database: DatabaseSettings | undefined;
  try {
    database = resolveDatabaseSettings({
      ...env,
      TUSK_POSTGRES_URL: read('TUSK_POSTGRES_URL'),
      TUSK_POSTGRES_URL_FILE: undefined,
    });
  } catch (error) {
    if (error instanceof DatabaseConfigError) problems.push(error.message);
    else throw error;
  }

  if (problems.length > 0 || database === undefined) return { ok: false, problems };
  return {
    ok: true,
    config: {
      url,
      auth,
      worker: rawWorker !== 'off',
      database,
      encryption,
      githubApiUrl,
      operatorEncryption: rawOperator === 'on',
      mail,
      push,
      githubApp,
    },
  };
}

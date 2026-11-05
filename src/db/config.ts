import { readSetting, type Env, type ReadFile } from '../config/env';

/**
 * Which database Tasks runs on, read from the settings in one place (DESIGN.md §22.1). The names are Sovereign's (`contracts/env.md`), with
 * this app's prefix.
 *
 *   TASKS_DB_DIALECT          sqld (default), sqlite or postgres
 *   TASKS_SQLD_URL            an sqld service, http(s)://host:port (default http://sqld:8080)
 *   TASKS_SQLD_ADMIN_URL      its admin API, used to create the namespaces (default http://sqld:8081)
 *   TASKS_SQLITE_URL          file:/path/tasks.db, a database file (required with sqlite)
 *   TASKS_POSTGRES_URL[_FILE] postgres://... (required with postgres); a secret, since it can carry a password
 *   TASKS_POSTGRES_POOL_MAX   connections in the pool (default 10)
 *   PGSSLROOTCERT             CA file for sslmode=verify-ca / verify-full
 *   TASKS_DB_CONNECT_TIMEOUT_MS  how long to wait for a database that is still starting (default 30000)
 *   TASKS_MIGRATIONS_DIR      where the migrations are, if not `migrations/` beside the server
 *
 * Nothing infers the dialect from a URL: `TASKS_DB_DIALECT` says which, and a URL that does not fit it is an error, not a guess.
 */

/** The two logical databases: the app's tables and better-auth's. */
export const APP_STORE = 'tasks';
export const AUTH_STORE = 'tasks_auth';

/** Which of the two a handle is for. */
export type Store = 'app' | 'auth';

const DEFAULT_SQLD_URL = 'http://sqld:8080';
const DEFAULT_SQLD_ADMIN_URL = 'http://sqld:8081';
const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export type DatabaseConfig = SqldConfig | FileConfig | PostgresConfig;

/** SQLite through an sqld service: one namespace per store. */
export interface SqldConfig {
  dialect: 'sqlite';
  form: 'sqld';
  url: string;
  adminUrl: string;
}

/** SQLite in a plain file, with the auth store beside it as `tasks_auth.db`. */
export interface FileConfig {
  dialect: 'sqlite';
  form: 'file';
  /** The app database's file path. */
  path: string;
  /** The auth database's file path, in the same directory. */
  authPath: string;
}

/** PostgreSQL: one schema per store. */
export interface PostgresConfig {
  dialect: 'postgres';
  url: string;
  poolMax: number;
  /** Contents of the CA file named by PGSSLROOTCERT, read by the client. */
  sslRootCertPath?: string;
}

/** What starting the database needs to know beyond which one it is. */
export interface DatabaseSettings {
  database: DatabaseConfig;
  /** How long to wait for a database that is still starting, in milliseconds. */
  connectTimeoutMs: number;
  /** Where the migrations are, when it is not `migrations/` beside the server. */
  migrationsDir: string | undefined;
}

/** A setting that is wrong; the message names the variable and what it should be, and never its value where that could be a secret. */
export class DatabaseConfigError extends Error {
  override name = 'DatabaseConfigError';
}

export function resolveDatabaseSettings(env: Env, readFile?: ReadFile): DatabaseSettings {
  return {
    database: resolveDatabaseConfig(env, readFile),
    connectTimeoutMs: positiveInteger(env.TASKS_DB_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
    migrationsDir: (env.TASKS_MIGRATIONS_DIR ?? '').trim() || undefined,
  };
}

export function resolveDatabaseConfig(env: Env, readFile?: ReadFile): DatabaseConfig {
  const raw = env.TASKS_DB_DIALECT?.trim().toLowerCase();
  const dialect = raw === undefined || raw === '' ? 'sqld' : raw;

  if (dialect === 'postgres') return resolvePostgres(env, readFile);
  if (dialect === 'sqld') return resolveSqld(env);
  if (dialect === 'sqlite') return resolveFile(env);
  throw new DatabaseConfigError(
    `TASKS_DB_DIALECT must be "sqld", "sqlite" or "postgres" (got "${raw}").`,
  );
}

function resolveSqld(env: Env): SqldConfig {
  const url = (env.TASKS_SQLD_URL ?? '').trim() || DEFAULT_SQLD_URL;
  const parsed = parseUrl('TASKS_SQLD_URL', url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const hint =
      parsed.protocol === 'file:'
        ? '; a database file is TASKS_DB_DIALECT=sqlite with TASKS_SQLITE_URL'
        : '';
    throw new DatabaseConfigError(
      `TASKS_SQLD_URL must be http(s)://host:port for an sqld service (got "${parsed.protocol}//…")${hint}.`,
    );
  }
  const adminUrl = (env.TASKS_SQLD_ADMIN_URL ?? '').trim() || DEFAULT_SQLD_ADMIN_URL;
  const admin = parseUrl('TASKS_SQLD_ADMIN_URL', adminUrl);
  if (admin.protocol !== 'http:' && admin.protocol !== 'https:') {
    throw new DatabaseConfigError(
      `TASKS_SQLD_ADMIN_URL must be an http(s) URL (got "${admin.protocol}//…").`,
    );
  }
  return {
    dialect: 'sqlite',
    form: 'sqld',
    url: stripTrailingSlash(url),
    adminUrl: stripTrailingSlash(adminUrl),
  };
}

function resolveFile(env: Env): FileConfig {
  const url = (env.TASKS_SQLITE_URL ?? '').trim();
  if (url === '') {
    throw new DatabaseConfigError(
      'TASKS_DB_DIALECT=sqlite requires TASKS_SQLITE_URL, the database file (file:/data/tasks.db).',
    );
  }
  if (!url.startsWith('file:')) {
    throw new DatabaseConfigError(
      'TASKS_SQLITE_URL must be file:/path to a database file; an sqld service is TASKS_DB_DIALECT=sqld with TASKS_SQLD_URL.',
    );
  }
  // `file:/abs/path`, `file:///abs/path` and `file:relative/path` all name a path.
  let path = url.slice('file:'.length);
  if (path.startsWith('//')) path = path.slice(2);
  if (path === '' || path.startsWith(':memory:')) {
    throw new DatabaseConfigError(
      'TASKS_SQLITE_URL "file:" needs a path to a database file; an in-memory database is not allowed.',
    );
  }
  if (path.endsWith('/')) {
    throw new DatabaseConfigError(
      `TASKS_SQLITE_URL "${url}" names a directory; it must name the database file.`,
    );
  }
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash + 1);
  return { dialect: 'sqlite', form: 'file', path, authPath: `${directory}${AUTH_STORE}.db` };
}

function resolvePostgres(env: Env, readFile?: ReadFile): PostgresConfig {
  const url = (readSetting(env, 'TASKS_POSTGRES_URL', readFile) ?? '').trim();
  if (url === '') {
    throw new DatabaseConfigError(
      'TASKS_DB_DIALECT=postgres requires TASKS_POSTGRES_URL (or TASKS_POSTGRES_URL_FILE).',
    );
  }
  // Not the value in a message: it can carry a password.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseConfigError('TASKS_POSTGRES_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(
      `TASKS_POSTGRES_URL must be a postgres:// URL (got "${parsed.protocol}//…").`,
    );
  }
  const rootCert = (env.PGSSLROOTCERT ?? '').trim();
  return {
    dialect: 'postgres',
    url,
    poolMax: positiveInteger(env.TASKS_POSTGRES_POOL_MAX, DEFAULT_POOL_MAX),
    ...(rootCert === '' ? {} : { sslRootCertPath: rootCert }),
  };
}

/** A bad or missing value falls back to the default rather than trusting it. */
function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseUrl(variable: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new DatabaseConfigError(`${variable} is not a valid URL.`);
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** What is safe to print about a configuration: no password, no token. */
export function describeConfig(config: DatabaseConfig): string {
  if (config.dialect === 'postgres') {
    const url = new URL(config.url);
    return `postgres ${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  }
  return config.form === 'sqld'
    ? `sqlite via sqld at ${new URL(config.url).origin}`
    : `sqlite file ${config.path}`;
}

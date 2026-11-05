import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigError,
  describeConfig,
  resolveDatabaseConfig,
  resolveDatabaseSettings,
} from './config';

const noFile = (): string => {
  throw new Error('no file');
};

describe('resolveDatabaseConfig', () => {
  it('defaults to SQLite through an sqld service', () => {
    expect(resolveDatabaseConfig({})).toEqual({
      dialect: 'sqlite',
      form: 'sqld',
      url: 'http://sqld:8080',
      adminUrl: 'http://sqld:8081',
    });
  });

  it('treats an empty TASKS_DB_DIALECT as unset, and ignores case and spaces', () => {
    expect(resolveDatabaseConfig({ TASKS_DB_DIALECT: '' })).toMatchObject({
      dialect: 'sqlite',
      form: 'sqld',
    });
    expect(resolveDatabaseConfig({ TASKS_DB_DIALECT: ' SQLD ' })).toMatchObject({
      dialect: 'sqlite',
      form: 'sqld',
    });
  });

  it('reads an sqld URL and its admin URL, without a trailing slash', () => {
    expect(
      resolveDatabaseConfig({
        TASKS_DB_DIALECT: 'sqld',
        TASKS_SQLD_URL: 'http://localhost:28080/',
        TASKS_SQLD_ADMIN_URL: 'http://localhost:28081/',
      }),
    ).toEqual({
      dialect: 'sqlite',
      form: 'sqld',
      url: 'http://localhost:28080',
      adminUrl: 'http://localhost:28081',
    });
  });

  it.each([
    ['file:/data/tasks.db', '/data/tasks.db', '/data/tasks_auth.db'],
    ['file:///data/tasks.db', '/data/tasks.db', '/data/tasks_auth.db'],
    ['file:./data/tasks.db', './data/tasks.db', './data/tasks_auth.db'],
    ['file:tasks.db', 'tasks.db', 'tasks_auth.db'],
  ])(
    'reads the file %s with TASKS_DB_DIALECT=sqlite, and puts the auth database beside it',
    (url, path, authPath) => {
      expect(resolveDatabaseConfig({ TASKS_DB_DIALECT: 'sqlite', TASKS_SQLITE_URL: url })).toEqual({
        dialect: 'sqlite',
        form: 'file',
        path,
        authPath,
      });
    },
  );

  it.each(['file:', 'file:///', 'file::memory:', 'file:/data/'])(
    'refuses the file URL %s',
    (url) => {
      expect(() =>
        resolveDatabaseConfig({ TASKS_DB_DIALECT: 'sqlite', TASKS_SQLITE_URL: url }),
      ).toThrow(DatabaseConfigError);
    },
  );

  it('requires a file for sqlite, and refuses an address there', () => {
    expect(() => resolveDatabaseConfig({ TASKS_DB_DIALECT: 'sqlite' })).toThrow(
      /requires TASKS_SQLITE_URL/,
    );
    expect(() =>
      resolveDatabaseConfig({ TASKS_DB_DIALECT: 'sqlite', TASKS_SQLITE_URL: 'http://sqld:8080' }),
    ).toThrow(/TASKS_DB_DIALECT=sqld/);
  });

  it('refuses an sqld URL that is not http(s), and says where a file goes', () => {
    expect(() => resolveDatabaseConfig({ TASKS_SQLD_URL: 'libsql://example.turso.io' })).toThrow(
      /TASKS_SQLD_URL/,
    );
    expect(() => resolveDatabaseConfig({ TASKS_SQLD_URL: 'file:/data/tasks.db' })).toThrow(
      /TASKS_SQLITE_URL/,
    );
    expect(() => resolveDatabaseConfig({ TASKS_SQLD_URL: 'not a url' })).toThrow(
      /TASKS_SQLD_URL is not a valid URL/,
    );
  });

  it('refuses an admin URL that is not http(s)', () => {
    expect(() => resolveDatabaseConfig({ TASKS_SQLD_ADMIN_URL: 'ftp://sqld:8081' })).toThrow(
      /TASKS_SQLD_ADMIN_URL/,
    );
  });

  it('reads PostgreSQL, with a default pool size', () => {
    expect(
      resolveDatabaseConfig({
        TASKS_DB_DIALECT: 'postgres',
        TASKS_POSTGRES_URL: 'postgres://u:p@db:5432/tasks',
      }),
    ).toEqual({
      dialect: 'postgres',
      url: 'postgres://u:p@db:5432/tasks',
      poolMax: 10,
    });
  });

  it('reads the PostgreSQL address from a file, as an instance gives a secret', () => {
    const config = resolveDatabaseConfig(
      { TASKS_DB_DIALECT: 'postgres', TASKS_POSTGRES_URL_FILE: '/run/secrets/db' },
      (path) => (path === '/run/secrets/db' ? 'postgres://u:p@db:5432/tasks\n' : noFile()),
    );
    expect(config).toMatchObject({ dialect: 'postgres', url: 'postgres://u:p@db:5432/tasks' });
  });

  it('prefers the file when the PostgreSQL address is given both ways, as for every secret', () => {
    const config = resolveDatabaseConfig(
      {
        TASKS_DB_DIALECT: 'postgres',
        TASKS_POSTGRES_URL: 'postgres://plain/tasks',
        TASKS_POSTGRES_URL_FILE: '/x',
      },
      () => 'postgres://from-file/tasks',
    );
    expect(config).toMatchObject({ url: 'postgres://from-file/tasks' });
  });

  it('requires TASKS_POSTGRES_URL for PostgreSQL, and it must be a postgres URL, without repeating it', () => {
    expect(() => resolveDatabaseConfig({ TASKS_DB_DIALECT: 'postgres' })).toThrow(
      /TASKS_POSTGRES_URL/,
    );
    expect(() =>
      resolveDatabaseConfig({ TASKS_DB_DIALECT: 'postgres', TASKS_POSTGRES_URL: 'http://db' }),
    ).toThrow(/postgres:\/\//);
    const bad = () =>
      resolveDatabaseConfig({
        TASKS_DB_DIALECT: 'postgres',
        TASKS_POSTGRES_URL: 'hunter2 is not a url',
      });
    expect(bad).toThrow(/TASKS_POSTGRES_URL is not a valid URL/);
    expect(bad).not.toThrow(/hunter2/);
  });

  it('does not infer the dialect from a URL', () => {
    // A PostgreSQL URL with the default dialect is a mistake to report, not a hint.
    const config = resolveDatabaseConfig({ TASKS_POSTGRES_URL: 'postgres://u:p@db/tasks' });
    expect(config).toMatchObject({ dialect: 'sqlite', form: 'sqld' });
  });

  it('refuses an unknown dialect', () => {
    expect(() => resolveDatabaseConfig({ TASKS_DB_DIALECT: 'mysql' })).toThrow(
      /TASKS_DB_DIALECT must be "sqld", "sqlite" or "postgres"/,
    );
  });

  it('takes the pool size and CA file for PostgreSQL, and ignores a bad pool size', () => {
    const base = { TASKS_DB_DIALECT: 'postgres', TASKS_POSTGRES_URL: 'postgres://u:p@db/tasks' };
    expect(
      resolveDatabaseConfig({ ...base, TASKS_POSTGRES_POOL_MAX: '12', PGSSLROOTCERT: '/ca.pem' }),
    ).toMatchObject({
      poolMax: 12,
      sslRootCertPath: '/ca.pem',
    });
    for (const bad of ['0', '-3', 'many', '2.5', '']) {
      expect(resolveDatabaseConfig({ ...base, TASKS_POSTGRES_POOL_MAX: bad })).toMatchObject({
        poolMax: 10,
      });
    }
  });
});

describe('resolveDatabaseSettings', () => {
  it('waits 30 seconds for a database that is starting, and has no migrations folder of its own, unless told', () => {
    expect(resolveDatabaseSettings({})).toMatchObject({
      connectTimeoutMs: 30_000,
      migrationsDir: undefined,
    });
    expect(
      resolveDatabaseSettings({
        TASKS_DB_CONNECT_TIMEOUT_MS: '5000',
        TASKS_MIGRATIONS_DIR: ' /app/migrations ',
      }),
    ).toMatchObject({ connectTimeoutMs: 5000, migrationsDir: '/app/migrations' });
  });

  it('ignores a bad timeout rather than trusting it', () => {
    for (const bad of ['0', '-1', 'soon', '']) {
      expect(resolveDatabaseSettings({ TASKS_DB_CONNECT_TIMEOUT_MS: bad })).toMatchObject({
        connectTimeoutMs: 30_000,
      });
    }
  });
});

describe('describeConfig', () => {
  it('never prints a password', () => {
    const text = describeConfig(
      resolveDatabaseConfig({
        TASKS_DB_DIALECT: 'postgres',
        TASKS_POSTGRES_URL: 'postgres://tasks:hunter2@db:5432/app',
      }),
    );
    expect(text).toBe('postgres db:5432/app');
    expect(text).not.toContain('hunter2');
  });

  it('describes the SQLite forms', () => {
    expect(describeConfig(resolveDatabaseConfig({}))).toBe('sqlite via sqld at http://sqld:8080');
    expect(
      describeConfig(
        resolveDatabaseConfig({ TASKS_DB_DIALECT: 'sqlite', TASKS_SQLITE_URL: 'file:/d/f.db' }),
      ),
    ).toBe('sqlite file /d/f.db');
  });
});

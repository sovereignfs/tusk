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

  it('treats an empty TUSK_DB_DIALECT as unset, and ignores case and spaces', () => {
    expect(resolveDatabaseConfig({ TUSK_DB_DIALECT: '' })).toMatchObject({
      dialect: 'sqlite',
      form: 'sqld',
    });
    expect(resolveDatabaseConfig({ TUSK_DB_DIALECT: ' SQLD ' })).toMatchObject({
      dialect: 'sqlite',
      form: 'sqld',
    });
  });

  it('reads an sqld URL and its admin URL, without a trailing slash', () => {
    expect(
      resolveDatabaseConfig({
        TUSK_DB_DIALECT: 'sqld',
        TUSK_SQLD_URL: 'http://localhost:28080/',
        TUSK_SQLD_ADMIN_URL: 'http://localhost:28081/',
      }),
    ).toEqual({
      dialect: 'sqlite',
      form: 'sqld',
      url: 'http://localhost:28080',
      adminUrl: 'http://localhost:28081',
    });
  });

  it.each([
    ['file:/data/tusk.db', '/data/tusk.db', '/data/tusk_auth.db'],
    ['file:///data/tusk.db', '/data/tusk.db', '/data/tusk_auth.db'],
    ['file:./data/tusk.db', './data/tusk.db', './data/tusk_auth.db'],
    ['file:tusk.db', 'tusk.db', 'tusk_auth.db'],
  ])(
    'reads the file %s with TUSK_DB_DIALECT=sqlite, and puts the auth database beside it',
    (url, path, authPath) => {
      expect(resolveDatabaseConfig({ TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: url })).toEqual({
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
        resolveDatabaseConfig({ TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: url }),
      ).toThrow(DatabaseConfigError);
    },
  );

  it('requires a file for sqlite, and refuses an address there', () => {
    expect(() => resolveDatabaseConfig({ TUSK_DB_DIALECT: 'sqlite' })).toThrow(
      /requires TUSK_SQLITE_URL/,
    );
    expect(() =>
      resolveDatabaseConfig({ TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: 'http://sqld:8080' }),
    ).toThrow(/TUSK_DB_DIALECT=sqld/);
  });

  it('refuses an sqld URL that is not http(s), and says where a file goes', () => {
    expect(() => resolveDatabaseConfig({ TUSK_SQLD_URL: 'libsql://example.turso.io' })).toThrow(
      /TUSK_SQLD_URL/,
    );
    expect(() => resolveDatabaseConfig({ TUSK_SQLD_URL: 'file:/data/tusk.db' })).toThrow(
      /TUSK_SQLITE_URL/,
    );
    expect(() => resolveDatabaseConfig({ TUSK_SQLD_URL: 'not a url' })).toThrow(
      /TUSK_SQLD_URL is not a valid URL/,
    );
  });

  it('refuses an admin URL that is not http(s)', () => {
    expect(() => resolveDatabaseConfig({ TUSK_SQLD_ADMIN_URL: 'ftp://sqld:8081' })).toThrow(
      /TUSK_SQLD_ADMIN_URL/,
    );
  });

  it('reads PostgreSQL, with a default pool size', () => {
    expect(
      resolveDatabaseConfig({
        TUSK_DB_DIALECT: 'postgres',
        TUSK_POSTGRES_URL: 'postgres://u:p@db:5432/tusk',
      }),
    ).toEqual({
      dialect: 'postgres',
      url: 'postgres://u:p@db:5432/tusk',
      poolMax: 10,
    });
  });

  it('reads the PostgreSQL address from a file, as an instance gives a secret', () => {
    const config = resolveDatabaseConfig(
      { TUSK_DB_DIALECT: 'postgres', TUSK_POSTGRES_URL_FILE: '/run/secrets/db' },
      (path) => (path === '/run/secrets/db' ? 'postgres://u:p@db:5432/tusk\n' : noFile()),
    );
    expect(config).toMatchObject({ dialect: 'postgres', url: 'postgres://u:p@db:5432/tusk' });
  });

  it('refuses the PostgreSQL address given both ways, as for every secret', () => {
    expect(() =>
      resolveDatabaseConfig(
        {
          TUSK_DB_DIALECT: 'postgres',
          TUSK_POSTGRES_URL: 'postgres://plain/tasks',
          TUSK_POSTGRES_URL_FILE: '/x',
        },
        () => 'postgres://from-file/tasks',
      ),
    ).toThrow(/TUSK_POSTGRES_URL is set together with TUSK_POSTGRES_URL_FILE/);
  });

  it('requires TUSK_POSTGRES_URL for PostgreSQL, and it must be a postgres URL, without repeating it', () => {
    expect(() => resolveDatabaseConfig({ TUSK_DB_DIALECT: 'postgres' })).toThrow(
      /TUSK_POSTGRES_URL/,
    );
    expect(() =>
      resolveDatabaseConfig({ TUSK_DB_DIALECT: 'postgres', TUSK_POSTGRES_URL: 'http://db' }),
    ).toThrow(/postgres:\/\//);
    const bad = () =>
      resolveDatabaseConfig({
        TUSK_DB_DIALECT: 'postgres',
        TUSK_POSTGRES_URL: 'hunter2 is not a url',
      });
    expect(bad).toThrow(/TUSK_POSTGRES_URL is not a valid URL/);
    expect(bad).not.toThrow(/hunter2/);
  });

  it('does not infer the dialect from a URL', () => {
    // A PostgreSQL URL with the default dialect is a mistake to report, not a hint.
    const config = resolveDatabaseConfig({ TUSK_POSTGRES_URL: 'postgres://u:p@db/tasks' });
    expect(config).toMatchObject({ dialect: 'sqlite', form: 'sqld' });
  });

  it('refuses an unknown dialect', () => {
    expect(() => resolveDatabaseConfig({ TUSK_DB_DIALECT: 'mysql' })).toThrow(
      /TUSK_DB_DIALECT must be "sqld", "sqlite" or "postgres"/,
    );
  });

  it('takes the pool size and CA file for PostgreSQL, and ignores a bad pool size', () => {
    const base = { TUSK_DB_DIALECT: 'postgres', TUSK_POSTGRES_URL: 'postgres://u:p@db/tasks' };
    expect(
      resolveDatabaseConfig({ ...base, TUSK_POSTGRES_POOL_MAX: '12', PGSSLROOTCERT: '/ca.pem' }),
    ).toMatchObject({
      poolMax: 12,
      sslRootCertPath: '/ca.pem',
    });
    for (const bad of ['0', '-3', 'many', '2.5', '']) {
      expect(resolveDatabaseConfig({ ...base, TUSK_POSTGRES_POOL_MAX: bad })).toMatchObject({
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
        TUSK_DB_CONNECT_TIMEOUT_MS: '5000',
        TUSK_MIGRATIONS_DIR: ' /app/migrations ',
      }),
    ).toMatchObject({ connectTimeoutMs: 5000, migrationsDir: '/app/migrations' });
  });

  it('ignores a bad timeout rather than trusting it', () => {
    for (const bad of ['0', '-1', 'soon', '']) {
      expect(resolveDatabaseSettings({ TUSK_DB_CONNECT_TIMEOUT_MS: bad })).toMatchObject({
        connectTimeoutMs: 30_000,
      });
    }
  });
});

describe('describeConfig', () => {
  it('never prints a password', () => {
    const text = describeConfig(
      resolveDatabaseConfig({
        TUSK_DB_DIALECT: 'postgres',
        TUSK_POSTGRES_URL: 'postgres://tusk:hunter2@db:5432/app',
      }),
    );
    expect(text).toBe('postgres db:5432/app');
    expect(text).not.toContain('hunter2');
  });

  it('describes the SQLite forms', () => {
    expect(describeConfig(resolveDatabaseConfig({}))).toBe('sqlite via sqld at http://sqld:8080');
    expect(
      describeConfig(
        resolveDatabaseConfig({ TUSK_DB_DIALECT: 'sqlite', TUSK_SQLITE_URL: 'file:/d/f.db' }),
      ),
    ).toBe('sqlite file /d/f.db');
  });
});

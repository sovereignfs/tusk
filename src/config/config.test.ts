import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from './index';
import { readSetting, SettingFileError } from './env';

/** The problems of a bad environment, which every test below wants to read and none expects to be empty. */
function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

describe('loadConfig', () => {
  it('accepts no settings at all, and the database is then an sqld service at its default address', () => {
    const result = loadConfig({});
    expect(result).toMatchObject({
      ok: true,
      config: { url: undefined, worker: true, database: { database: { form: 'sqld' } } },
    });
  });

  it('reports a wrong database setting with the others, naming it', () => {
    const [problem] = problems(loadConfig({ TUSK_DB_DIALECT: 'mysql' }));
    expect(problem).toContain('TUSK_DB_DIALECT');
  });

  it('reads the PostgreSQL address from a file, and keeps it out of what it reports', () => {
    const result = loadConfig(
      { TUSK_DB_DIALECT: 'postgres', TUSK_POSTGRES_URL_FILE: '/run/db' },
      () => 'postgres://u:hunter2@db:5432/tusk\n',
    );
    expect(result).toMatchObject({ ok: true });
    const bad = problems(
      loadConfig(
        { TUSK_DB_DIALECT: 'postgres', TUSK_POSTGRES_URL_FILE: '/run/db' },
        () => 'hunter2 is not a url',
      ),
    );
    expect(bad.join(' ')).not.toContain('hunter2');
  });

  describe('TUSK_URL', () => {
    it('keeps the origin of an https address', () => {
      expect(loadConfig({ TUSK_URL: 'https://tusk.example.com/' })).toMatchObject({
        ok: true,
        config: { url: 'https://tusk.example.com' },
      });
    });

    it.each([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://x.localhost',
    ])('allows plain http on this machine: %s', (url) => {
      expect(loadConfig({ TUSK_URL: url }).ok).toBe(true);
    });

    it('refuses plain http anywhere else, naming the setting and not the value', () => {
      const [problem] = problems(loadConfig({ TUSK_URL: 'http://tusk.example.com' }));
      expect(problem).toContain('TUSK_URL');
      expect(problem).not.toContain('tusk.example.com');
    });

    it.each([
      ['not an address', 'not-an-address-value'],
      ['another scheme', 'ftp://tusk.example.com'],
      ['a path', 'https://tusk.example.com/app'],
      ['a query', 'https://tusk.example.com/?a=1'],
      ['a user name', 'https://me:secret@tusk.example.com'],
    ])('refuses %s, and never prints it', (_what, url) => {
      const result = problems(loadConfig({ TUSK_URL: url }));
      expect(result.join(' ')).toContain('TUSK_URL');
      expect(result.join(' ')).not.toContain('secret');
      expect(result.join(' ')).not.toContain(url);
    });
  });

  describe('TUSK_WORKER', () => {
    it('is on unless it says off', () => {
      expect(loadConfig({ TUSK_WORKER: 'off' })).toMatchObject({ config: { worker: false } });
      expect(loadConfig({ TUSK_WORKER: 'on' })).toMatchObject({ config: { worker: true } });
    });

    it('refuses anything else', () => {
      expect(problems(loadConfig({ TUSK_WORKER: 'yes' }))[0]).toContain('TUSK_WORKER');
    });
  });

  describe('settings that go together', () => {
    it.each([
      ['TUSK_CORE_URL', 'Sovereign sign-in'],
      ['TUSK_CORE_CLIENT_ID', 'Sovereign sign-in'],
      ['TUSK_VAPID_PUBLIC_KEY', 'Web Push'],
      ['TUSK_GITHUB_APP_ID', 'the GitHub App'],
    ])('stops on %s given alone', (name, what) => {
      const [problem] = problems(loadConfig({ [name]: 'value-that-must-not-appear' }));
      expect(problem).toContain(what);
      expect(problem).not.toContain('value-that-must-not-appear');
    });

    it('names what is missing', () => {
      const [problem] = problems(
        loadConfig({ TUSK_CORE_URL: 'https://core.example.com', TUSK_CORE_CLIENT_ID: 'a' }),
      );
      expect(problem).toContain('TUSK_CORE_CLIENT_SECRET is missing');
    });

    it('accepts all of a group', () => {
      expect(
        loadConfig({
          TUSK_CORE_URL: 'https://core.example.com',
          TUSK_CORE_CLIENT_ID: 'a',
          TUSK_CORE_CLIENT_SECRET: 'b',
        }).ok,
      ).toBe(true);
    });

    it('counts a secret given as a file as given', () => {
      const files: Record<string, string> = { '/run/secret': 's3cret\n' };
      const result = loadConfig(
        {
          TUSK_CORE_URL: 'https://core.example.com',
          TUSK_CORE_CLIENT_ID: 'a',
          TUSK_CORE_CLIENT_SECRET_FILE: '/run/secret',
        },
        (path) => files[path] ?? '',
      );
      expect(result.ok).toBe(true);
    });

    it('stops on an SMTP host with no sender', () => {
      expect(problems(loadConfig({ TUSK_SMTP_HOST: 'smtp.example.com' }))[0]).toContain(
        'TUSK_SMTP_FROM',
      );
      expect(
        loadConfig({ TUSK_SMTP_HOST: 'smtp.example.com', TUSK_SMTP_FROM: 'Tasks <a@b.c>' }).ok,
      ).toBe(true);
    });
  });

  it('reports every problem at once, so that one run fixes them all', () => {
    const result = problems(
      loadConfig({ TUSK_URL: 'tusk', TUSK_WORKER: 'x', TUSK_VAPID_PUBLIC_KEY: 'k' }),
    );
    expect(result).toHaveLength(3);
  });

  it('turns an unreadable secret file into a problem that names the variable and not the path', () => {
    const result = problems(
      loadConfig({ TUSK_CORE_URL_FILE: '/run/secrets/nowhere' }, () => {
        throw new Error('ENOENT /run/secrets/nowhere');
      }),
    );
    expect(result.join(' ')).toContain('TUSK_CORE_URL_FILE');
    expect(result.join(' ')).not.toContain('/run/secrets/nowhere');
  });
});

describe('readSetting', () => {
  it('reads the plain name', () => {
    expect(readSetting({ TUSK_URL: 'a' }, 'TUSK_URL')).toBe('a');
  });

  it('treats an empty value as no value', () => {
    expect(readSetting({ TUSK_URL: '' }, 'TUSK_URL')).toBeUndefined();
    expect(readSetting({}, 'TUSK_URL')).toBeUndefined();
  });

  it('prefers the file, and drops one trailing line break and no more', () => {
    const value = readSetting(
      { TUSK_X: 'plain', TUSK_X_FILE: '/f' },
      'TUSK_X',
      () => ' spaced \n\n',
    );
    expect(value).toBe(' spaced \n');
  });

  it('throws an error that names the variable, never the path or the cause', () => {
    try {
      readSetting({ TUSK_X_FILE: '/secret/path' }, 'TUSK_X', () => {
        throw new Error('boom /secret/path');
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SettingFileError);
      expect((error as Error).message).toBe('TUSK_X_FILE names a file that cannot be read.');
    }
  });
});

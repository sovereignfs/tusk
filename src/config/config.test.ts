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
    const [problem] = problems(loadConfig({ TASKS_DB_DIALECT: 'mysql' }));
    expect(problem).toContain('TASKS_DB_DIALECT');
  });

  it('reads the PostgreSQL address from a file, and keeps it out of what it reports', () => {
    const result = loadConfig(
      { TASKS_DB_DIALECT: 'postgres', TASKS_POSTGRES_URL_FILE: '/run/db' },
      () => 'postgres://u:hunter2@db:5432/tasks\n',
    );
    expect(result).toMatchObject({ ok: true });
    const bad = problems(
      loadConfig(
        { TASKS_DB_DIALECT: 'postgres', TASKS_POSTGRES_URL_FILE: '/run/db' },
        () => 'hunter2 is not a url',
      ),
    );
    expect(bad.join(' ')).not.toContain('hunter2');
  });

  describe('TASKS_URL', () => {
    it('keeps the origin of an https address', () => {
      expect(loadConfig({ TASKS_URL: 'https://tasks.example.com/' })).toMatchObject({
        ok: true,
        config: { url: 'https://tasks.example.com' },
      });
    });

    it.each([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://x.localhost',
    ])('allows plain http on this machine: %s', (url) => {
      expect(loadConfig({ TASKS_URL: url }).ok).toBe(true);
    });

    it('refuses plain http anywhere else, naming the setting and not the value', () => {
      const [problem] = problems(loadConfig({ TASKS_URL: 'http://tasks.example.com' }));
      expect(problem).toContain('TASKS_URL');
      expect(problem).not.toContain('tasks.example.com');
    });

    it.each([
      ['not an address', 'not-an-address-value'],
      ['another scheme', 'ftp://tasks.example.com'],
      ['a path', 'https://tasks.example.com/app'],
      ['a query', 'https://tasks.example.com/?a=1'],
      ['a user name', 'https://me:secret@tasks.example.com'],
    ])('refuses %s, and never prints it', (_what, url) => {
      const result = problems(loadConfig({ TASKS_URL: url }));
      expect(result.join(' ')).toContain('TASKS_URL');
      expect(result.join(' ')).not.toContain('secret');
      expect(result.join(' ')).not.toContain(url);
    });
  });

  describe('TASKS_WORKER', () => {
    it('is on unless it says off', () => {
      expect(loadConfig({ TASKS_WORKER: 'off' })).toMatchObject({ config: { worker: false } });
      expect(loadConfig({ TASKS_WORKER: 'on' })).toMatchObject({ config: { worker: true } });
    });

    it('refuses anything else', () => {
      expect(problems(loadConfig({ TASKS_WORKER: 'yes' }))[0]).toContain('TASKS_WORKER');
    });
  });

  describe('settings that go together', () => {
    it.each([
      ['TASKS_CORE_URL', 'Sovereign sign-in'],
      ['TASKS_CORE_CLIENT_ID', 'Sovereign sign-in'],
      ['TASKS_VAPID_PUBLIC_KEY', 'Web Push'],
      ['TASKS_GITHUB_APP_ID', 'the GitHub App'],
    ])('stops on %s given alone', (name, what) => {
      const [problem] = problems(loadConfig({ [name]: 'value-that-must-not-appear' }));
      expect(problem).toContain(what);
      expect(problem).not.toContain('value-that-must-not-appear');
    });

    it('names what is missing', () => {
      const [problem] = problems(
        loadConfig({ TASKS_CORE_URL: 'https://core.example.com', TASKS_CORE_CLIENT_ID: 'a' }),
      );
      expect(problem).toContain('TASKS_CORE_CLIENT_SECRET is missing');
    });

    it('accepts all of a group', () => {
      expect(
        loadConfig({
          TASKS_CORE_URL: 'https://core.example.com',
          TASKS_CORE_CLIENT_ID: 'a',
          TASKS_CORE_CLIENT_SECRET: 'b',
        }).ok,
      ).toBe(true);
    });

    it('counts a secret given as a file as given', () => {
      const files: Record<string, string> = { '/run/secret': 's3cret\n' };
      const result = loadConfig(
        {
          TASKS_CORE_URL: 'https://core.example.com',
          TASKS_CORE_CLIENT_ID: 'a',
          TASKS_CORE_CLIENT_SECRET_FILE: '/run/secret',
        },
        (path) => files[path] ?? '',
      );
      expect(result.ok).toBe(true);
    });

    it('stops on an SMTP host with no sender', () => {
      expect(problems(loadConfig({ TASKS_SMTP_HOST: 'smtp.example.com' }))[0]).toContain(
        'TASKS_SMTP_FROM',
      );
      expect(
        loadConfig({ TASKS_SMTP_HOST: 'smtp.example.com', TASKS_SMTP_FROM: 'Tasks <a@b.c>' }).ok,
      ).toBe(true);
    });
  });

  it('reports every problem at once, so that one run fixes them all', () => {
    const result = problems(
      loadConfig({ TASKS_URL: 'tasks', TASKS_WORKER: 'x', TASKS_VAPID_PUBLIC_KEY: 'k' }),
    );
    expect(result).toHaveLength(3);
  });

  it('turns an unreadable secret file into a problem that names the variable and not the path', () => {
    const result = problems(
      loadConfig({ TASKS_CORE_URL_FILE: '/run/secrets/nowhere' }, () => {
        throw new Error('ENOENT /run/secrets/nowhere');
      }),
    );
    expect(result.join(' ')).toContain('TASKS_CORE_URL_FILE');
    expect(result.join(' ')).not.toContain('/run/secrets/nowhere');
  });
});

describe('readSetting', () => {
  it('reads the plain name', () => {
    expect(readSetting({ TASKS_URL: 'a' }, 'TASKS_URL')).toBe('a');
  });

  it('treats an empty value as no value', () => {
    expect(readSetting({ TASKS_URL: '' }, 'TASKS_URL')).toBeUndefined();
    expect(readSetting({}, 'TASKS_URL')).toBeUndefined();
  });

  it('prefers the file, and drops one trailing line break and no more', () => {
    const value = readSetting(
      { TASKS_X: 'plain', TASKS_X_FILE: '/f' },
      'TASKS_X',
      () => ' spaced \n\n',
    );
    expect(value).toBe(' spaced \n');
  });

  it('throws an error that names the variable, never the path or the cause', () => {
    try {
      readSetting({ TASKS_X_FILE: '/secret/path' }, 'TASKS_X', () => {
        throw new Error('boom /secret/path');
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SettingFileError);
      expect((error as Error).message).toBe('TASKS_X_FILE names a file that cannot be read.');
    }
  });
});

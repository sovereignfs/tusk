import { describe, expect, it } from 'vitest';
import { loadConfig, type LoadResult } from '../config';

const SECRET = 'a-secret-that-is-at-least-thirty-two-characters-long';
const ON = {
  TUSK_URL: 'https://tusk.example.com',
  TUSK_AUTH_LOCAL: '1',
  TUSK_AUTH_SECRET: SECRET,
};

function problems(result: LoadResult): readonly string[] {
  if (result.ok) throw new Error('the settings were accepted');
  return result.problems;
}

function authOf(result: LoadResult) {
  if (!result.ok) throw new Error(result.problems.join(' '));
  return result.config.auth;
}

describe('sign-in settings', () => {
  it('are off when local sign-in is not asked for, and then nothing else of them is read', () => {
    expect(authOf(loadConfig({}))).toBeUndefined();
    expect(authOf(loadConfig({ TUSK_AUTH_LOCAL: '0', TUSK_AUTH_SECRET: 'short' }))).toBeUndefined();
    expect(authOf(loadConfig({ TUSK_AUTH_LOCAL: 'false' }))).toBeUndefined();
  });

  it('are on with an address and a secret, and sign-up is closed unless it is said to be open', () => {
    expect(authOf(loadConfig(ON))).toEqual({
      url: 'https://tusk.example.com',
      secret: SECRET,
      signUp: 'closed',
      passwordMinLength: 10,
    });
    expect(
      authOf(loadConfig({ ...ON, TUSK_AUTH_LOCAL: 'true', TUSK_AUTH_SIGNUP: 'OPEN' })),
    ).toMatchObject({
      signUp: 'open',
    });
    expect(authOf(loadConfig({ ...ON, TUSK_AUTH_PASSWORD_MIN_LENGTH: '14' }))).toMatchObject({
      passwordMinLength: 14,
    });
  });

  it('read the secret from a file, and keep it out of what they report', () => {
    const result = loadConfig(
      { ...ON, TUSK_AUTH_SECRET: undefined, TUSK_AUTH_SECRET_FILE: '/run/secret' },
      () => `${SECRET}\n`,
    );
    expect(authOf(result)).toMatchObject({ secret: SECRET });
    const short = problems(loadConfig({ ...ON, TUSK_AUTH_SECRET: 'hunter2' })).join(' ');
    expect(short).toContain('TUSK_AUTH_SECRET');
    expect(short).not.toContain('hunter2');
  });

  it('stop the server when a way is on and a thing it needs is missing or wrong', () => {
    expect(problems(loadConfig({ ...ON, TUSK_AUTH_SECRET: undefined })).join(' ')).toContain(
      'TUSK_AUTH_SECRET',
    );
    expect(problems(loadConfig({ ...ON, TUSK_URL: undefined })).join(' ')).toContain('TUSK_URL');
    expect(problems(loadConfig({ ...ON, TUSK_AUTH_SIGNUP: 'anyone' })).join(' ')).toContain(
      'TUSK_AUTH_SIGNUP',
    );
    expect(problems(loadConfig({ ...ON, TUSK_AUTH_LOCAL: 'yes' })).join(' ')).toContain(
      'TUSK_AUTH_LOCAL',
    );
    for (const bad of ['3', '1000', 'ten'])
      expect(
        problems(loadConfig({ ...ON, TUSK_AUTH_PASSWORD_MIN_LENGTH: bad })).join(' '),
      ).toContain('TUSK_AUTH_PASSWORD_MIN_LENGTH');
  });

  it('say about a wrong address only once: the address check already reported it', () => {
    const reported = problems(loadConfig({ ...ON, TUSK_URL: 'http://tusk.example.com' }));
    expect(reported.filter((problem) => problem.includes('TUSK_URL'))).toHaveLength(1);
  });
});

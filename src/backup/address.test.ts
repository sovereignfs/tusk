import { describe, expect, it } from 'vitest';
import { parseAddress, webHostsFor, webUrlOf } from './address';

/** A repository as a person writes it (DESIGN.md §21.2): the forms that are taken, and what is refused. */
const HOSTS = webHostsFor('https://api.github.com');

describe('parseAddress', () => {
  it.each([
    ['https://github.com/ada/notes', 'ada', 'notes'],
    ['https://github.com/ada/notes.git', 'ada', 'notes'],
    ['https://github.com/ada/notes/', 'ada', 'notes'],
    ['  https://GitHub.com/Ada/Notes  ', 'Ada', 'Notes'],
    ['https://www.github.com/ada/notes', 'ada', 'notes'],
    ['git@github.com:ada/notes.git', 'ada', 'notes'],
    ['git@github.com:ada/notes', 'ada', 'notes'],
    ['ada/notes', 'ada', 'notes'],
    ['ada/notes.git', 'ada', 'notes'],
    ['ada/my.repo_name-2', 'ada', 'my.repo_name-2'],
  ])('takes %s', (input, owner, name) => {
    expect(parseAddress(input, HOSTS)).toEqual({ ok: true, ref: { owner, name } });
  });

  it.each([
    'https://user:token@github.com/ada/notes',
    'https://ada@github.com/ada/notes',
    'https://:secret@github.com/ada/notes',
    'ada:secret@github.com/ada/notes',
  ])('refuses %s: a password, or the half of one, is never kept', (input) => {
    expect(parseAddress(input, HOSTS)).toEqual({ ok: false, problem: 'password' });
  });

  it.each([
    'https://gitlab.com/ada/notes',
    'https://github.com.evil.example/ada/notes',
    'https://evilgithub.com/ada/notes',
    'git@gitlab.com:ada/notes.git',
    'ssh@github.com:ada/notes',
  ])('refuses %s: another host', (input) => {
    expect(parseAddress(input, HOSTS)).toEqual({ ok: false, problem: 'host' });
  });

  it.each([
    '',
    '   ',
    'notes',
    'ada/',
    '/notes',
    'ada/notes/extra',
    'https://github.com/ada',
    'https://github.com/ada/notes/tree/main',
    'https://github.com/ada/notes?tab=readme',
    'https://github.com/ada/notes#readme',
    'http://github.com/ada/notes',
    'ftp://github.com/ada/notes',
    'ada/not es',
    'ada/..',
    '../notes',
    '-ada/notes',
    'ada/notes\u0000',
    `ada/${'n'.repeat(101)}`,
    `${'a'.repeat(301)}`,
  ])('refuses %j: it is not the address of a repository', (input) => {
    const result = parseAddress(input, HOSTS);
    expect(result.ok).toBe(false);
  });

  it('takes the Enterprise Server a setting names, and then no other host, GitHub included', () => {
    const ghe = webHostsFor('https://ghe.example.com/api/v3');
    expect(parseAddress('https://ghe.example.com/ada/notes', ghe)).toMatchObject({ ok: true });
    expect(parseAddress('https://github.com/ada/notes', ghe)).toEqual({
      ok: false,
      problem: 'host',
    });
    expect(webHostsFor('http://localhost:4010')).toEqual(['localhost']);
  });

  it('links to a repository on GitHub, or on the Enterprise Server a setting names', () => {
    expect(webUrlOf('https://api.github.com', 'ada/notes')).toBe('https://github.com/ada/notes');
    expect(webUrlOf('https://ghe.example.com/api/v3', 'ada/notes')).toBe(
      'https://ghe.example.com/ada/notes',
    );
  });
});

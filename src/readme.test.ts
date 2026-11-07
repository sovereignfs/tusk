import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The documents say every setting there is (task 11.2): a setting that is in `.env.example` is in the README, and one the code reads is in `.env.example`, so a
 * setting cannot be added and left for someone to find in the source.
 */
const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const names = (text: string) => new Set(text.match(/\bTUSK_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/g) ?? []);

function walk(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, folder))) {
    const relative = path.join(folder, entry);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative);
  }
  return out;
}

/** Names that are not settings: a constant of the same shape. */
const NOT_SETTINGS = new Set(['TUSK_NAMESPACE', 'TUSK_X']);

describe('the settings', () => {
  const example = names(read('.env.example'));
  const readme = read('README.md');

  it('are in .env.example, which is a list of them', () => {
    expect(example.size).toBeGreaterThan(30);
    for (const required of [
      'TUSK_URL',
      'TUSK_AUTH_SECRET',
      'TUSK_ENCRYPTION_KEY',
      'TUSK_DB_DIALECT',
    ])
      expect(example.has(required), required).toBe(true);
  });

  it('are each in the README, with what they do', () => {
    const missing = [...example].filter((name) => !readme.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('that the code reads are each in .env.example', () => {
    const read_ = new Set<string>();
    for (const file of [
      ...walk('src'),
      ...walk('app'),
      'proxy.ts',
      'instrumentation.ts',
      'instrumentation-node.ts',
    ])
      for (const name of names(readFileSync(path.join(ROOT, file), 'utf8'))) read_.add(name);
    const files = (name: string) =>
      name.endsWith('_FILE') && example.has(name.slice(0, -'_FILE'.length));
    const unlisted = [...read_].filter(
      (name) =>
        !NOT_SETTINGS.has(name) &&
        !example.has(name) &&
        !files(name) &&
        !name.startsWith('TUSK_TEST_'),
    );
    expect(unlisted).toEqual([]);
  });

  it('are not listed in the README unless they are real', () => {
    const real = new Set([...example, ...[...example].map((name) => `${name}_FILE`)]);
    const invented = [...names(readme)].filter((name) => !real.has(name));
    expect(invented).toEqual([]);
  });
});

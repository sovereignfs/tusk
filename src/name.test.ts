import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app is Tusk (DESIGN.md §5.2, §27). It was built as Tasks, and nothing of that name may be left in what the app is called: its settings, its stores, its
 * cookie, the database in the browser, the image, the log lines. Nothing was released under the old names, so nothing answers to them, and a name left behind
 * would be a setting that is silently ignored. Plain words are not names: a *task* in a list is a task until the Desk's tables rename it (task 15.2).
 */
const ROOT = path.resolve(__dirname, '..');
const FOLDERS = ['src', 'app', 'scripts', 'deploy', 'e2e', '.github'];
const FILES = [
  'package.json',
  'sovereign.manifest.json',
  'Dockerfile',
  '.env.example',
  'playwright.config.ts',
  'proxy.ts',
  'instrumentation-node.ts',
];

function walk(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, folder))) {
    const relative = path.join(folder, name);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else out.push(relative);
  }
  return out;
}

/** What a name looks like. Each is built from pieces so that this file is not its own offender. */
const t = 'tas' + 'ks';
const OLD_NAMES: [string, RegExp][] = [
  ['a TASKS_ setting', new RegExp('TAS' + 'KS_')],
  ['a ' + t + '_ store or schema', new RegExp(`\\b${t}_(auth|probe|test)`)],
  ['a ' + t + '.db file', new RegExp(`${t}\\.db`)],
  ['a ' + t + '- name (a volume, a database, a channel, a lock)', new RegExp(`\\b${t}-`)],
  [
    'the ' + t + ' cookie or key',
    new RegExp(`${t}\\.(session_token|session_data|theme|auth|database)`),
  ],
  [
    'a compose project, image or database user named ' + t,
    new RegExp(`^name: ${t}$|:-${t}\\}|POSTGRES_(USER|DB): ${t}|\\d/${t}\\b|://${t}:`),
  ],
  ['the [' + t + '] log prefix', new RegExp(`\\[${t}\\]`)],
  ['the ' + t + ':ci image', new RegExp(`${t}:ci`)],
  ['the package or repository', new RegExp(`sovereignfs/${t}\\b|@sovereignfs/${t}`)],
];

describe('the app’s name', () => {
  const all = [...FOLDERS.flatMap(walk), ...FILES].filter((file) => !file.endsWith('name.test.ts'));

  it('is Tusk in every name the app has', () => {
    const found: string[] = [];
    for (const file of all) {
      const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [what, pattern] of OLD_NAMES) {
          if (pattern.test(line)) found.push(`${file}:${index + 1} — ${what}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('is Tusk in the manifest and the package, and in what the browser is told', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, 'sovereign.manifest.json'), 'utf8'),
    ) as {
      prefix: string;
      name: string;
    };
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(manifest).toMatchObject({ prefix: 'tusk', name: 'Tusk' });
    expect(pkg.name).toBe('@sovereignfs/tusk');
  });
});

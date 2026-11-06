import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The table of conflicts in DESIGN.md §8.4 has **one named case per row**, each in a test that two devices run against the real server. This holds the
 * two together: a row added to the table, or one renamed, fails here until a case answers it, and a case that is renamed or removed fails here too.
 * Each case was seen to fail with its rule broken (the epic, `docs/epics/sync.md`, says how).
 */
const root = join(__dirname, '..', '..');

/** The first words of each row of the table, and the case that answers it: the file, and the title of the `it`. */
const CASES: readonly { row: string; file: string; title: string }[] = [
  {
    row: 'Two devices change different fields of a card',
    file: 'src/sync/devices.test.ts',
    title: 'different fields: both changes stand, on both devices',
  },
  {
    row: 'Two devices change the same field',
    file: 'src/sync/devices.test.ts',
    title: 'the same field: the one that reached the server later wins, on both devices',
  },
  {
    row: 'One device edits a card another deleted',
    file: 'src/sync/devices.test.ts',
    title: 'one deletes and the other edits: the edit restores it',
  },
  { row: 'Both delete', file: 'src/sync/devices.test.ts', title: 'both delete: it is deleted' },
  {
    row: 'Two devices move a card to one position',
    file: 'src/sync/devices.test.ts',
    title:
      'two devices put a task at one position: both keep the key and every device shows one order',
  },
  {
    row: 'One device marks a card in progress, another marks it done',
    file: 'src/sync/devices.test.ts',
    title: 'one starts it and the other finishes it, whichever arrives last: it is Done, on both',
  },
  {
    row: 'Two devices complete a repeating card',
    file: 'src/sync/occurrences.test.ts',
    title:
      'makes one next when two devices complete it offline on the same day, however many times each taps',
  },
  {
    row: 'Two devices complete it on different days',
    file: 'src/sync/occurrences.test.ts',
    title:
      'settles on one open occurrence when two devices complete it on different days: the earlier stays, and both agree',
  },
  {
    row: 'A card is added to a list another device deleted',
    file: 'src/sync/devices.test.ts',
    title: 'a task is added to a list the other device deleted: the list comes back',
  },
];

/** The rows of the §8.4 table, by their first cell. */
function tableRows(): string[] {
  const design = readFileSync(join(root, 'DESIGN.md'), 'utf8');
  const start = design.indexOf('### 8.4 Conflicts');
  const end = design.indexOf('\n### ', start + 1);
  return design
    .slice(start, end)
    .split('\n')
    .filter(
      (line) => line.startsWith('|') && !line.includes('---') && !line.includes('What happened'),
    )
    .map((line) => (line.split('|')[1] ?? '').trim());
}

describe('the table of conflicts (DESIGN.md §8.4)', () => {
  it('has a named case for each of its rows, and no case for a row that is not there', () => {
    const rows = tableRows();
    expect(rows.length).toBeGreaterThanOrEqual(CASES.length);
    for (const { row } of CASES)
      expect(
        rows.some((each) => each.startsWith(row)),
        `no row of §8.4 begins "${row}"`,
      ).toBe(true);
    for (const each of rows)
      expect(
        CASES.some(({ row }) => each.startsWith(row)),
        `§8.4 has a row with no case: "${each}"`,
      ).toBe(true);
    expect(rows).toHaveLength(CASES.length);
  });

  it('is answered by tests that are there, under the titles it names', () => {
    for (const { file, title } of CASES)
      expect(readFileSync(join(root, file), 'utf8'), `${file}: ${title}`).toContain(`'${title}'`);
  });
});

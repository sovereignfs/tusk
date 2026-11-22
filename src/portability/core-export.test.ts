import { describe, expect, it } from 'vitest';
import { fileRecords, timed } from './core-export';
import { FORMAT, VERSION, type TuskExport } from './format';

/** A person's part of core's export (`signIn.export`): the "everything" file a backup holds, as records of the export format. */
const base = {
  format: FORMAT,
  version: VERSION,
  exportedAt: '2026-11-22T00:00:00.000Z',
  scope: 'everything',
} as const;

describe('the "everything" file as records', () => {
  it('is the Desk’s lists and series and each workspace owned, under the app’s own folder', () => {
    const file = {
      ...base,
      desk: { lists: [{ id: 'l1', title: 'Today', cards: [] }], series: [] },
      workspaces: [{ name: 'Home', boards: [] }],
    } as unknown as TuskExport;
    expect(fileRecords(file).map(({ path, kind, endToEnd }) => [path, kind, endToEnd])).toEqual([
      ['apps/tusk/records/desk_list.jsonl', 'desk_list', false],
      ['apps/tusk/records/workspace.jsonl', 'workspace', false],
    ]);
  });

  it('carries a Desk sealed with the person’s own key as the server holds it, marked end to end', () => {
    const file = {
      ...base,
      encrypted: true,
      sealedDesk: {
        lists: [{ id: 'l1', position: 'a', fields: { title: { c: 'ciphertext' } } }],
        cards: [{ id: 'c1', listId: 'l1', position: 'a', fields: { title: { c: 'more' } } }],
        checks: [],
        series: [],
      },
      workspaces: [],
    } as unknown as TuskExport;
    const parts = fileRecords(file);
    expect(parts.map((each) => [each.kind, each.endToEnd])).toEqual([
      ['sealed_desk_list', true],
      ['sealed_desk_card', true],
    ]);
    expect(JSON.stringify(parts)).toContain('ciphertext');
  });

  it('writes a time in milliseconds as ISO 8601 in UTC, nested or not, and names each kind as the format allows', () => {
    expect(
      timed({ completedAt: Date.UTC(2026, 0, 1), items: [{ archivedAt: 0, title: 'x' }] }),
    ).toEqual({
      completedAt: '2026-01-01T00:00:00.000Z',
      items: [{ archivedAt: '1970-01-01T00:00:00.000Z', title: 'x' }],
    });
    const file = {
      ...base,
      desk: { lists: [{}], series: [{}] },
      workspaces: [{}],
    } as unknown as TuskExport;
    for (const each of fileRecords(file)) expect(each.kind).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

import type { LocalRow } from '../local/rows';
import { byPosition } from '../local/rows';

/**
 * The export file, version 1 (DESIGN.md §20.1): one JSON file for the Desk, a board, a workspace or everything. **Pure:** the builders are given rows
 * and make the file, with no clock, no database and no account. They write **what is there, not what was deleted** (archived included), **people by name
 * and email and never by id**, so that a file means something on another server, and nothing that is a key, a publication token, a backup connection or a
 * credential. **Deterministic:** everything is in order by position and id, so that two exports of unchanged data differ only in `exportedAt`.
 *
 * The Desk's part is made in the browser from the working copy (it works offline, on any encryption mode); a board's and a workspace's on the server.
 */
export const FORMAT = 'tusk';
export const VERSION = 1;

export type Scope = 'desk' | 'board' | 'workspace' | 'everything';

export interface ExportedChecklistItem {
  readonly id: string;
  readonly title: string;
  readonly completedAt: number | null;
  readonly position: string;
}

export interface ExportedDeskCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly starred: boolean;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  /** The series it is an occurrence of, by the id the file gives it. */
  readonly seriesId: string | null;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly position: string;
  readonly checklist: readonly ExportedChecklistItem[];
}

export interface ExportedDeskList {
  readonly id: string;
  readonly title: string;
  readonly color: string | null;
  readonly position: string;
  readonly sort: string | null;
  readonly cards: readonly ExportedDeskCard[];
}

export interface ExportedSeries {
  readonly id: string;
  readonly listId: string;
  readonly rule: string;
  readonly anchor: string;
}

export interface DeskPart {
  readonly lists: readonly ExportedDeskList[];
  readonly series: readonly ExportedSeries[];
}

/** A person as the file names them: by what they are called and the address they sign in with, never by an id. */
export interface ExportedPerson {
  readonly name: string;
  readonly email: string;
}

export interface ExportedBoardCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly dueDate: string | null;
  readonly dueTime: string | null;
  readonly position: string;
  readonly archived: boolean;
  /** The ids, in the file, of the labels it has. */
  readonly labels: readonly string[];
  readonly assignees: readonly ExportedPerson[];
  readonly checklist: readonly ExportedChecklistItem[];
  readonly comments: readonly {
    readonly author: ExportedPerson;
    readonly body: string;
    readonly createdAt: string;
    readonly editedAt: string | null;
  }[];
}

export interface BoardPart {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly description: string | null;
  readonly visibility: 'public' | 'private';
  readonly archived: boolean;
  readonly lists: readonly {
    readonly id: string;
    readonly name: string;
    readonly position: string;
    readonly cards: readonly ExportedBoardCard[];
  }[];
  readonly labels: readonly {
    readonly id: string;
    readonly name: string;
    readonly color: string;
  }[];
  readonly activity: readonly {
    readonly kind: string;
    readonly actor: ExportedPerson;
    readonly cardId: string | null;
    readonly details: Record<string, unknown>;
    readonly createdAt: string;
  }[];
}

export interface WorkspacePart {
  readonly id: string;
  readonly name: string;
  readonly people: readonly (ExportedPerson & { readonly role: 'owner' | 'member' })[];
  readonly boards: readonly BoardPart[];
}

export interface TuskExport {
  readonly format: typeof FORMAT;
  readonly version: typeof VERSION;
  readonly exportedAt: string;
  readonly scope: Scope;
  readonly desk?: DeskPart;
  readonly board?: BoardPart;
  readonly workspace?: WorkspacePart;
  readonly workspaces?: readonly WorkspacePart[];
}

/** The whole file, from its parts. `exportedAt` is the one thing that varies between two exports of unchanged data. */
export function envelope(
  scope: Scope,
  parts: Pick<TuskExport, 'desk' | 'board' | 'workspace' | 'workspaces'>,
  exportedAt: Date,
): TuskExport {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: exportedAt.toISOString(),
    scope,
    ...parts,
  };
}

/** `tusk-<scope>-<date>.json`: the file's name when it is saved. */
export function fileNameOf(scope: Scope, exportedAt: Date): string {
  return `tusk-${scope}-${exportedAt.toISOString().slice(0, 10)}.json`;
}

/** The file as text: indented, so that a person can read it and a diff of two exports is a diff of what changed. */
export const serialise = (file: TuskExport): string => `${JSON.stringify(file, null, 2)}\n`;

export type OpenField = (field: { readonly c: string }) => string | undefined;

const value = (row: LocalRow, name: string, open?: OpenField): unknown => {
  const field = row.fields[name];
  if (field === undefined) return undefined;
  if ('c' in field) return open?.(field);
  return field.v;
};
const text = (row: LocalRow, name: string, open?: OpenField): string => {
  const v = value(row, name, open);
  return typeof v === 'string' ? v : '';
};
const orNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const timeOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** What the Desk has to export: every row of the working copy (the builder leaves out what is deleted). */
export interface DeskRows {
  readonly lists: readonly LocalRow[];
  readonly cards: readonly LocalRow[];
  readonly checks: readonly LocalRow[];
  readonly series: readonly LocalRow[];
}

const live = (rows: readonly LocalRow[]) => rows.filter((row) => row.deletedAt === null);
const ordered = <T extends LocalRow>(rows: readonly T[]) =>
  [...rows].sort((a, b) =>
    'position' in a && 'position' in b ? byPosition(a, b) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

/**
 * The Desk's part, from its rows (DESIGN.md §20.1): its lists in order, each with its cards in order, each with its checklist, and its series. A card of
 * a list that is deleted is not there (the list is not), a checklist item of a card that is deleted is not either. `open` reads a field that is ciphertext
 * on a Desk with personal keys; without it a sealed field is written as empty, and the screen that asks has said so.
 */
export function buildDesk(rows: DeskRows, open?: OpenField): DeskPart {
  const lists = ordered(live(rows.lists)).filter((row) => row.table === 'desk_list');
  const listIds = new Set(lists.map((list) => list.id));
  const cards = live(rows.cards).filter(
    (row): row is Extract<LocalRow, { table: 'desk_card' }> =>
      row.table === 'desk_card' && listIds.has(row.listId),
  );
  const cardIds = new Set(cards.map((card) => card.id));
  const items = live(rows.checks).filter(
    (row): row is Extract<LocalRow, { table: 'desk_check' }> =>
      row.table === 'desk_check' && cardIds.has(row.cardId),
  );
  const series = live(rows.series).filter(
    (row): row is Extract<LocalRow, { table: 'desk_series' }> =>
      row.table === 'desk_series' && listIds.has(row.listId),
  );
  const seriesIds = new Set(series.map((row) => row.id));

  return {
    lists: lists.map((list) => ({
      id: list.id,
      title: text(list, 'title', open),
      color: orNull(value(list, 'color', open)),
      position: 'position' in list ? list.position : '',
      sort: orNull(value(list, 'sort', open)),
      cards: ordered(cards.filter((card) => card.listId === list.id)).map((card) => ({
        id: card.id,
        title: text(card, 'title', open),
        description: text(card, 'description', open),
        starred: value(card, 'starred', open) === true,
        dueDate: orNull(value(card, 'dueDate', open)),
        dueTime: orNull(value(card, 'dueTime', open)),
        // A pointer to a series that is not in the file would point at nothing.
        seriesId: ((id) => (id !== null && seriesIds.has(id) ? id : null))(
          orNull(value(card, 'seriesId', open)),
        ),
        startedAt: timeOrNull(value(card, 'startedAt', open)),
        completedAt: timeOrNull(value(card, 'completedAt', open)),
        position: card.position,
        checklist: ordered(items.filter((item) => item.cardId === card.id)).map((item) => ({
          id: item.id,
          title: text(item, 'title', open),
          completedAt: timeOrNull(value(item, 'completedAt', open)),
          position: item.position,
        })),
      })),
    })),
    series: [...series]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((row) => ({
        id: row.id,
        listId: row.listId,
        rule: text(row, 'rule', open),
        anchor: text(row, 'anchor', open),
      })),
  };
}

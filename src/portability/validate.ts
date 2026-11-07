import { type Parser, bool, hhmm, isoDate, nullable, oneOf, text, uuid } from '../access/parse';
import { HEX_COLOR } from '../lists/colors';
import { SORTS } from '../lists/sort';
import { parseRule } from '../recurrence';
import { convertTasksPlugin, isPluginFile } from './plugin';
import { FIELD_NAMES, LIMITS } from '../sync/format';
import { WORKSPACE_LIMITS } from '../workspaces/format';
import {
  type BoardPart,
  type DeskPart,
  type ExportedBoardCard,
  type ExportedChecklistItem,
  type ExportedDeskCard,
  type ExportedPerson,
  FORMAT,
  type Scope,
  type TuskExport,
  VERSION,
  type WorkspacePart,
  type SealedDeskPart,
  type SealedField,
} from './format';

/**
 * Reading an export file (DESIGN.md §20.2), by hand and over the whole of it, before anything is written. **It answers with one precise error or a normalised
 * file,** and a file that fails changes nothing. It is the same function in the browser (to say what a file holds before asking) and on the server (which
 * checks again, since it takes nothing a browser says on trust). It uses the parsers of §7, `parseRule` for a repeat, and the limits of the app: counts of
 * everything, the length of each text, **and the references inside the file**: a series points at a list that is in it, a card at a series that is in it, a
 * label on a card is one of its board's. A reason names where (`desk.lists[2].cards[0].title`) and never what was there, which may be anything.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type Validated =
  /** `converted` is what was changed or left behind when the file was another app's, in words: the preview shows it before anything is written. */
  { ok: true; file: TuskExport; converted?: readonly string[] } | { ok: false; error: string };

class Bad extends Error {}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function rec(v: unknown, path: string): Rec {
  if (!isRec(v)) throw new Bad(`${path}: not an object`);
  return v;
}
function list(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new Bad(`${path}: not a list`);
  if (v.length > max) throw new Bad(`${path}: more than ${max}`);
  return v;
}
function get<T>(o: Rec, key: string, parser: Parser<T>, path: string): T {
  const parsed = parser(o[key]);
  if (!parsed.ok) throw new Bad(`${path}.${key}: ${parsed.reason}`);
  return parsed.value;
}

const POSITION = /^[0-9A-Za-z]+$/;
const position: Parser<string> = (v) =>
  typeof v === 'string' && POSITION.test(v) && v.length <= LIMITS.positionChars
    ? { ok: true, value: v }
    : { ok: false, reason: 'not a position' };
const color: Parser<string> = (v) =>
  typeof v === 'string' && HEX_COLOR.test(v)
    ? { ok: true, value: v }
    : { ok: false, reason: 'not a colour' };
const instant: Parser<number | null> = nullable((v) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 8_640_000_000_000_000
    ? { ok: true, value: v }
    : { ok: false, reason: 'not a time' },
);
const isoInstant: Parser<string> = (v) =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
    ? { ok: true, value: v }
    : { ok: false, reason: 'not a time' };
/** Text that may be empty (a description). */
const body = (max: number): Parser<string> => text(0, max);
/** Text that is trimmed before it is measured, so that spaces alone are no title: what is kept is what was measured. */
const trimmed =
  (min: number, max: number): Parser<string> =>
  (v) =>
    text(min, max)(typeof v === 'string' ? v.trim() : v);
const title = trimmed(1, LIMITS.titleChars);
const name = trimmed(1, WORKSPACE_LIMITS.nameChars);

function unique(seen: Set<string>, id: string, path: string): void {
  if (seen.has(id)) throw new Bad(`${path}.id: used twice in the file`);
  seen.add(id);
}

const CIPHER_FIELD = /^[A-Za-z0-9_-]{20,40000}$/;
const WRAPPED = /^[A-Za-z0-9_-]{100,600}$/;

/** A sealed row's fields: only the names its table has, each ciphertext, and a list's `key` plain and wrapped. A field in the clear is no part of a sealed file. */
function sealedFields(
  v: unknown,
  path: string,
  names: readonly string[],
): Record<string, SealedField> {
  const o = rec(v, path);
  const out: Record<string, SealedField> = {};
  for (const key of Object.keys(o)) {
    if (!names.includes(key)) throw new Bad(`${path}: names a field there is not`);
    const f = rec(o[key], `${path}.${key}`);
    const keys = Object.keys(f);
    if (key === 'key') {
      if (keys.length !== 1 || typeof f.v !== 'string' || !WRAPPED.test(f.v))
        throw new Bad(`${path}.key: not a wrapped key`);
      out[key] = { v: f.v };
    } else {
      if (keys.length !== 1 || typeof f.c !== 'string' || !CIPHER_FIELD.test(f.c))
        throw new Bad(`${path}.${key}: not ciphertext`);
      out[key] = { c: f.c };
    }
  }
  return out;
}

function sealedDesk(v: unknown): SealedDeskPart {
  const o = rec(v, 'sealedDesk');
  const seen = new Set<string>();
  const ids = (raw: Rec, at: string) => {
    const id = get(raw, 'id', uuid, at);
    unique(seen, id, at);
    return id;
  };
  const lists = list(o.lists, 'sealedDesk.lists', LIMITS.listsPerAccount).map((raw, i) => {
    const at = `sealedDesk.lists[${i}]`;
    const r = rec(raw, at);
    const fields = sealedFields(r.fields, `${at}.fields`, FIELD_NAMES.desk_list);
    if (!fields.key) throw new Bad(`${at}.fields: a list has its key`);
    return { id: ids(r, at), position: get(r, 'position', position, at), fields };
  });
  const cards = list(o.cards, 'sealedDesk.cards', LIMITS.cardsPerAccount).map((raw, i) => {
    const at = `sealedDesk.cards[${i}]`;
    const r = rec(raw, at);
    return {
      id: ids(r, at),
      listId: get(r, 'listId', uuid, at),
      position: get(r, 'position', position, at),
      fields: sealedFields(r.fields, `${at}.fields`, FIELD_NAMES.desk_card),
    };
  });
  const checks = list(o.checks, 'sealedDesk.checks', LIMITS.checksPerAccount).map((raw, i) => {
    const at = `sealedDesk.checks[${i}]`;
    const r = rec(raw, at);
    return {
      id: ids(r, at),
      cardId: get(r, 'cardId', uuid, at),
      position: get(r, 'position', position, at),
      fields: sealedFields(r.fields, `${at}.fields`, FIELD_NAMES.desk_check),
    };
  });
  const series = list(o.series, 'sealedDesk.series', LIMITS.cardsPerAccount).map((raw, i) => {
    const at = `sealedDesk.series[${i}]`;
    const r = rec(raw, at);
    return {
      id: ids(r, at),
      listId: get(r, 'listId', uuid, at),
      fields: sealedFields(r.fields, `${at}.fields`, FIELD_NAMES.desk_series),
    };
  });
  return { lists, cards, checks, series };
}

function checklist(
  v: unknown,
  path: string,
  max: number,
  seen: Set<string>,
): ExportedChecklistItem[] {
  return list(v, path, max).map((raw, i) => {
    const at = `${path}[${i}]`;
    const o = rec(raw, at);
    const id = get(o, 'id', uuid, at);
    unique(seen, id, at);
    return {
      id,
      title: get(o, 'title', title, at),
      completedAt: get(o, 'completedAt', instant, at),
      position: get(o, 'position', position, at),
    };
  });
}

function person(v: unknown, path: string): ExportedPerson {
  const o = rec(v, path);
  return {
    name: get(o, 'name', text(0, WORKSPACE_LIMITS.nameChars), path),
    email: get(o, 'email', text(0, 320), path),
  };
}

function desk(v: unknown): DeskPart {
  const o = rec(v, 'desk');
  const ids = new Set<string>();
  const seriesIds = new Set<string>();
  const listIds = new Set<string>();
  let cards = 0;
  let items = 0;
  const rawSeries = list(o.series, 'desk.series', LIMITS.cardsPerAccount);
  for (const [i, raw] of rawSeries.entries())
    seriesIds.add(get(rec(raw, `desk.series[${i}]`), 'id', uuid, `desk.series[${i}]`));
  if (seriesIds.size !== rawSeries.length) throw new Bad('desk.series: an id is used twice');

  const lists = list(o.lists, 'desk.lists', LIMITS.listsPerAccount).map((rawList, li) => {
    const at = `desk.lists[${li}]`;
    const l = rec(rawList, at);
    const id = get(l, 'id', uuid, at);
    unique(ids, id, at);
    listIds.add(id);
    return {
      id,
      title: get(l, 'title', title, at),
      color: get(l, 'color', nullable(color), at),
      position: get(l, 'position', position, at),
      sort: get(l, 'sort', nullable(oneOf(...SORTS)), at),
      cards: list(l.cards, `${at}.cards`, LIMITS.cardsPerAccount).map(
        (rawCard, ci): ExportedDeskCard => {
          const cat = `${at}.cards[${ci}]`;
          const c = rec(rawCard, cat);
          cards += 1;
          if (cards > LIMITS.cardsPerAccount)
            throw new Bad(`desk: more than ${LIMITS.cardsPerAccount} cards`);
          const cid = get(c, 'id', uuid, cat);
          unique(ids, cid, cat);
          const dueDate = get(c, 'dueDate', nullable(isoDate), cat);
          const dueTime = get(c, 'dueTime', nullable(hhmm), cat);
          if (dueDate === null && dueTime !== null)
            throw new Bad(`${cat}.dueTime: a time with no date`);
          const seriesId = get(c, 'seriesId', nullable(uuid), cat);
          if (seriesId !== null && !seriesIds.has(seriesId))
            throw new Bad(`${cat}.seriesId: a series that is not in the file`);
          const checks = checklist(
            c.checklist,
            `${cat}.checklist`,
            WORKSPACE_LIMITS.itemsPerCard,
            ids,
          );
          items += checks.length;
          if (items > LIMITS.checksPerAccount)
            throw new Bad(`desk: more than ${LIMITS.checksPerAccount} checklist items`);
          return {
            id: cid,
            title: get(c, 'title', title, cat).trim(),
            description: get(c, 'description', body(LIMITS.descriptionChars), cat),
            starred: get(c, 'starred', bool, cat),
            dueDate,
            dueTime,
            seriesId,
            startedAt: get(c, 'startedAt', instant, cat),
            completedAt: get(c, 'completedAt', instant, cat),
            position: get(c, 'position', position, cat),
            checklist: checks,
          };
        },
      ),
    };
  });

  const series = rawSeries.map((raw, i) => {
    const at = `desk.series[${i}]`;
    const s = rec(raw, at);
    const listId = get(s, 'listId', uuid, at);
    if (!listIds.has(listId)) throw new Bad(`${at}.listId: a list that is not in the file`);
    const rule = get(s, 'rule', text(1, LIMITS.ruleChars), at);
    if (!parseRule(rule).ok) throw new Bad(`${at}.rule: not a repeat rule this version reads`);
    return { id: get(s, 'id', uuid, at), listId, rule, anchor: get(s, 'anchor', isoDate, at) };
  });
  return { lists, series };
}

function board(v: unknown, path: string): BoardPart {
  const o = rec(v, path);
  const ids = new Set<string>();
  const labelIds = new Set<string>();
  let cards = 0;
  const labels = list(o.labels, `${path}.labels`, WORKSPACE_LIMITS.labelsPerBoard).map((raw, i) => {
    const at = `${path}.labels[${i}]`;
    const l = rec(raw, at);
    const id = get(l, 'id', uuid, at);
    unique(ids, id, at);
    labelIds.add(id);
    return {
      id,
      name: get(l, 'name', text(0, WORKSPACE_LIMITS.labelNameChars), at),
      color: get(l, 'color', color, at),
    };
  });
  const lists = list(o.lists, `${path}.lists`, WORKSPACE_LIMITS.listsPerBoard).map((raw, li) => {
    const at = `${path}.lists[${li}]`;
    const l = rec(raw, at);
    const id = get(l, 'id', uuid, at);
    unique(ids, id, at);
    return {
      id,
      name: get(l, 'name', name, at),
      position: get(l, 'position', position, at),
      cards: list(l.cards, `${at}.cards`, WORKSPACE_LIMITS.cardsPerBoard).map(
        (rawCard, ci): ExportedBoardCard => {
          const cat = `${at}.cards[${ci}]`;
          const c = rec(rawCard, cat);
          cards += 1;
          if (cards > WORKSPACE_LIMITS.cardsPerBoard)
            throw new Bad(`${path}: more than ${WORKSPACE_LIMITS.cardsPerBoard} cards`);
          const cid = get(c, 'id', uuid, cat);
          unique(ids, cid, cat);
          const dueDate = get(c, 'dueDate', nullable(isoDate), cat);
          const dueTime = get(c, 'dueTime', nullable(hhmm), cat);
          if (dueDate === null && dueTime !== null)
            throw new Bad(`${cat}.dueTime: a time with no date`);
          const carried = list(c.labels, `${cat}.labels`, WORKSPACE_LIMITS.labelsPerBoard).map(
            (each, k) => {
              const parsed = uuid(each);
              if (!parsed.ok) throw new Bad(`${cat}.labels[${k}]: not an id`);
              // A label that is not this board's would put another board's label on this card.
              if (!labelIds.has(parsed.value))
                throw new Bad(`${cat}.labels[${k}]: a label that is not on this board`);
              return parsed.value;
            },
          );
          return {
            id: cid,
            title: get(c, 'title', title, cat).trim(),
            description: get(c, 'description', body(LIMITS.descriptionChars), cat),
            dueDate,
            dueTime,
            position: get(c, 'position', position, cat),
            archived: get(c, 'archived', bool, cat),
            labels: carried,
            assignees: list(
              c.assignees,
              `${cat}.assignees`,
              WORKSPACE_LIMITS.membersPerWorkspace,
            ).map((p, k) => person(p, `${cat}.assignees[${k}]`)),
            checklist: checklist(
              c.checklist,
              `${cat}.checklist`,
              WORKSPACE_LIMITS.itemsPerCard,
              ids,
            ),
            // A comment is read as a record and not written back (§20.2): its text and its limits are still the file's to keep honest.
            comments: list(c.comments, `${cat}.comments`, WORKSPACE_LIMITS.commentsPerCard).map(
              (raw2, k) => {
                const ck = `${cat}.comments[${k}]`;
                const m = rec(raw2, ck);
                return {
                  author: person(m.author, `${ck}.author`),
                  body: get(m, 'body', text(0, WORKSPACE_LIMITS.commentChars), ck),
                  createdAt: get(m, 'createdAt', isoInstant, ck),
                  editedAt: get(m, 'editedAt', nullable(isoInstant), ck),
                };
              },
            ),
          };
        },
      ),
    };
  });
  return {
    id: get(o, 'id', uuid, path),
    name: get(o, 'name', name, path),
    color: get(o, 'color', color, path),
    description: get(
      o,
      'description',
      nullable(body(WORKSPACE_LIMITS.boardDescriptionChars)),
      path,
    ),
    visibility: get(o, 'visibility', oneOf('public', 'private'), path),
    archived: get(o, 'archived', bool, path),
    lists,
    labels,
    // Activity is a record too: read as one, and never written (§20.2). Its details are free, within the size of the file.
    activity: list(o.activity, `${path}.activity`, 1_000_000).map((raw, i) => {
      const at = `${path}.activity[${i}]`;
      const a = rec(raw, at);
      return {
        kind: get(a, 'kind', text(1, 100), at),
        actor: person(a.actor, `${at}.actor`),
        cardId: get(a, 'cardId', nullable(uuid), at),
        details: isRec(a.details) ? a.details : {},
        createdAt: get(a, 'createdAt', isoInstant, at),
      };
    }),
  };
}

function workspace(v: unknown, path: string): WorkspacePart {
  const o = rec(v, path);
  return {
    id: get(o, 'id', uuid, path),
    name: get(o, 'name', name, path),
    people: list(o.people, `${path}.people`, WORKSPACE_LIMITS.membersPerWorkspace).map(
      (raw, i) => ({
        ...person(raw, `${path}.people[${i}]`),
        role: get(
          rec(raw, `${path}.people[${i}]`),
          'role',
          oneOf('owner', 'member'),
          `${path}.people[${i}]`,
        ),
      }),
    ),
    boards: list(o.boards, `${path}.boards`, WORKSPACE_LIMITS.boardsPerWorkspace).map((b, i) =>
      board(b, `${path}.boards[${i}]`),
    ),
  };
}

/** Reads the text of a file: its size first, then that it is JSON, then every field of it. Nothing is written by this. */
export function validateFile(source: string): Validated {
  // Characters are bytes or more, so a text over the limit in characters is over it in bytes or close; the exact count is the transport's (50 MB).
  if (source.length > MAX_FILE_BYTES) return { ok: false, error: 'the file is over 50 MB' };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: 'the file is not JSON' };
  }
  // The tasks plugin's file is turned into a Desk export of this version first, and read like any other (`plugin.ts`).
  let converted: readonly string[] | undefined;
  if (isPluginFile(raw)) {
    const result = convertTasksPlugin(raw, new Date());
    if (!result.ok) return { ok: false, error: result.error };
    raw = result.conversion.file;
    converted = result.conversion.notes;
  }
  try {
    const o = rec(raw, 'file');
    if (o.format !== FORMAT) throw new Bad('format: this is not a Tusk export');
    if (o.version !== VERSION)
      throw new Bad(
        typeof o.version === 'number' && o.version > VERSION
          ? 'version: made by a newer Tusk than this one reads'
          : 'version: not a version this reads',
      );
    const scope = get(
      o,
      'scope',
      oneOf('desk', 'board', 'workspace', 'everything'),
      'file',
    ) as Scope;
    const exportedAt = get(o, 'exportedAt', isoInstant, 'file');
    // A file made by the server for an account with a key of its own holds a sealed Desk, and says so; one that says so holds nothing else of the Desk.
    const encrypted = o.encrypted === true;
    if (o.encrypted !== undefined && o.encrypted !== true)
      throw new Bad('encrypted: true or absent');
    const hasDesk =
      scope === 'desk' || (scope === 'everything' && (o.desk ?? o.sealedDesk) !== undefined);
    const parts: Pick<TuskExport, 'desk' | 'board' | 'workspace' | 'workspaces' | 'sealedDesk'> = {
      ...(hasDesk && !encrypted ? { desk: desk(o.desk) } : {}),
      ...(hasDesk && encrypted ? { sealedDesk: sealedDesk(o.sealedDesk) } : {}),
      ...(scope === 'board' ? { board: board(o.board, 'board') } : {}),
      ...(scope === 'workspace' ? { workspace: workspace(o.workspace, 'workspace') } : {}),
      ...(scope === 'everything'
        ? {
            workspaces: list(o.workspaces, 'workspaces', WORKSPACE_LIMITS.workspacesPerAccount).map(
              (w, i) => workspace(w, `workspaces[${i}]`),
            ),
          }
        : {}),
    };
    return {
      ok: true,
      ...(converted ? { converted } : {}),
      file: {
        format: FORMAT,
        version: VERSION,
        exportedAt,
        scope,
        ...(encrypted ? { encrypted: true as const } : {}),
        ...parts,
      },
    };
  } catch (error) {
    if (error instanceof Bad) return { ok: false, error: error.message };
    throw error;
  }
}

/** What a file holds, as the line that asks before anything is written. */
export interface Summary {
  readonly desk: { readonly lists: number; readonly cards: number } | null;
  readonly workspaces: number;
  readonly boards: number;
  readonly cards: number;
  /** The people the file names, by address, that a server would have to find: assignees and members. */
  readonly people: number;
}

export function summarise(file: TuskExport): Summary {
  const workspaces = file.workspaces ?? (file.workspace ? [file.workspace] : []);
  const boards = [...workspaces.flatMap((w) => w.boards), ...(file.board ? [file.board] : [])];
  const emails = new Set<string>();
  for (const w of workspaces) for (const p of w.people) emails.add(p.email.toLowerCase());
  for (const b of boards)
    for (const l of b.lists)
      for (const c of l.cards) for (const a of c.assignees) emails.add(a.email.toLowerCase());
  emails.delete('');
  return {
    desk: file.desk
      ? {
          lists: file.desk.lists.length,
          cards: file.desk.lists.reduce((n, l) => n + l.cards.length, 0),
        }
      : file.sealedDesk
        ? { lists: file.sealedDesk.lists.length, cards: file.sealedDesk.cards.length }
        : null,
    workspaces: workspaces.length,
    boards: boards.length,
    cards: boards.reduce((n, b) => n + b.lists.reduce((m, l) => m + l.cards.length, 0), 0),
    people: emails.size,
  };
}

/** "your Desk: 3 lists, 40 cards; 1 workspace, 4 boards, 312 cards": what the file holds, in the words the person is asked in. */
export function describeSummary(s: Summary): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const server: string[] = [];
  if (s.workspaces > 0) server.push(plural(s.workspaces, 'workspace'));
  if (s.boards > 0) server.push(plural(s.boards, 'board'));
  if (s.cards > 0) server.push(plural(s.cards, 'card'));
  const parts: string[] = [];
  if (s.desk)
    parts.push(`your Desk: ${plural(s.desk.lists, 'list')}, ${plural(s.desk.cards, 'card')}`);
  if (server.length > 0) parts.push(server.join(', '));
  return parts.join('; ');
}

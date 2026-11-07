import { createHash } from 'node:crypto';
import { HEX_COLOR } from '../lists/colors';
import { many } from '../position';
import { isRule } from '../recurrence';
import { LIMITS } from '../sync/format';

/**
 * Reading the tasks plugin's file (DESIGN.md §20.2), so that people on the plugin have a way across. **It turns the plugin's export into a Desk export of
 * version 1 before the ordinary validator sees it, so nothing else knows it exists.** The file is the plugin's `PluginExportSection`: `{ pluginId:
 * "fs.sovereign.tasks", schemaVersion: 1, data }`, the same whether it was saved from the plugin or taken from an account export.
 *
 * What it does: times from epoch seconds to milliseconds; the integer order to positions; subtasks to checklist items; notes to descriptions; favourites to
 * stars; ids to new ones (the plugin's are not always UUIDs); one series for each `seriesId`, its rule held to the allow-list, its anchor the due date of its
 * one open occurrence. **Nothing is dropped silently:** everything it had to change or could not carry is counted, and `notes` says so in words, for the
 * preview that asks before anything is written. A repeat whose rule the parser refuses becomes a one-off. The kanban plugin had no export.
 */
export const PLUGIN_ID = 'fs.sovereign.tasks';
export const PLUGIN_SCHEMA_VERSION = 1;

export interface Conversion {
  /** The ordinary Desk export, as plain data for `validateFile` to read. */
  readonly file: Record<string, unknown>;
  /** What was changed or left behind, in words, for the person to read before importing. */
  readonly notes: readonly string[];
}

export type Converted = { ok: true; conversion: Conversion } | { ok: false; error: string };

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a parsed file is the plugin's. */
export const isPluginFile = (raw: unknown): boolean => isRec(raw) && raw.pluginId === PLUGIN_ID;

/** A UUID made from the plugin's id, so that the same file converts to the same ids and any id the plugin used becomes a valid one. */
function uuidFor(original: string): string {
  const h = createHash('sha256').update(`tusk-plugin-tasks:${original}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const secondsToMs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000)
    : null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const validDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

interface Item {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string;
  favorite: boolean;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: number | null;
  sortOrder: number;
  recurrenceRule: string | null;
  seriesId: string | null;
  assigned: boolean;
}

const byOrder = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1);

export function convertTasksPlugin(raw: unknown, now: Date): Converted {
  if (!isRec(raw) || raw.pluginId !== PLUGIN_ID)
    return { ok: false, error: 'this is not a Sovereign Tasks export' };
  if (raw.schemaVersion !== PLUGIN_SCHEMA_VERSION)
    return {
      ok: false,
      error: 'this export was made by a version of Tasks that this does not read',
    };
  const data = raw.data;
  if (!isRec(data) || !Array.isArray(data.lists) || !Array.isArray(data.items))
    return { ok: false, error: 'this is not a valid Sovereign Tasks export' };

  const notes: string[] = [];
  const say = (n: number, message: (n: number) => string) => {
    if (n > 0) notes.push(message(n));
  };
  let recolored = 0;
  let renamed = 0;
  let shortened = 0;
  let datesLost = 0;

  const lists = (data.lists as unknown[])
    .filter(isRec)
    .map((l) => ({
      id: text(l.id),
      title: text(l.title),
      color: l.color,
      sortOrder: num(l.sortOrder),
    }))
    .filter((l) => l.id !== '')
    .sort(byOrder);
  const listIds = new Set(lists.map((l) => l.id));

  const items: Item[] = (data.items as unknown[])
    .filter(isRec)
    .map((i) => ({
      id: text(i.id),
      listId: text(i.listId),
      parentId: typeof i.parentId === 'string' ? i.parentId : null,
      title: text(i.title),
      notes: text(i.notes),
      favorite: i.favorite === true,
      dueDate: validDate(i.dueDate) ? i.dueDate : null,
      dueTime: typeof i.dueTime === 'string' && TIME.test(i.dueTime) ? i.dueTime : null,
      completedAt: secondsToMs(i.completedAt),
      sortOrder: num(i.sortOrder),
      recurrenceRule:
        typeof i.recurrenceRule === 'string' && i.recurrenceRule !== '' ? i.recurrenceRule : null,
      seriesId: typeof i.seriesId === 'string' && i.seriesId !== '' ? i.seriesId : null,
      assigned: typeof i.assigneeId === 'string',
    }))
    .filter((i) => i.id !== '' && listIds.has(i.listId));
  const dropped = (data.items as unknown[]).length - items.length;
  say(
    dropped,
    (n) =>
      `${n} task${n === 1 ? '' : 's'} belonged to a list that is not in the file and ${n === 1 ? 'was' : 'were'} left out.`,
  );

  const byId = new Map(items.map((i) => [i.id, i]));
  // A subtask goes to the card at the top of its chain; one whose parent is not in the file becomes a card of its own.
  const rootOf = (item: Item): Item | undefined => {
    const seen = new Set<string>();
    let at: Item | undefined = item;
    while (at && at.parentId !== null) {
      if (seen.has(at.id)) return undefined;
      seen.add(at.id);
      const parent = byId.get(at.parentId);
      if (!parent) return undefined;
      at = parent;
    }
    return at;
  };
  const cards: Item[] = [];
  const subtasks = new Map<string, Item[]>();
  let orphans = 0;
  let deep = 0;
  for (const item of items) {
    if (item.parentId === null) {
      cards.push(item);
      continue;
    }
    const root = rootOf(item);
    if (!root || root.id === item.id) {
      orphans += 1;
      cards.push(item);
      continue;
    }
    if (root.id !== item.parentId) deep += 1;
    subtasks.set(root.id, [...(subtasks.get(root.id) ?? []), item]);
  }
  say(
    orphans,
    (n) =>
      `${n} subtask${n === 1 ? '' : 's'} whose task is not in the file became ${n === 1 ? 'a card' : 'cards'} of ${n === 1 ? 'its' : 'their'} own.`,
  );
  say(
    deep,
    (n) =>
      `${n} subtask${n === 1 ? '' : 's'} of a subtask ${n === 1 ? 'was' : 'were'} put in the checklist of the task at the top.`,
  );

  // Series: one for each seriesId among the cards, kept only if its rule is one this reads and it has an open occurrence to anchor to (or any due date).
  const seriesOf = new Map<string, Item[]>();
  for (const card of cards)
    if (card.seriesId !== null)
      seriesOf.set(card.seriesId, [...(seriesOf.get(card.seriesId) ?? []), card]);
  const series: { id: string; listId: string; rule: string; anchor: string }[] = [];
  const kept = new Map<string, string>(); // card id → series id, for the cards that keep it
  let oneOffs = 0;
  let extraOpen = 0;
  for (const [seriesId, members] of seriesOf) {
    const rule = members.find((m) => m.recurrenceRule !== null)?.recurrenceRule ?? null;
    const open = members
      .filter((m) => m.completedAt === null && m.dueDate !== null)
      .sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1));
    const anchorFrom =
      open[0] ??
      [...members]
        .filter((m) => m.dueDate !== null)
        .sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? 1 : -1))[0];
    if (rule === null || !isRule(rule) || !anchorFrom?.dueDate) {
      oneOffs += members.length;
      continue;
    }
    const id = uuidFor(`series:${seriesId}`);
    series.push({
      id,
      listId: uuidFor(`list:${anchorFrom.listId}`),
      rule,
      anchor: anchorFrom.dueDate,
    });
    for (const m of members) {
      // Only one occurrence of a series is open at a time (§12.1): any others become one-offs rather than be deleted as duplicates after import.
      if (m.completedAt === null && m !== open[0]) {
        extraOpen += 1;
        continue;
      }
      kept.set(m.id, id);
    }
  }
  say(
    oneOffs,
    (n) =>
      `${n} task${n === 1 ? '' : 's'} repeated by a rule this does not read, or with no date to start from, and ${n === 1 ? 'is' : 'are'} imported once, without the repeat.`,
  );
  say(
    extraOpen,
    (n) =>
      `${n} open occurrence${n === 1 ? '' : 's'} of a repeat beyond the first ${n === 1 ? 'was' : 'were'} imported as a one-off task.`,
  );

  const clean = (value: string, max: number, onShort: () => void): string => {
    const trimmed = value.trim();
    if (trimmed.length > max) {
      onShort();
      return trimmed.slice(0, max).trim();
    }
    return trimmed;
  };

  const listPositions = many(null, null, lists.length);
  const deskLists = lists.map((list, li) => {
    let color: string | null = null;
    if (typeof list.color === 'string' && list.color !== '') {
      if (HEX_COLOR.test(list.color.toLowerCase())) color = list.color.toLowerCase();
      else recolored += 1;
    }
    let title = clean(list.title, LIMITS.titleChars, () => (shortened += 1));
    if (title === '') {
      title = 'Untitled list';
      renamed += 1;
    }
    const mine = cards.filter((c) => c.listId === list.id).sort(byOrder);
    const positions = many(null, null, mine.length);
    return {
      id: uuidFor(`list:${list.id}`),
      title,
      color,
      position: listPositions[li] ?? 'a0',
      sort: null,
      cards: mine.map((card, ci) => {
        let cardTitle = clean(card.title, LIMITS.titleChars, () => (shortened += 1));
        if (cardTitle === '') {
          cardTitle = 'Untitled';
          renamed += 1;
        }
        const subs = (subtasks.get(card.id) ?? []).sort(byOrder);
        const checkPositions = many(null, null, subs.length);
        for (const sub of subs)
          if (sub.dueDate !== null || sub.favorite || sub.notes !== '') datesLost += 1;
        const description =
          card.notes.length > LIMITS.descriptionChars
            ? ((shortened += 1), card.notes.slice(0, LIMITS.descriptionChars))
            : card.notes;
        return {
          id: uuidFor(`card:${card.id}`),
          title: cardTitle,
          description,
          starred: card.favorite,
          dueDate: card.dueDate,
          dueTime: card.dueDate !== null ? card.dueTime : null,
          seriesId: kept.get(card.id) ?? null,
          startedAt: null,
          completedAt: card.completedAt,
          position: positions[ci] ?? 'a0',
          checklist: subs.map((sub, si) => ({
            id: uuidFor(`card:${sub.id}`),
            title: clean(sub.title, LIMITS.titleChars, () => (shortened += 1)) || 'Untitled',
            completedAt: sub.completedAt,
            position: checkPositions[si] ?? 'a0',
          })),
        };
      }),
    };
  });

  const assigned = items.filter((i) => i.assigned).length;
  const views = Array.isArray(data.views) ? data.views.length : 0;
  say(
    recolored,
    (n) =>
      `${n} list colour${n === 1 ? ' was' : 's were'} not a colour this reads and ${n === 1 ? 'was' : 'were'} left out.`,
  );
  say(
    renamed,
    (n) =>
      `${n} ${n === 1 ? 'item had' : 'items had'} no title and ${n === 1 ? 'was' : 'were'} called Untitled.`,
  );
  say(
    shortened,
    (n) =>
      `${n} title${n === 1 ? '' : 's'} or note${n === 1 ? '' : 's'} ${n === 1 ? 'was' : 'were'} longer than this allows and ${n === 1 ? 'was' : 'were'} cut.`,
  );
  say(
    datesLost,
    (n) =>
      `${n} subtask${n === 1 ? ' had' : 's had'} a date, a star or a note, which a checklist item does not have, and ${n === 1 ? 'was' : 'were'} not carried.`,
  );
  say(
    assigned,
    (n) =>
      `${n} task${n === 1 ? ' was' : 's were'} assigned to someone; the Desk is yours alone, so that is not carried.`,
  );
  say(
    views,
    (n) =>
      `${n} saved view${n === 1 ? '' : 's'} (and the default view of each list) ${n === 1 ? 'is' : 'are'} not carried; a list here has its own sort and filter.`,
  );

  return {
    ok: true,
    conversion: {
      file: {
        format: 'tusk',
        version: 1,
        exportedAt: now.toISOString(),
        scope: 'desk',
        desk: { lists: deskLists, series },
      },
      notes,
    },
  };
}

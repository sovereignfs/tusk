import { fold, terms } from '../fold';
import type { LocalRow } from './rows';

/**
 * Search on the Desk (DESIGN.md §10.7): the titles, descriptions and checklist items of every card the Desk shows, **run in the browser, on the working
 * copy**, so that it works offline and whatever the account's encryption. Pure: it is given the rows, and how to read a field.
 *
 * - **Letters are compared folded** (`src/fold.ts`): "É" finds "é". **The query is text, never a pattern:** `%`, `_`, `*` and `.` match themselves only.
 * - Every word typed must be found, in any of the three kinds of text, in any order. Nothing typed finds nothing.
 * - A checklist item that has a word shows under its card, as a match of its own.
 * - Newest change first: by the latest server stamp of the card or the item that matched, a row not yet heard of by the server (stamp zero) being the
 *   newest of all, then by when the card was made.
 * - **A field that is ciphertext is read through `open`**, which is how a Desk with personal keys (task 14.3) gives the words it has opened; without it a
 *   sealed field is not searched, and finds nothing, as a clear one does not either when it is empty.
 */
export type OpenField = (field: { readonly c: string }) => string | undefined;

/** A card row, as the working copy has it. */
export type CardRow = Extract<LocalRow, { table: 'desk_card' }>;

export interface Hit {
  readonly card: CardRow;
  /** Where the words were found on the card itself. */
  readonly in: readonly ('title' | 'description')[];
  /** The checklist items that have a word, in the order they are in. */
  readonly items: readonly LocalRow[];
  /** A short piece of the description around the first word found in it, when the description has one. */
  readonly snippet: string | null;
  /** When it last changed, as the server counts: what the hits are in order by. */
  readonly changed: number;
}

const SNIPPET = 120;

/** The text a row's field says: the clear value, or what `open` makes of ciphertext, or nothing. */
export function textOf(row: LocalRow, name: string, open?: OpenField): string {
  const field = row.fields[name];
  if (field === undefined) return '';
  if ('c' in field) return open?.(field) ?? '';
  return typeof field.v === 'string' ? field.v : '';
}

/** The latest the server stamped anything on a row: its own, or any of its fields'. Zero for a row the server has not heard of. */
function stamp(row: LocalRow): number {
  let latest = row.seq;
  for (const field of Object.values(row.fields)) if (field.s > latest) latest = field.s;
  return latest;
}
/** A row the server has not heard of is newer than any it has. */
const newest = (row: LocalRow): number => (row.seq === 0 ? Number.MAX_SAFE_INTEGER : stamp(row));

/** A piece of `text` around where the first of `wanted` is found in it, with no more than `SNIPPET` characters, cut at words where it can be. */
export function snippetOf(text: string, wanted: readonly string[]): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= SNIPPET) return flat;
  const folded = fold(flat);
  // Folding can change a text's length (ß), so the place is found in the folded text and only used as a guess in the original: close enough to show.
  const at = Math.max(0, wanted.map((each) => folded.indexOf(each)).find((each) => each >= 0) ?? 0);
  const start = Math.max(0, Math.min(at - 30, flat.length - SNIPPET));
  const piece = flat.slice(start, start + SNIPPET).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET < flat.length ? '…' : ''}`;
}

export function searchDesk(
  cards: readonly LocalRow[],
  checks: readonly LocalRow[],
  query: string,
  open?: OpenField,
): Hit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  const itemsOf = new Map<string, LocalRow[]>();
  for (const item of checks) {
    if (item.table !== 'desk_check') continue;
    const list = itemsOf.get(item.cardId);
    if (list) list.push(item);
    else itemsOf.set(item.cardId, [item]);
  }

  const hits: Hit[] = [];
  for (const card of cards) {
    if (card.table !== 'desk_card') continue;
    const title = fold(textOf(card, 'title', open));
    const description = textOf(card, 'description', open);
    const folded = { title, description: fold(description) };
    const items = (itemsOf.get(card.id) ?? []).map((item) => ({
      item,
      text: fold(textOf(item, 'title', open)),
    }));

    // Every word must be somewhere on the card: in its title, its description or one of its items.
    const everything = [folded.title, folded.description, ...items.map((each) => each.text)];
    if (!wanted.every((word) => everything.some((text) => text.includes(word)))) continue;

    const matched = items.filter((each) => wanted.some((word) => each.text.includes(word)));
    const where: ('title' | 'description')[] = [];
    if (wanted.some((word) => folded.title.includes(word))) where.push('title');
    if (wanted.some((word) => folded.description.includes(word))) where.push('description');
    hits.push({
      card,
      in: where,
      items: matched.map((each) => each.item),
      snippet: where.includes('description') ? snippetOf(description, wanted) : null,
      changed: Math.max(newest(card), ...matched.map((each) => newest(each.item))),
    });
  }
  return hits.sort(
    (a, b) =>
      b.changed - a.changed ||
      b.card.createdAt - a.card.createdAt ||
      (a.card.id < b.card.id ? -1 : 1),
  );
}

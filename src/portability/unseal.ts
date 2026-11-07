import { CipherError } from '../cipher/errors';
import { importListKey, openField } from '../cipher/field';
import { unwrapListKey } from '../cipher/list-key';
import type { LocalRow } from '../local/rows';
import type { DeskPart, SealedDeskPart } from './format';
import { buildDesk } from './format';

/**
 * Opening a sealed Desk from a file (DESIGN.md §9.4, §21.3), in the browser, with the person's key. **Without the right key it says so, and writes nothing:**
 * `wrong_key` when none of the lists' keys is this identity's, which is told apart from `unreadable` for a file whose rows do not open under keys that do.
 * What comes out is a Desk like any other, which is imported by `importDesk` under new ids and sealed again under new keys by the Desk it goes into.
 */
export type Unsealed =
  | { readonly ok: true; readonly desk: DeskPart }
  | { readonly ok: false; readonly reason: 'wrong_key' | 'unreadable' };

type Row = { id: string; fields: Record<string, { c: string } | { v: string }> };

export async function unsealDesk(
  sealed: SealedDeskPart,
  identity: string | CryptoKey,
): Promise<Unsealed> {
  const keys = new Map<string, CryptoKey>();
  let wrong = 0;
  for (const list of sealed.lists) {
    const wrapped = list.fields.key;
    if (!wrapped || !('v' in wrapped)) return { ok: false, reason: 'unreadable' };
    try {
      keys.set(list.id, await importListKey(await unwrapListKey(wrapped.v, identity)));
    } catch (error) {
      if (!(error instanceof CipherError)) throw error;
      if (error.kind === 'wrong_key') wrong += 1;
      else return { ok: false, reason: 'unreadable' };
    }
  }
  // A key that opens none of the lists is not this Desk's. One that opens some and not others is a file that is not whole.
  if (sealed.lists.length > 0 && wrong === sealed.lists.length)
    return { ok: false, reason: 'wrong_key' };
  if (wrong > 0) return { ok: false, reason: 'unreadable' };

  const everyKey = [...keys.values()];
  const listOfCard = new Map(sealed.cards.map((card) => [card.id, card.listId]));

  /** The fields of a row, opened under its list's key, or under another list's: a card moved while another device edited it is sealed under two (§9.2). */
  async function open(table: string, row: Row, listId: string | undefined) {
    const out: Record<string, { v: string | number | boolean | null; s: number }> = {};
    for (const [name, field] of Object.entries(row.fields)) {
      if ('v' in field) continue;
      const binding = { table, id: row.id, field: name };
      const own = listId === undefined ? undefined : keys.get(listId);
      let value: string | number | boolean | null | undefined;
      for (const key of [...(own ? [own] : []), ...everyKey.filter((each) => each !== own)]) {
        try {
          value = await openField(key, field.c, binding);
          break;
        } catch (error) {
          if (!(error instanceof CipherError)) throw error;
        }
      }
      if (value === undefined) return undefined;
      out[name] = { v: value, s: 0 };
    }
    return out;
  }

  const base = { deletedAt: null, seq: 0, createdAt: 0 } as const;
  const rows = {
    lists: [] as LocalRow[],
    cards: [] as LocalRow[],
    checks: [] as LocalRow[],
    series: [] as LocalRow[],
  };
  for (const list of sealed.lists) {
    const fields = await open('desk_list', list, list.id);
    if (!fields) return { ok: false, reason: 'unreadable' };
    rows.lists.push({
      ...base,
      table: 'desk_list',
      id: list.id,
      position: list.position,
      fields,
    } as LocalRow);
  }
  for (const card of sealed.cards) {
    const fields = await open('desk_card', card, card.listId);
    if (!fields) return { ok: false, reason: 'unreadable' };
    rows.cards.push({
      ...base,
      table: 'desk_card',
      id: card.id,
      listId: card.listId,
      position: card.position,
      fields,
    } as LocalRow);
  }
  for (const item of sealed.checks) {
    const fields = await open('desk_check', item, listOfCard.get(item.cardId));
    if (!fields) return { ok: false, reason: 'unreadable' };
    rows.checks.push({
      ...base,
      table: 'desk_check',
      id: item.id,
      cardId: item.cardId,
      position: item.position,
      fields,
    } as LocalRow);
  }
  for (const each of sealed.series) {
    const fields = await open('desk_series', each, each.listId);
    if (!fields) return { ok: false, reason: 'unreadable' };
    rows.series.push({
      ...base,
      table: 'desk_series',
      id: each.id,
      listId: each.listId,
      fields,
    } as LocalRow);
  }
  return { ok: true, desk: buildDesk(rows) };
}

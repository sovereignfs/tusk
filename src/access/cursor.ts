import { uuid } from './parse';

/**
 * The cursor of a page read newest first (`beforeAt` and `beforeId`): the time and id of the last row of the page before. Both or neither; a half, or one
 * that is not a time and an id, is a bad request (`bad`), so that a cursor can only ever name a row by its own two keys. Pure.
 */
export type Cursor = { createdAt: number; id: string } | undefined;

export function parseCursor(params: URLSearchParams): { ok: true; before: Cursor } | { ok: false } {
  const at = params.get('beforeAt');
  const id = uuid(params.get('beforeId'));
  if (at === null && !params.has('beforeId')) return { ok: true, before: undefined };
  if (at === null || !/^\d{1,16}$/.test(at) || !id.ok) return { ok: false };
  return { ok: true, before: { createdAt: Number(at), id: id.value } };
}

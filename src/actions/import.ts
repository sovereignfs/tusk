import type { Change, Mutation } from '../sync/format';
import type { Ids } from './lists';

export type { Ids };

/** Most changes in one mutation: well under the server's limit, so that a group, which is never split, has room. */
const CHUNK = 400;

/**
 * Mutations of groups of changes, in order, **none of which splits a group**: a card with its checklist, or a list on its own. A group is never larger
 * than a mutation holds (a card has at most 200 items). Order is kept, so that what a later group points at is made by an earlier one or the same.
 */
export function chunkedChanges(ids: Ids, groups: readonly (readonly Change[])[]): Mutation[] {
  const mutations: Mutation[] = [];
  let current: Change[] = [];
  for (const group of groups) {
    if (current.length > 0 && current.length + group.length > CHUNK) {
      mutations.push({ mutationId: ids.newId(), changes: current });
      current = [];
    }
    current.push(...group);
  }
  if (current.length > 0) mutations.push({ mutationId: ids.newId(), changes: current });
  return mutations;
}

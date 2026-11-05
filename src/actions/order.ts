import type { LocalRow } from '../local/rows';
import { between } from '../position';

/**
 * Putting a row in order among others (DESIGN.md §11.3, §15.8): the one rule for lists, tasks and subtasks. **A drag is worked out against what is on
 * the screen**, never against every row there is, since a filter, a sort, a deleted row and the pin to the top all make the two differ; the position it
 * lands on is between the two rows it was dropped between, which are the only rows it needs to know about, and **one row is written**.
 */
export interface Neighbours {
  /** The row it is to sit below, or none if it is to be the first shown. */
  above: LocalRow | undefined;
  /** The row it is to sit above, or none if it is to be the last shown. */
  below: LocalRow | undefined;
}

/**
 * Who the neighbours of `id` are once it has been moved to `toIndex` among `rendered` (the index it has afterwards, as `arrayMove` gives it), or
 * undefined if it is not there or is already where it is asked to go.
 */
export function neighboursAfterMove(
  rendered: readonly LocalRow[],
  id: string,
  toIndex: number,
): Neighbours | undefined {
  const from = rendered.findIndex((row) => row.id === id);
  if (from === -1) return undefined;
  const index = Math.max(0, Math.min(toIndex, rendered.length - 1));
  if (index === from) return undefined;
  const others = rendered.filter((row) => row.id !== id);
  return { above: others[index - 1], below: others[index] };
}

const keyOf = (row: LocalRow | undefined): string | null =>
  row && 'position' in row ? row.position : null;

/** The position between two neighbours. It does not throw for equal keys, which two devices can make, or for one that is not a position. */
export function positionBetween({ above, below }: Neighbours): string {
  return between(keyOf(above), keyOf(below));
}

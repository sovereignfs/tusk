import { reopenOccurrence } from '../actions/occurrences';
import type { ActionResult } from '../actions/lists';
import { seriesIdOf } from '../actions/series';
import type { LocalRow } from '../local/rows';
import { checksOf, getRow, occurrencesOf } from '../local/store';
import type { SyncClient } from '../sync/client';

const ids = { newId: () => crypto.randomUUID() };

/**
 * Reopens a done card as the screens do (DESIGN.md §12.5): a card that repeats is read with its series, its own checklist and the other occurrences, so
 * that the next one is taken away if it is untouched and the card leaves the series if it is not. For a card that does not repeat it is a plain reopening.
 */
export async function reopenFor(client: SyncClient, card: LocalRow): Promise<ActionResult> {
  const seriesId = seriesIdOf(card);
  const { series, items, others } = await client.read(async (db) => ({
    series: seriesId ? await getRow(db, 'desk_series', seriesId) : undefined,
    items: seriesId ? await checksOf(db, card.id) : [],
    others: seriesId ? await occurrencesOf(db, seriesId) : [],
  }));
  return reopenOccurrence(card, series, items, others, ids);
}

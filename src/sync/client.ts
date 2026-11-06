import { deleteCard } from '../actions/cards';
import { duplicateOccurrences } from '../actions/series';
import type { LocalDatabase } from '../local/db';
import type { LocalRow } from '../local/rows';
import {
  type Refusal,
  type Settled,
  allChecksOf,
  commitMutation,
  lastSyncedAt,
  outboxSize,
  readCursor,
  readOutbox,
  settle,
  startSnapshot,
} from '../local/store';
import { LIMITS, type Mutation, PROTOCOL_VERSION } from './format';
import type { Transport } from './transport';
import { parseMutation } from './validate';

/**
 * A device's side of sync for one account (DESIGN.md §8): **commit** a mutation to the working copy and the outbox, **sync** the outbox to the server
 * and take what it answers, and tell whoever is listening that something changed. It is made of a database, a transport and a clock, all given, so
 * that a test makes devices out of them and no real network or time is involved.
 *
 * Nothing here is awaited by a screen: a screen calls `commit`, which finishes when the working copy has the change, and reads the working copy. It
 * never waits for `sync`, and nothing in the UI depends on one having happened (AGENTS.md).
 */
/** The first page of a snapshot (DESIGN.md §8.5): small, so that the first list can be drawn while the rest arrives. */
export const FIRST_PAGE = 100;

export class InvalidMutation extends Error {
  constructor(readonly reason: string) {
    super(`not a mutation: ${reason}`);
    this.name = 'InvalidMutation';
  }
}

export type SyncOutcome =
  | { status: 'synced' }
  | { status: 'offline' }
  | { status: 'signed-out' }
  | { status: 'update-required' }
  | { status: 'account-deleted' }
  | { status: 'rate-limited'; retryAfterMs: number }
  | { status: 'error' };

export interface SyncClientOptions {
  db: LocalDatabase;
  transport: Transport;
  now?: () => number;
  /** Told when something other than this client changed the working copy: another tab (`BroadcastChannel`), for the loop and for the screens. */
  channel?:
    | Pick<BroadcastChannel, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'>
    | undefined;
  /** The most rounds of one `sync()`: a device with a very long way to catch up goes on at the next trigger. */
  maxRounds?: number;
}

export class SyncClient {
  private readonly listeners = new Set<() => void>();
  private readonly writeListeners = new Set<() => void>();
  private readonly refusalListeners = new Set<(refusals: Refusal[]) => void>();
  private readonly now: () => number;
  private readonly onChannel = (event: Event) => {
    this.emit();
    if ((event as MessageEvent).data?.type === 'write') this.emitWrites();
  };

  constructor(private readonly options: SyncClientOptions) {
    this.now = options.now ?? Date.now;
    options.channel?.addEventListener('message', this.onChannel);
  }

  get db(): LocalDatabase {
    return this.options.db;
  }

  /**
   * Applies a mutation to the working copy and queues it, as one write. It is checked first with the rules the server will use, so that a mutation
   * that would be refused is a bug found here and never queued. Resolves when the change is in the working copy, which is when a screen can show it.
   */
  async commit(mutation: unknown): Promise<void> {
    const parsed = parseMutation(mutation);
    if (!parsed.ok) throw new InvalidMutation(parsed.reason);
    await commitMutation(this.options.db, parsed.value, this.now());
    this.announce('write');
  }

  /** Calls `listener` when the working copy changes, in this tab or in another. Returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Calls `listener` when a mutation was written, in this tab or another: what the sync loop waits for. **Not when a sync ended**, which changes the
   * working copy too but gives the loop nothing to send, and which it would otherwise answer with another sync, for ever.
   */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }

  /** Calls `listener` with the changes the server refused, which have been undone locally and which the person is to be told of. */
  onRefused(listener: (refusals: Refusal[]) => void): () => void {
    this.refusalListeners.add(listener);
    return () => this.refusalListeners.delete(listener);
  }

  /** Reads the working copy: a query from `src/local/store.ts`, run against this client's database. */
  read<T>(query: (db: LocalDatabase) => Promise<T>): Promise<T> {
    return query(this.options.db);
  }

  /**
   * Whether this device has ever heard from the server. Until it has, a new device has nothing to show, and the app can say it is loading; after it,
   * never: a device that has synced once paints from its own copy at once, on any network (DESIGN.md §8.5).
   */
  async hasSynced(): Promise<boolean> {
    return (await lastSyncedAt(this.options.db)) !== undefined;
  }

  /** The number of changes waiting to be sent. */
  pending(): Promise<number> {
    return outboxSize(this.options.db);
  }

  /**
   * Sends the outbox and takes the answer, and again while there is more to send or to take, up to `maxRounds`. **Never throws for the network**:
   * what went wrong is the outcome, and the outbox is left as it was, so that the next try sends the same.
   */
  async sync(): Promise<SyncOutcome> {
    const rounds = this.options.maxRounds ?? 200;
    for (let round = 0; round < rounds; round++) {
      const sent = await readOutbox(this.options.db, LIMITS.mutationsPerRequest);
      const cursor = await readCursor(this.options.db);
      const result = await this.options.transport({
        protocol: PROTOCOL_VERSION,
        cursor,
        mutations: sent.map((entry) => entry.mutation),
        // A device with nothing asks for a small first page, so that something is on the screen at once; the pages after it are the usual size.
        ...(cursor === 0 ? { limit: FIRST_PAGE } : {}),
      });

      if (result.kind === 'offline') return { status: 'offline' };
      if (result.kind === 'signed-out') return { status: 'signed-out' };
      if (result.kind === 'update-required') return { status: 'update-required' };
      if (result.kind === 'account-deleted') return { status: 'account-deleted' };
      if (result.kind === 'snapshot-required') {
        // Too far behind for a pull: start again from nothing, keeping what is shown and the outbox, and ask again at once.
        await startSnapshot(this.options.db, crypto.randomUUID());
        continue;
      }
      if (result.kind === 'rate-limited')
        return { status: 'rate-limited', retryAfterMs: result.retryAfterMs };
      if (result.kind === 'error') return { status: 'error' };

      const { response } = result;
      const settled: Settled = await settle(
        this.options.db,
        sent,
        response.results,
        response.pull,
        this.now(),
      );
      this.announce('synced');
      // What was pulled can hold two open occurrences of one series (§8.4); this device deletes the later, as every device does.
      if (response.pull.rows.length > 0) await this.resolveOccurrences();
      if (settled.refused.length > 0)
        for (const listener of this.refusalListeners) listener(settled.refused);

      // Another round if the server has more for us, or we sent a full request and may have more to send; stop when neither moves.
      const fullRequest = sent.length >= LIMITS.mutationsPerRequest;
      if (!settled.more && !fullRequest) return { status: 'synced' };
      if (settled.answered === 0 && !settled.more) return { status: 'synced' };
    }
    return { status: 'synced' };
  }

  /**
   * **Two open occurrences of one series** arrive when two devices complete the same one on different days (DESIGN.md §8.4, §12.1). Whichever sees both
   * deletes the later by the rule in `duplicateOccurrences`, which every device applies alike, so they end with the same one. A card deleted that way can be
   * brought back like any other.
   */
  private async resolveOccurrences(): Promise<void> {
    const db = this.options.db;
    const cards = (await db.getAll('desk_card')) as LocalRow[];
    const ids = { newId: () => crypto.randomUUID() };
    for (const id of duplicateOccurrences(cards)) {
      const card = cards.find((each) => each.id === id);
      const result = deleteCard(card, ids, await allChecksOf(db, id));
      if (result.ok) await this.commit(result.mutation);
    }
  }

  /** Stops listening to other tabs. The working copy is left as it is. */
  close(): void {
    this.options.channel?.removeEventListener('message', this.onChannel);
    this.listeners.clear();
    this.writeListeners.clear();
    this.refusalListeners.clear();
  }

  private announce(type: 'write' | 'synced'): void {
    this.emit();
    if (type === 'write') this.emitWrites();
    this.options.channel?.postMessage({ type });
  }

  private emitWrites(): void {
    for (const listener of this.writeListeners) listener();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export type { Mutation };

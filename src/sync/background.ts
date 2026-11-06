/**
 * Background Sync (DESIGN.md §8.3, §8.6), where the browser has it. A write made with no network asks the service worker to be woken when the connection
 * is back (`register`), and the worker, when it wakes, tells the pages that are open to sync (`onWake`), which they do through the loop that already
 * holds the lock for the account. **It wakes a page and does not sync on its own:** a worker has none of the working copy's code, so with every page
 * closed the changes wait for the next time Tusk is opened. Where there is no Background Sync (Safari), the loop's own triggers do the work while a page
 * is open: a write, being back online, the window coming forward, and every few minutes.
 */
export const SYNC_TAG = 'tusk-sync';
export const SYNC_MESSAGE = 'tusk-sync';

interface SyncManager {
  register(tag: string): Promise<void>;
}

/** Asks to be woken when the network is back. Nothing happens, and nothing is wrong, where the browser does not offer it. */
export function registerBackgroundSync(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => {
      const manager = (registration as ServiceWorkerRegistration & { sync?: SyncManager }).sync;
      return manager?.register(SYNC_TAG);
    })
    .catch(() => undefined);
}

/** Calls `listener` when the worker wakes for a sync. Returns the way to stop. */
export function onWake(listener: () => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
  const handle = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === SYNC_MESSAGE) listener();
  };
  navigator.serviceWorker.addEventListener('message', handle);
  return () => navigator.serviceWorker.removeEventListener('message', handle);
}

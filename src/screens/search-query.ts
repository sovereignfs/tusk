import { useSyncExternalStore } from 'react';

/**
 * The Desk's search text (DESIGN.md §10.7), kept in the address as **a fragment**, `/desk#q=milk`, and not a query string. **A fragment is never sent**: the
 * browser keeps it, so what a person searches for does not reach the server, its logs or a proxy's access log, which matters most for a Desk that has a key of
 * its own and whose whole point is that the server cannot read it (`AGENTS.md`: no title, description or comment reaches a log). A query string is sent with
 * every request for the page, on a reload and on a link followed, and in the one that opens the Desk from another page. The address still names the search, so that
 * a reload and the back button keep it.
 */
/** The text a fragment holds, or nothing: it is `#q=` and then the encoded text. */
export function queryOf(hash: string): string {
  const match = /^#q=(.*)$/.exec(hash);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return '';
  }
}

/** The address of the Desk showing this search: the Desk itself for none. */
export function addressOf(text: string): string {
  return text.trim() === '' ? '/desk' : `/desk#q=${encodeURIComponent(text)}`;
}

/**
 * The text being searched for is held here, and the address is its mirror: set by typing, and read back from the address when the person goes back or forward
 * or edits it. (It cannot be read from the address alone: a navigation to `/desk#q=…` from another page renders the Desk before the browser's address has been
 * updated, and no event follows for a fragment that was there when the page came, so the Desk would never see it.)
 */
let current: string | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const fromAddress = () => {
  current = queryOf(window.location.hash);
  emit();
};

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('hashchange', fromAddress);
  window.addEventListener('popstate', fromAddress);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener('hashchange', fromAddress);
      window.removeEventListener('popstate', fromAddress);
    }
  };
}

/** What is being searched for now. The server renders no search: it knows nothing of the fragment. */
export function useSearchQuery(): string {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= queryOf(window.location.hash)),
    () => '',
  );
}

/** Says what is being searched for, and tells what reads it; the caller puts it in the address. */
export function setQuery(text: string): void {
  current = text;
  emit();
}

/** Replaces the address in place (the back button is not a step for each letter). */
export function replaceQuery(text: string): void {
  setQuery(text);
  window.history.replaceState(null, '', addressOf(text));
}

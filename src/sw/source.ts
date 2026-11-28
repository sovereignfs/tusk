/**
 * The service worker (DESIGN.md §17.9), as the text served at `/sw.js`. It is a string and not a module because a worker is its own script, with no
 * bundler between it and the browser; it is written here, with a version and the build's files put in, so that a test evaluates the very text that is
 * served.
 *
 * **What it keeps, and nothing else:** the build's own files (the allow-list `files`, all under `/_next/static/`, the same for everyone), the icons and the
 * manifest, and **the one shell page, `/shell`**, which holds nothing of a person: who is signed in is read from the device by the page itself. Every other
 * request, every API answer, every board, the Inbox, Settings and every page with a person's data goes to the network and is never stored.
 *
 * The worker is the suite's, from `@sovereignfs/pwa`, with Tusk's version, cache name, built files and shell; what the package has no way to say yet
 * (Background Sync, Web Push and the wake) is added after its text, and goes to the package with Sovereign tasks 20.2 (`sync`) and 19.7 (push).
 *
 * **With no network,** or none in time, every address is answered with the kept shell page, which carries the policy and the nonce it was sent with (the
 * headers are kept with the body, so the two agree), and which starts the Desk from the device's own copy, or says that any other address needs a
 * connection (`OfflineApp`). Before a shell is kept, the package's own page says the app is offline. A new version waits until a page asks it to take
 * over, which the registration does when the person chooses Reload.
 *
 * **A wake** (task 14.6) is the one push that is not shown as it came: for a Desk sealed with a key of the person's own the server can only say that something is due, so the
 * worker looks for itself. It reads the Desk's working copy from IndexedDB (read-only, and never made if it is not there), opens the fields it needs with the list keys the
 * page gave it for this (`src/reminders/wake.ts`, a place of its own, kept only if the person chose it on this device), and shows the card or how many cards are due, or that
 * nothing is after all. Where it cannot (no keys, a Desk it cannot open, a browser without IndexedDB) it shows what the server sent: that cards are due. It stores nothing.
 */
import { serviceWorkerSource } from '@sovereignfs/pwa';
import { LOCAL_VERSION } from '../local/db';
import { WAKE_DB, WAKE_KEY, WAKE_STORE, WAKE_VERSION } from '../reminders/wake';

export const CACHE_PREFIX = 'tusk-shell-';

/** Tusk's additions to the package's worker: Background Sync, Web Push and the wake. */
function tuskAdditions(): string {
  return `
// Background Sync: the browser wakes the worker when a connection is back after a write made without one. The worker has none of the working copy's code,
// so it wakes the pages that are open, which sync through their own loop; with none open the changes wait for the next time Tusk is opened.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'tusk-sync') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pages) => {
      for (const page of pages) page.postMessage({ type: 'tusk-sync' });
    }),
  );
});

// Web Push (DESIGN.md §25.2): the push service wakes the worker, and it shows what it was sent, which is a title, a body and where choosing it goes. Nothing is read from a
// cache or put in one: what arrives is shown and is not kept, and a page with a person's data is never fetched here.
function ownPath(path) {
  // An address of this app and no other: a path, never one that begins with two slashes (which is another site's).
  return typeof path === 'string' && /^\\/(?!\\/)[^\\s]*$/.test(path) ? path : '/';
}

// Reading what a wake needs, with no library: the Desk's working copy and the record of keys, opened only if they are there (an open that would make one is aborted).
const LOCAL_VERSION = ${LOCAL_VERSION};
const WAKE_DB = ${JSON.stringify(WAKE_DB)};
const WAKE_VERSION = ${WAKE_VERSION};
const WAKE_STORE = ${JSON.stringify(WAKE_STORE)};
const WAKE_KEY = ${JSON.stringify(WAKE_KEY)};
/** A card was due in the last hour and a half, or it is not a reminder that is still worth showing. */
const WAKE_LATE_MS = 90 * 60 * 1000;
const UNREADABLE = { unreadable: true };

function openExisting(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

function readStore(db, store, key) {
  return new Promise((resolve, reject) => {
    const request = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesOf(text) {
  const plain = text.split('-').join('+').split('_').join('/');
  const raw = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** A field of a card, opened: plain as it is, sealed under one of the keys, and UNREADABLE when none opens it (the same form as src/cipher/field.ts). */
async function fieldOf(keys, card, name) {
  const field = card.fields && card.fields[name];
  if (!field) return null;
  if ('v' in field) return field.v;
  if (!('c' in field) || typeof field.c !== 'string') return UNREADABLE;
  let bytes;
  try {
    bytes = bytesOf(field.c);
  } catch (error) {
    return UNREADABLE;
  }
  if (bytes[0] !== 1 || bytes.length < 29) return UNREADABLE;
  const aad = new TextEncoder().encode(JSON.stringify(['tusk-field', 1, 'desk_card', card.id, name]));
  for (const key of keys) {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: aad }, key, bytes.slice(13));
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (error) {
      // Not this key's: the next.
    }
  }
  return UNREADABLE;
}

/** The date and time as 'YYYY-MM-DD HH:MM' in a zone, which sorts as the moments do. */
function localKey(zone, ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => (parts.find((part) => part.type === type) || { value: '' }).value;
  return get('year').padStart(4, '0') + '-' + get('month') + '-' + get('day') + ' ' + get('hour') + ':' + get('minute');
}

/**
 * The titles of the cards that came due just now, in the order they did: an array, empty if none did. **null when it cannot be told**: no record of keys, no copy of the Desk,
 * or a card that is not open to it and might be one of them. It never says "none" for what it could not read.
 */
async function dueNow() {
  const wake = await openExisting(WAKE_DB, WAKE_VERSION).then(async (db) => {
    try {
      return await readStore(db, WAKE_STORE, WAKE_KEY);
    } finally {
      db.close();
    }
  });
  if (!wake || !wake.accountId || !wake.zone || !wake.keys || wake.keys.length === 0) return null;
  const now = Date.now();
  const upper = localKey(wake.zone, now);
  const lower = localKey(wake.zone, now - WAKE_LATE_MS);
  const db = await openExisting('tusk-desk-' + wake.accountId, LOCAL_VERSION);
  let lists;
  let cards;
  try {
    lists = await readStore(db, 'desk_list');
    cards = await readStore(db, 'desk_card');
  } finally {
    db.close();
  }
  const live = new Set(lists.filter((list) => list.deletedAt === null).map((list) => list.id));
  const due = [];
  let unreadable = false;
  for (const card of cards) {
    if (card.deletedAt !== null || !live.has(card.listId)) continue;
    const completed = await fieldOf(wake.keys, card, 'completedAt');
    if (completed === UNREADABLE) {
      unreadable = true;
      continue;
    }
    if (completed) continue;
    const date = await fieldOf(wake.keys, card, 'dueDate');
    const time = await fieldOf(wake.keys, card, 'dueTime');
    if (date === UNREADABLE || time === UNREADABLE) {
      unreadable = true;
      continue;
    }
    if (typeof date !== 'string' || typeof time !== 'string') continue;
    const at = date + ' ' + time;
    if (at > upper || at < lower) continue;
    const title = await fieldOf(wake.keys, card, 'title');
    due.push({ at, title: typeof title === 'string' && title !== '' ? title : 'A card' });
  }
  if (due.length === 0 && unreadable) return null;
  due.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return due.map((each) => each.title);
}

function cut(text, most) {
  return text.length <= most ? text : text.slice(0, most - 1) + '…';
}

/** A wake: shows the card, or how many, or that none is, or (where it cannot tell) what the server said. Always shows something: a push that shows nothing is one a browser stops allowing. */
async function wake(data) {
  let titles = null;
  try {
    titles = await dueNow();
  } catch (error) {
    titles = null;
  }
  const options = { icon: '/icons/icon-192.png', data: { path: '/desk' } };
  if (typeof data.key === 'string') options.tag = data.key.slice(0, 100);
  let title;
  if (titles === null) {
    title = typeof data.title === 'string' && data.title !== '' ? cut(data.title, 200) : 'You have cards due';
  } else if (titles.length === 0) {
    title = 'Nothing due after all';
  } else if (titles.length === 1) {
    title = cut(titles[0], 200);
    options.body = 'Due now';
  } else {
    title = titles.length + ' cards due';
    options.body = cut(titles.join(', '), 500);
  }
  await self.registration.showNotification(title, options);
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  if (typeof data !== 'object' || data === null) data = {};
  if (data.kind === 'wake') {
    event.waitUntil(wake(data));
    return;
  }
  const title = typeof data.title === 'string' && data.title !== '' ? data.title.slice(0, 200) : 'Tusk';
  const options = { icon: '/icons/icon-192.png', data: { path: ownPath(data.path) } };
  if (typeof data.body === 'string') options.body = data.body.slice(0, 500);
  // A notice shown twice (a retry) replaces itself.
  if (typeof data.key === 'string') options.tag = data.key.slice(0, 100);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = self.location.origin + ownPath(event.notification.data && event.notification.data.path);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (pages) => {
      for (const page of pages) {
        if (new URL(page.url).origin !== self.location.origin || !('focus' in page)) continue;
        const focused = await page.focus();
        if (focused && 'navigate' in focused) {
          try {
            await focused.navigate(url);
          } catch (error) {
            // A window that cannot be sent there stays where it is.
          }
        }
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});

`;
}

export function workerSource(version: string, files: readonly string[] = []): string {
  return (
    serviceWorkerSource({
      version,
      cachePrefix: CACHE_PREFIX,
      precache: files,
      shell: '/shell',
      // The design system's grey 900 and white, as the manifest's colours are.
      offlineColors: { light: ['#ffffff', '#18181b'], dark: ['#18181b', '#fafafa'] },
    }) + tuskAdditions()
  );
}

/**
 * The worker for a server that is not a production build (`next dev`): it keeps nothing, and removes itself and the caches of any other. A worker that kept
 * files there would show yesterday's code, since a development server's files do not change their names when they change.
 */
export function inertWorkerSource(): string {
  return `'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(${JSON.stringify(CACHE_PREFIX)})).map((name) => caches.delete(name))))
      .then(() => self.registration.unregister()),
  );
});
`;
}

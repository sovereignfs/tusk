import { fromBase64Url, toBase64Url } from './base64';
import { CipherError } from './errors';

/**
 * What a device keeps so that a key is asked for once (DESIGN.md §9.2), as primitives; where it is kept is task 14.2's.
 *
 * **Where the platform can store a non-extractable X25519 key in IndexedDB, that is what a device keeps** (`identityCryptoKey`): script can use it and cannot
 * read it. **Where it cannot, it is this:** the identity sealed under an AES-GCM key that is itself non-extractable (which every browser stores), so that
 * what is written to disk is not the key. That gives up less than it seems and more than it should: script on the page can ask the device key to open the
 * identity, so a script that runs in the page can take it, as it could use the other kind; and what a person who copies the profile off the disk finds is
 * both halves. `canStoreX25519` is how a device finds out which it is.
 */
const AAD = new TextEncoder().encode('tusk-device-identity-v1');
const IV_BYTES = 12;

export function newDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealIdentity(identity: string, deviceKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      deviceKey,
      new TextEncoder().encode(identity),
    ),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return toBase64Url(out);
}

export async function openIdentity(sealed: string, deviceKey: CryptoKey): Promise<string> {
  const bytes = fromBase64Url(sealed);
  if (!bytes || bytes.length < IV_BYTES + 16) throw new CipherError('malformed');
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: AAD },
        deviceKey,
        bytes.subarray(IV_BYTES),
      ),
    );
  } catch {
    throw new CipherError('cannot_open');
  }
}

/**
 * Whether this browser stores a non-extractable X25519 key in IndexedDB and gives it back: **Chromium does and WebKit does not** (it stores `null`, without
 * saying so), which is why this is asked and not assumed. It is self-contained, since a test sends its text to a real browser, and it leaves nothing behind.
 */
export async function canStoreX25519(): Promise<boolean> {
  const name = `tusk-probe-${Math.random().toString(36).slice(2)}`;
  try {
    const pkcs8 = new Uint8Array(48);
    pkcs8.set([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04,
      0x20,
    ]);
    pkcs8.set(crypto.getRandomValues(new Uint8Array(32)), 16);
    const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, [
      'deriveBits',
    ]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('k');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('k', 'readwrite');
        tx.objectStore('k').put(key, 'probe');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      const back = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('k').objectStore('k').get('probe');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return back instanceof CryptoKey && back.type === 'private' && !back.extractable;
    } finally {
      db.close();
      indexedDB.deleteDatabase(name);
    }
  } catch {
    return false;
  }
}

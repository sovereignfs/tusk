import { type DBSchema, type IDBPDatabase, deleteDB, openDB } from 'idb';
import { canStoreX25519, newDeviceKey, openIdentity, sealIdentity } from './device';
import { identityCryptoKey } from './identity';

/**
 * Where a device keeps a person's key so that it is asked for once (DESIGN.md §9.2): IndexedDB, **one record per account, in a database of its own** (apart
 * from the working copy, so that the copy can be emptied without asking for the key again, and the key can be forgotten without emptying the copy), until
 * sign-out. **Never a place the server or a service worker can read**, and never `localStorage`. What is kept depends on the platform, as `device.ts` records:
 * the identity as a **non-extractable** X25519 key where the browser stores one (Chromium), and otherwise the identity sealed under a non-extractable
 * AES key (WebKit), which gives up that script on the page could read it.
 */
export type Kept = 'key' | 'sealed';

type Record_ =
  { kind: 'key'; key: CryptoKey } | { kind: 'sealed'; sealed: string; deviceKey: CryptoKey };

interface VaultSchema extends DBSchema {
  identity: { key: string; value: Record_ };
}

const NAME = 'tusk-vault';
let canStore: Promise<boolean> | undefined;

const open = (): Promise<IDBPDatabase<VaultSchema>> =>
  openDB<VaultSchema>(NAME, 1, {
    upgrade(db) {
      db.createObjectStore('identity');
    },
  });

/** Keeps the identity for `accountId` on this device, in the best form the browser stores. The text is the caller's to let go of. */
export async function keepIdentity(accountId: string, identity: string): Promise<Kept> {
  canStore ??= canStoreX25519();
  const db = await open();
  try {
    if (await canStore) {
      await db.put('identity', { kind: 'key', key: await identityCryptoKey(identity) }, accountId);
      return 'key';
    }
    const deviceKey = await newDeviceKey();
    await db.put(
      'identity',
      { kind: 'sealed', sealed: await sealIdentity(identity, deviceKey), deviceKey },
      accountId,
    );
    return 'sealed';
  } finally {
    db.close();
  }
}

/** What opens the account's list keys on this device (the text of the identity, or a key that cannot be read back), or nothing if it has none. */
export async function loadIdentity(accountId: string): Promise<string | CryptoKey | undefined> {
  const db = await open();
  try {
    const record = await db.get('identity', accountId);
    if (!record) return undefined;
    // A record whose key the platform did not keep (`null` where it should be a key) is the same as none: the person is asked again.
    if (record.kind === 'key') return record.key instanceof CryptoKey ? record.key : undefined;
    if (!(record.deviceKey instanceof CryptoKey)) return undefined;
    return await openIdentity(record.sealed, record.deviceKey);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/** Forgets the account's key on this device: at sign-out, and when the person asks. */
export async function forgetKey(accountId: string): Promise<void> {
  const db = await open();
  try {
    await db.delete('identity', accountId);
  } finally {
    db.close();
  }
}

/** Removes the vault itself, for a test. */
export const deleteVault = (): Promise<void> => deleteDB(NAME);

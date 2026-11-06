import 'fake-indexeddb/auto';
import * as age from 'age-encryption';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity } from './identity';
import { deleteVault, forgetKey, keepIdentity, loadIdentity } from './vault';

/** What a device keeps so that a key is asked for once (DESIGN.md §9.2): per account, until forgotten, in whichever form the platform stores. */
afterEach(async () => deleteVault());

describe('the device’s vault', () => {
  it('keeps an account’s key and gives back something that is the same key', async () => {
    const person = await createIdentity();
    const kept = await keepIdentity('ada', person.identity);
    expect(['key', 'sealed']).toContain(kept);
    const back = await loadIdentity('ada');
    expect(back).toBeDefined();
    // Whatever form it is kept in, it is the same key: it makes the same public key.
    expect(await age.identityToRecipient(back as string | CryptoKey)).toBe(person.recipient);
    if (kept === 'key') {
      expect(back).toBeInstanceOf(CryptoKey);
      expect((back as CryptoKey).extractable).toBe(false);
    }
  });

  it('keeps one account’s key apart from another’s, and forgets one without the other', async () => {
    const [ada, grace] = [await createIdentity(), await createIdentity()];
    await keepIdentity('ada', ada.identity);
    await keepIdentity('grace', grace.identity);
    expect(await age.identityToRecipient((await loadIdentity('ada')) as string | CryptoKey)).toBe(
      ada.recipient,
    );
    await forgetKey('ada');
    expect(await loadIdentity('ada')).toBeUndefined();
    expect(await age.identityToRecipient((await loadIdentity('grace')) as string | CryptoKey)).toBe(
      grace.recipient,
    );
    // Forgetting what was never kept is not an error.
    await forgetKey('nobody');
    expect(await loadIdentity('nobody')).toBeUndefined();
  });

  it('replaces a key kept before, and does not hold the secret as text where it can be read', async () => {
    const [one, two] = [await createIdentity(), await createIdentity()];
    await keepIdentity('ada', one.identity);
    await keepIdentity('ada', two.identity);
    expect(await age.identityToRecipient((await loadIdentity('ada')) as string | CryptoKey)).toBe(
      two.recipient,
    );
    // What is on disk is a key that cannot be read back, or the identity sealed: never the text.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('tusk-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('identity').objectStore('identity').get('ada');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(JSON.stringify(record) ?? '').not.toContain('AGE-SECRET-KEY');
  });
});

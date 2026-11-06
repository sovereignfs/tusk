import * as age from 'age-encryption';
import { fromBase64Url, toBase64Url } from './base64';
import { CipherError } from './errors';

/**
 * The key of a Desk list (DESIGN.md §9.2): 32 random bytes that encrypt the fields of the list's cards, **wrapped to the person's age recipient** so that the
 * server can keep it (`list_key`) and cannot open it. age is used for the wrapping alone; its overhead is too much to pay for every field.
 */
export const LIST_KEY_BYTES = 32;

export function newListKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(LIST_KEY_BYTES));
}

/** A list key wrapped to `recipient`, as base64url text (an age file). Anyone with the recipient can wrap; only the identity can open. */
export async function wrapListKey(
  listKey: Uint8Array<ArrayBuffer>,
  recipient: string,
): Promise<string> {
  if (listKey.length !== LIST_KEY_BYTES) throw new CipherError('malformed');
  const encrypter = new age.Encrypter();
  encrypter.addRecipient(recipient);
  return toBase64Url(await encrypter.encrypt(listKey));
}

/**
 * The list key inside `wrapped`. **A key that is not the one it was wrapped to is `wrong_key`,** which is told apart from a value that is not a wrapped
 * key at all (`malformed`), so that a person who gave the wrong key is not told that their data is damaged.
 */
export async function unwrapListKey(
  wrapped: string,
  identity: string | CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromBase64Url(wrapped);
  if (!bytes) throw new CipherError('malformed');
  const decrypter = new age.Decrypter();
  try {
    decrypter.addIdentity(identity);
  } catch {
    throw new CipherError('wrong_key');
  }
  let key: Uint8Array;
  try {
    key = await decrypter.decrypt(bytes);
  } catch (error) {
    // The library says that no identity matched in words; that is the one case that is the key's and not the value's.
    throw new CipherError(
      error instanceof Error && /no identity matched/i.test(error.message)
        ? 'wrong_key'
        : 'malformed',
    );
  }
  if (key.length !== LIST_KEY_BYTES) throw new CipherError('malformed');
  return Uint8Array.from(key);
}

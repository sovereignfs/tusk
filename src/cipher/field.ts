import type { Scalar } from '../sync/format';
import { fromBase64Url, toBase64Url } from './base64';
import { CipherError } from './errors';

/**
 * The cipher of one field (DESIGN.md §9.2): AES-256-GCM under the list's key, with a random 96-bit nonce, and **the table, the row and the field in the
 * authenticated data**, so that the server cannot move a value to another row or field and have it open. The form is base64url (no padding) of
 * `version (1 byte) ‖ nonce (12) ‖ ciphertext ‖ tag (16)`: nothing in it but the alphabet the sync validator takes, and nothing to split on.
 * The version is the form's: a form that changes gets a new number, and an old one still opens.
 */
export interface Binding {
  readonly table: string;
  readonly id: string;
  readonly field: string;
}

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The authenticated data: a JSON array, so that no choice of table, id or field can be read as another. A change here is a change of the form, and is a
 * new version.
 */
export function aadOf(binding: Binding): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify(['tusk-field', VERSION, binding.table, binding.id, binding.field]),
  );
}

/** A list key as a browser key that script cannot read back. */
export function importListKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const isScalar = (value: unknown): value is Scalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

export async function sealField(key: CryptoKey, value: Scalar, binding: Binding): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aadOf(binding) },
      key,
      plaintext,
    ),
  );
  plaintext.fill(0);
  const out = new Uint8Array(1 + NONCE_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(sealed, 1 + NONCE_BYTES);
  return toBase64Url(out);
}

/**
 * The value in `sealed`, if it is the one sealed for this table, row and field under this key. A value that is not in the form is `malformed`; one that is
 * and does not open (changed, moved to another row or field, or sealed under another key) is `cannot_open`: AES-GCM cannot say which, and nothing here pretends to.
 */
export async function openField(key: CryptoKey, sealed: string, binding: Binding): Promise<Scalar> {
  const bytes = fromBase64Url(sealed);
  if (!bytes || bytes[0] !== VERSION || bytes.length < 1 + NONCE_BYTES + TAG_BYTES)
    throw new CipherError('malformed');
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes.subarray(1, 1 + NONCE_BYTES),
          additionalData: aadOf(binding),
        },
        key,
        bytes.subarray(1 + NONCE_BYTES),
      ),
    );
  } catch {
    throw new CipherError('cannot_open');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new CipherError('malformed');
  } finally {
    plaintext.fill(0);
  }
  if (!isScalar(value)) throw new CipherError('malformed');
  return value;
}

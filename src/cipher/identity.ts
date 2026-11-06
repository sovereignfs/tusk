import * as age from 'age-encryption';
import { bech32Decode } from './bech32';
import { CipherError } from './errors';

/**
 * A person's own key (DESIGN.md §9.1): an age X25519 identity, `AGE-SECRET-KEY-1…`, made here or brought from another place (age's own `age-keygen`, or a
 * Fjord identity, which is the same format). It wraps the keys of the lists and does nothing else. **It is made in the browser and the server never sees it.**
 * Only the native X25519 kind is taken: it can be held as a browser key that script cannot read, which the post-quantum kind cannot.
 */
export interface Identity {
  /** The secret, as `AGE-SECRET-KEY-1…`. Shown once to be saved, and otherwise not kept as text. */
  readonly identity: string;
  /** The public part, `age1…`, which the server may hold: it is what a list key is wrapped to. */
  readonly recipient: string;
}

export async function createIdentity(): Promise<Identity> {
  const identity = await age.generateX25519Identity();
  return { identity, recipient: await age.identityToRecipient(identity) };
}

export type ParsedIdentity =
  | ({ readonly ok: true } & Identity)
  | { readonly ok: false; readonly reason: 'empty' | 'not_a_key' | 'unsupported' | 'several' };

/**
 * An identity from a key file or from what was pasted: the file `age-keygen` writes (comments, then the key), or the key alone. A line that begins with `#`
 * is a comment and is not trusted: **the public part is worked out from the secret** and is never read from the file. More than one key, a post-quantum
 * key and anything that is not a key with a good checksum are refused, each for its own reason.
 */
export async function parseIdentity(text: string): Promise<ParsedIdentity> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) return { ok: false, reason: 'empty' };
  if (lines.length > 1) return { ok: false, reason: 'several' };
  const line = lines[0] as string;
  if (/^AGE-SECRET-KEY-PQ-1/i.test(line)) return { ok: false, reason: 'unsupported' };
  const decoded = line.toUpperCase() === line ? bech32Decode(line) : undefined;
  if (!decoded || decoded.hrp !== 'age-secret-key-' || decoded.bytes.length !== 32)
    return { ok: false, reason: 'not_a_key' };
  decoded.bytes.fill(0);
  return { ok: true, identity: line, recipient: await age.identityToRecipient(line) };
}

/** The file to save, in the form `age-keygen` writes, so that the real `age` reads it. */
export function keyFile(key: Identity, now: Date): string {
  const created = now.toISOString().replace(/\.\d+Z$/, 'Z');
  return `# created: ${created}\n# public key: ${key.recipient}\n${key.identity}\n`;
}

/** The PKCS #8 header of an X25519 private key (RFC 8410), before its 32 bytes. */
const PKCS8_X25519 = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

/**
 * The identity as a browser key that **script cannot read back** (`extractable: false`): it can be used to open a wrapped key and cannot be copied out. It is
 * what a device keeps where the platform can store one. The text it was made from is for the caller to let go of.
 */
export async function identityCryptoKey(identity: string): Promise<CryptoKey> {
  const decoded = bech32Decode(identity);
  if (!decoded || decoded.hrp !== 'age-secret-key-' || decoded.bytes.length !== 32)
    throw new CipherError('malformed');
  const pkcs8 = new Uint8Array(PKCS8_X25519.length + 32);
  pkcs8.set(PKCS8_X25519);
  pkcs8.set(decoded.bytes, PKCS8_X25519.length);
  try {
    return await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  } finally {
    pkcs8.fill(0);
    decoded.bytes.fill(0);
  }
}

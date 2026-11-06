/**
 * Why something could not be opened (DESIGN.md §9.2), as a kind and nothing else: **no message, key, value or ciphertext is in it,** since an error is logged
 * and shown. The kinds are what a person is told apart by: a key that is not the one this was made for (`wrong_key`) is a different thing from a value that
 * was changed or moved (`cannot_open`), and from something that is not in the form at all (`malformed`).
 */
export type CipherErrorKind = 'malformed' | 'wrong_key' | 'cannot_open';

export class CipherError extends Error {
  constructor(readonly kind: CipherErrorKind) {
    super(`cipher: ${kind}`);
    this.name = 'CipherError';
  }
}

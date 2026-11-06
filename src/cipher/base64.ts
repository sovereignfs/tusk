/**
 * base64url without padding, for ciphertext and wrapped keys (DESIGN.md §9.2): the alphabet the sync validator accepts for a `{ c }` field, with no `.`
 * or `:` to split on. Works in the browser and in Node, where `btoa` and `atob` are the same.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP)
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

const ALPHABET = /^[A-Za-z0-9_-]*$/;

/** The bytes of base64url text, or `undefined` if it is not that (no padding, no other characters, a length that no bytes have). */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!ALPHABET.test(text) || text.length % 4 === 1) return undefined;
  const padded =
    text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    // Text that is not the canonical form of its bytes (stray bits in the last character) is not accepted: one ciphertext has one spelling.
    return toBase64Url(out) === text ? out : undefined;
  } catch {
    return undefined;
  }
}

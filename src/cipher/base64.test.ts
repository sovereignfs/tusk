import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64';
import { bech32Decode } from './bech32';

describe('base64url', () => {
  it('round trips every length, without padding and with the url alphabet', () => {
    for (let n = 0; n < 70; n += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(fromBase64Url(text) ?? [])).toEqual(Array.from(bytes));
    }
    expect(toBase64Url(Uint8Array.from([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });

  it('handles a large array', () => {
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i += 65_536)
      crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65_536, bytes.length)));
    expect(fromBase64Url(toBase64Url(bytes))?.length).toBe(300_000);
  });

  it('refuses what is not base64url, or is not the one spelling of its bytes', () => {
    for (const bad of ['a', 'abcde', 'ab=', 'ab+/', 'a b', 'ab\n', '😀', 'AB'])
      expect(fromBase64Url(bad), JSON.stringify(bad)).toBeUndefined();
    // Stray bits in the last character: 'QR' and 'QQ' would both decode to 'A'.
    expect(fromBase64Url('QQ')).toBeDefined();
    expect(fromBase64Url('QR')).toBeUndefined();
  });
});

describe('bech32Decode', () => {
  it('reads the BIP-173 vectors and refuses a bad checksum, mixed case and bad characters', () => {
    expect(bech32Decode('A12UEL5L')?.hrp).toBe('a');
    expect(bech32Decode('a12uel5l')?.bytes.length).toBe(0);
    expect(bech32Decode('A12UEL5M')).toBeUndefined();
    expect(bech32Decode('A12uel5l')).toBeUndefined();
    expect(bech32Decode('a12uel5b')).toBeUndefined();
    expect(bech32Decode('nohrp')).toBeUndefined();
    expect(bech32Decode('')).toBeUndefined();
  });
});

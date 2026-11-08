import { describe, expect, it } from 'vitest';
import { keyBytes } from './client';

describe('the application server key', () => {
  it('is the bytes of the URL-safe base64 the server gives', () => {
    // 65 bytes (an uncompressed P-256 point starts with 4): 87 characters of base64url.
    const key = `BA${'A'.repeat(85)}`;
    const bytes = keyBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
  });

  it('reads the URL-safe alphabet, with no padding', () => {
    // "-" and "_" are "+" and "/": 0xfb 0xff is "-_8" in base64url.
    expect([...keyBytes('-_8')]).toEqual([0xfb, 0xff]);
  });
});

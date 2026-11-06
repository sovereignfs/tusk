import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64';
import { type Binding, aadOf, importListKey, openField, sealField } from './field';
import { newListKey } from './list-key';

/**
 * The cipher of one field (DESIGN.md §9.2). **Each part of the binding was seen to fail with it removed** from the authenticated data: the table, the row and
 * the field (see the task's notes); the tests below are the ones that fail.
 */
const here: Binding = {
  table: 'desk_card',
  id: '0b6c7e3a-1d2e-4f50-8a91-5c4d3e2f1a00',
  field: 'title',
};
const key = async () => importListKey(newListKey());

describe('a sealed field', () => {
  it('opens to the value it was sealed from, whatever kind of value it is', async () => {
    const k = await key();
    const values = [
      'Buy milk',
      '',
      '日本語 — naïve 🔐 \u0000 with a null',
      'x'.repeat(10_000),
      0,
      -12.5,
      1_800_000_000_000,
      true,
      false,
      null,
      '2026-11-06',
    ];
    for (const value of values)
      expect(await openField(k, await sealField(k, value, here), here)).toStrictEqual(value);
  });

  it('is base64url of a version, a nonce and a tag, and is different every time for the same value', async () => {
    const k = await key();
    const a = await sealField(k, 'same', here);
    const b = await sealField(k, 'same', here);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = fromBase64Url(a) ?? new Uint8Array();
    expect(bytes[0]).toBe(1);
    // version + nonce + the value's JSON ('"same"' is 6 bytes) + the tag
    expect(bytes.length).toBe(1 + 12 + 6 + 16);
    // The plaintext is nowhere in it.
    const long = fromBase64Url(await sealField(k, 'PLAINTEXT-MARKER', here)) ?? new Uint8Array();
    expect(Buffer.from(long).includes('PLAINTEXT-MARKER')).toBe(false);
  });

  it('does not open in another table, for another row or as another field: the binding', async () => {
    const k = await key();
    const sealed = await sealField(k, 'secret', here);
    for (const moved of [
      { ...here, table: 'desk_check' },
      { ...here, id: '0b6c7e3a-1d2e-4f50-8a91-5c4d3e2f1a01' },
      { ...here, field: 'description' },
    ])
      await expect(openField(k, sealed, moved), JSON.stringify(moved)).rejects.toMatchObject({
        kind: 'cannot_open',
      });
    // And it still opens where it belongs.
    expect(await openField(k, sealed, { ...here })).toBe('secret');
  });

  it('cannot be run together into another binding: a field that ends where another begins is not the same', () => {
    const a = aadOf({ table: 'desk_card', id: 'ab', field: 'c' });
    const b = aadOf({ table: 'desk_card', id: 'a', field: 'bc' });
    const c = aadOf({ table: 'desk_cardab', id: '', field: 'c' });
    expect(new Set([a, b, c].map((x) => Buffer.from(x).toString('hex'))).size).toBe(3);
  });

  it('does not open under another list’s key', async () => {
    const [one, two] = [await key(), await key()];
    await expect(openField(two, await sealField(one, 'x', here), here)).rejects.toMatchObject({
      kind: 'cannot_open',
    });
  });

  it('does not open if any byte of it was changed, or if it is cut short or made longer', async () => {
    const k = await key();
    const sealed = await sealField(k, 'precious words', here);
    const bytes = fromBase64Url(sealed) ?? new Uint8Array();
    for (let i = 1; i < bytes.length; i += 1) {
      const changed = Uint8Array.from(bytes);
      changed[i] = (changed[i] ?? 0) ^ 0x01;
      await expect(openField(k, toBase64Url(changed), here), `byte ${i}`).rejects.toMatchObject({
        kind: 'cannot_open',
      });
    }
    await expect(
      openField(k, toBase64Url(bytes.subarray(0, bytes.length - 1)), here),
    ).rejects.toMatchObject({ kind: 'cannot_open' });
    await expect(
      openField(k, toBase64Url(Uint8Array.from([...bytes, 0])), here),
    ).rejects.toMatchObject({ kind: 'cannot_open' });
  });

  it('is malformed when it is not in the form at all, and the version is checked', async () => {
    const k = await key();
    const sealed = await sealField(k, 'x', here);
    const bytes = fromBase64Url(sealed) ?? new Uint8Array();
    for (const bad of ['', 'not base64!', 'AAAA', toBase64Url(bytes.subarray(0, 20))])
      await expect(openField(k, bad, here), bad).rejects.toMatchObject({ kind: 'malformed' });
    const future = Uint8Array.from(bytes);
    future[0] = 2;
    await expect(openField(k, toBase64Url(future), here)).rejects.toMatchObject({
      kind: 'malformed',
    });
    const zero = Uint8Array.from(bytes);
    zero[0] = 0;
    await expect(openField(k, toBase64Url(zero), here)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('says nothing of the value, the key or the binding in an error', async () => {
    const k = await key();
    const sealed = await sealField(k, 'TOP-SECRET-VALUE', here);
    const error = await openField(k, sealed, { ...here, id: 'other' }).then(
      () => new Error('it opened'),
      (e: unknown) => e as Error,
    );
    const text = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
    expect(text).not.toContain('TOP-SECRET-VALUE');
    expect(text).not.toContain(here.id);
    expect(text).not.toContain(sealed);
  });

  it('can be sent through the sync validator’s alphabet and size rules for the longest field', async () => {
    const k = await key();
    // The longest title is 500 characters of the worst case, four bytes each; the validator allows ((chars * 4 + 256) * 4) / 3 characters.
    const worst = '🔐'.repeat(500);
    const sealed = await sealField(k, worst, here);
    expect(sealed.length).toBeLessThanOrEqual(Math.ceil(((500 * 4 + 256) * 4) / 3));
    expect(sealed).toMatch(/^[A-Za-z0-9+/_-]+={0,2}$/);
    expect(await openField(k, sealed, here)).toBe(worst);
  });

  it('is kept as a browser key that cannot be read back', async () => {
    const k = await key();
    expect(k.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });
});

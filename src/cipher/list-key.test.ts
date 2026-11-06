import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64';
import { createIdentity, identityCryptoKey, keyFile } from './identity';
import { LIST_KEY_BYTES, newListKey, unwrapListKey, wrapListKey } from './list-key';
import { hasAge, run } from './testing';

/** The key of a list, wrapped to a person's recipient (DESIGN.md §9.2): opened by their identity as text or as a browser key, by the real age, and by nobody else. */
describe('a list key', () => {
  it('is 32 random bytes, new each time', () => {
    const a = newListKey();
    expect(a.length).toBe(LIST_KEY_BYTES);
    expect(Array.from(newListKey())).not.toEqual(Array.from(a));
  });

  it('is wrapped to a recipient and opened by the identity, as text or as a browser key that cannot be read back', async () => {
    const person = await createIdentity();
    const key = newListKey();
    const wrapped = await wrapListKey(key, person.recipient);
    expect(wrapped).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(await unwrapListKey(wrapped, person.identity))).toEqual(Array.from(key));
    const browserKey = await identityCryptoKey(person.identity);
    expect(Array.from(await unwrapListKey(wrapped, browserKey))).toEqual(Array.from(key));
    // Wrapped twice, it is two different files that open to the same key.
    expect(await wrapListKey(key, person.recipient)).not.toBe(wrapped);
  });

  it('is told to be the wrong key when another person’s identity is given, apart from a value that is damaged', async () => {
    const [ada, grace] = [await createIdentity(), await createIdentity()];
    const wrapped = await wrapListKey(newListKey(), ada.recipient);
    await expect(unwrapListKey(wrapped, grace.identity)).rejects.toMatchObject({
      kind: 'wrong_key',
    });
    await expect(
      unwrapListKey(wrapped, await identityCryptoKey(grace.identity)),
    ).rejects.toMatchObject({
      kind: 'wrong_key',
    });
    // Not in the form at all, or damaged: malformed, and not the key's fault.
    await expect(unwrapListKey('not base64!', ada.identity)).rejects.toMatchObject({
      kind: 'malformed',
    });
    await expect(unwrapListKey('', ada.identity)).rejects.toMatchObject({ kind: 'malformed' });
    const bytes = fromBase64Url(wrapped) ?? new Uint8Array();
    const cut = toBase64Url(bytes.subarray(0, bytes.length - 8));
    await expect(unwrapListKey(cut, ada.identity)).rejects.toMatchObject({ kind: 'malformed' });
    const flipped = Uint8Array.from(bytes);
    flipped[flipped.length - 3] = (flipped[flipped.length - 3] ?? 0) ^ 1;
    await expect(unwrapListKey(toBase64Url(flipped), ada.identity)).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('is refused when it is not the length of a key, and says nothing of the key or the identity in what it throws', async () => {
    const person = await createIdentity();
    await expect(wrapListKey(new Uint8Array(16), person.recipient)).rejects.toMatchObject({
      kind: 'malformed',
    });
    const error = await unwrapListKey('zzzz', person.identity).then(
      () => new Error('it opened'),
      (e: unknown) => e as Error,
    );
    expect(`${error.message} ${error.stack}`).not.toContain(person.identity);
  });

  it.skipIf(!hasAge)('is a file the real age opens with the identity’s key file', async () => {
    const person = await createIdentity();
    const key = newListKey();
    const wrapped = await wrapListKey(key, person.recipient);
    const dir = mkdtempSync(join(tmpdir(), 'tusk-age-'));
    const file = join(dir, 'key.txt');
    writeFileSync(file, keyFile(person, new Date()));
    const opened = run('age', ['-d', '-i', file], Buffer.from(fromBase64Url(wrapped) ?? []));
    expect(Array.from(opened)).toEqual(Array.from(key));
  });
});

import { build } from 'esbuild';
import { expect, test } from '@playwright/test';

/**
 * The cipher in the browsers that are supported (task 14.1, DESIGN.md §9.2): `src/cipher/` bundled as it would be and run in Chromium and in WebKit, which is
 * Safari's engine. It is not the app that is run but the cryptography alone, so that what a browser cannot do is found here and not by a person with a key.
 * **The first thing found is recorded in the epic:** Chromium stores a non-extractable X25519 key in IndexedDB and gives it back; WebKit stores `null` without
 * saying so, which is why a device asks (`canStoreX25519`) and keeps the identity sealed under a non-extractable AES key where it cannot.
 */
test.use({ viewport: { width: 800, height: 600 } });

let bundle = '';
test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `
        import * as identity from './src/cipher/identity';
        import * as listKey from './src/cipher/list-key';
        import * as field from './src/cipher/field';
        import * as device from './src/cipher/device';
        window.tuskCipher = { ...identity, ...listKey, ...field, ...device };
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  bundle = result.outputFiles[0]?.text ?? '';
});

test('an identity, a list key and a field work from end to end in this browser, and a device keeps a key one way or the other', async ({
  page,
  browserName,
}) => {
  // A real origin, so that IndexedDB is available, with nothing on the page.
  await page.route('https://cipher.test/', (route) =>
    route.fulfill({ body: '<!doctype html><title>cipher</title>', contentType: 'text/html' }),
  );
  await page.goto('https://cipher.test/');
  await page.addScriptTag({ content: bundle });

  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the bundle puts its functions on the window, and this runs in the page
    const c = (window as any).tuskCipher;
    const out: Record<string, unknown> = {};

    const person = await c.createIdentity();
    const parsed = await c.parseIdentity(c.keyFile(person, new Date()));
    out.parsed =
      parsed.ok && parsed.identity === person.identity && parsed.recipient === person.recipient;

    const key = c.newListKey();
    const wrapped = await c.wrapListKey(key, person.recipient);
    const cryptoKey = await c.identityCryptoKey(person.identity);
    out.cryptoKeyHidden = cryptoKey.extractable === false;
    const back = await c.unwrapListKey(wrapped, cryptoKey);
    out.unwrapped = back.length === 32 && back.every((v: number, i: number) => v === key[i]);

    const listKey = await c.importListKey(back);
    const here = { table: 'desk_card', id: 'a', field: 'title' };
    const sealed = await c.sealField(listKey, 'Buy 🍞', here);
    out.opened = (await c.openField(listKey, sealed, here)) === 'Buy 🍞';
    try {
      await c.openField(listKey, sealed, { ...here, id: 'b' });
      out.moved = 'opened';
    } catch (error) {
      out.moved = (error as { kind?: string }).kind;
    }
    const other = await c.createIdentity();
    try {
      await c.unwrapListKey(wrapped, other.identity);
      out.wrongKey = 'opened';
    } catch (error) {
      out.wrongKey = (error as { kind?: string }).kind;
    }

    // What a device keeps: the identity as a key if the browser can store one, else sealed under a key it can.
    out.canStoreX25519 = await c.canStoreX25519();
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('device', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('k');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const put = (k: string, v: unknown) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction('k', 'readwrite');
        tx.objectStore('k').put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    const get = (k: string) =>
      new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('k').objectStore('k').get(k);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    let usable: string | CryptoKey;
    if (out.canStoreX25519) {
      await put('identity', cryptoKey);
      usable = (await get('identity')) as CryptoKey;
      out.kept = 'key';
    } else {
      const deviceKey = await c.newDeviceKey();
      await put('deviceKey', deviceKey);
      await put('sealed', await c.sealIdentity(person.identity, deviceKey));
      usable = await c.openIdentity(
        (await get('sealed')) as string,
        (await get('deviceKey')) as CryptoKey,
      );
      out.kept = 'sealed';
    }
    const again = await c.unwrapListKey(wrapped, usable);
    out.reopened = again.length === 32 && again.every((v: number, i: number) => v === key[i]);
    return out;
  });

  expect(result).toMatchObject({
    parsed: true,
    cryptoKeyHidden: true,
    unwrapped: true,
    opened: true,
    moved: 'cannot_open',
    wrongKey: 'wrong_key',
    reopened: true,
  });
  // Recorded, so that a browser that changes is noticed: Chromium keeps the key itself; where it cannot, the sealed form is what the device uses.
  test.info().annotations.push({
    type: 'device key',
    description: `${browserName}: ${String(result.kept)} (canStoreX25519 = ${String(result.canStoreX25519)})`,
  });
  if (browserName === 'chromium') expect(result.kept).toBe('key');
});

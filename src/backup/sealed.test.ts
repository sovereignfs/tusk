import 'fake-indexeddb/auto';
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createIdentity } from '../cipher/identity';
import { entryOf, ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { beginMove, finishMove, setUpPersonalKey } from '../encryption/state';
import { importDesk } from '../portability/import-desk';
import { validateFile } from '../portability/validate';
import { unsealDesk } from '../portability/unseal';
import { FakeGitHub } from '../providers/testing/fake-github';
import type { RepositoryRef } from '../providers/types';
import { moveToKey } from '../local/migrate';
import { DeskCipher } from '../local/seal';
import { allDeskRows, listsOf } from '../local/store';
import { type Harness, harness, settleAll } from '../sync/sim-support';
import { account, card, check, list, makeStore, mutation } from '../sync/test-support';
import { confirmKey, connectRepository, readConnection } from './connection';
import { type RunDeps, runBackup } from './run';

/**
 * Backing up a Desk that has a key of its own (DESIGN.md §9.4, §21.3): the file is the Desk as the server has it, ciphertext in every field with each list's
 * wrapped key and `"encrypted": true`, and holds nothing in the clear; restoring it needs the key, and puts the Desk into another account under new ids,
 * sealed again. Backups wait while the Desk is moving, and then until the person has confirmed that the files already in the repository stay plain.
 */
const { leg } = testTarget();
const TOKEN = 'github_pat_PLANTED_0123456789_TOKEN';
const ring = ringOf(entryOf(randomBytes(32)).key);
const directory = { profiles: async () => new Map() };
const NOW = Date.parse('2026-11-06T14:30:00Z');

let fake: FakeGitHub;
let database: Database;
let close: () => Promise<void>;
let devices: Harness;
let counter = 0;
beforeAll(async () => {
  fake = await FakeGitHub.start();
  ({ database, close } = await makeStore());
  devices = harness(database);
});
afterAll(async () => {
  await fake.stop();
  await close();
});
beforeEach(() => {
  fake.reset();
  fake.addToken(TOKEN, { write: true });
});
afterEach(async () => devices.dispose());

const deps = (): RunDeps => ({ database, directory, ring, apiUrl: fake.url });
const titleOf = (row: { fields: Record<string, unknown> } | undefined) =>
  (row?.fields.title as { v?: unknown } | undefined)?.v;
async function connect(owner: string) {
  const ref: RepositoryRef = { owner: 'ada', name: `sealed-${(counter += 1)}` };
  await fake.createRepository(ref);
  const result = await connectRepository(
    { database, ring, apiUrl: fake.url, now: () => NOW - 500 },
    owner,
    `${ref.owner}/${ref.name}`,
    TOKEN,
  );
  if (!result.ok) throw new Error(result.problem);
  return ref;
}
const written = async (ref: RepositoryRef) =>
  Object.entries(await fake.files(ref)).filter(([path]) => path.startsWith('tusk/'));

describe(`backing up a Desk with a key of its own (${leg})`, () => {
  it('writes the Desk as ciphertext with its wrapped keys and says so, and holds nothing of what was written', async () => {
    const owner = account();
    const key = await createIdentity();
    expect((await setUpPersonalKey(database, owner, key.recipient, 1)).ok).toBe(true);
    const a = await devices.device(owner, { plain: 'refuse' });
    a.client.setCipher(new DeskCipher(key.identity, key.recipient));
    const home = list({ title: 'Sealed list' });
    const c = card(home.id, {
      fields: { title: { v: 'Sealed card' }, description: { v: 'Sealed words' } },
    });
    await a.client.commit(
      mutation(home, c, check(c.id, { fields: { title: { v: 'Sealed item' } } })),
    );
    await settleAll([a]);

    const ref = await connect(owner);
    // Connected to a Desk that already had a key: there is no plain file to be told about, so it goes straight on.
    expect((await readConnection(database, owner))?.keyConfirmedAt).not.toBeNull();
    const result = await runBackup(deps(), owner, NOW, 'manual');
    if (!result.ok || result.unchanged) throw new Error('not written');
    const [[, content]] = (await written(ref)) as [[string, string]];

    expect(content).not.toContain('Sealed');
    expect(JSON.parse(content)).toMatchObject({ encrypted: true, scope: 'everything' });
    expect(content).not.toContain('"desk"');
    const read = validateFile(content);
    if (!read.ok) throw new Error(read.error);
    expect(read.file.sealedDesk?.lists).toHaveLength(1);
    expect(read.file.sealedDesk?.cards).toHaveLength(1);
    expect(read.file.sealedDesk?.checks).toHaveLength(1);
    // Every field but a list's key is ciphertext, and the list has its wrapped key.
    for (const row of [
      ...(read.file.sealedDesk?.cards ?? []),
      ...(read.file.sealedDesk?.checks ?? []),
    ])
      for (const field of Object.values(row.fields)) expect('c' in field).toBe(true);
    expect(read.file.sealedDesk?.lists[0]?.fields.key).toMatchObject({ v: expect.any(String) });

    // The key opens it, another key says it is the wrong one, and a changed field says it is damaged.
    const sealedPart = read.file.sealedDesk;
    if (!sealedPart) throw new Error('no sealed Desk');
    const opened = await unsealDesk(sealedPart, key.identity);
    expect(opened).toMatchObject({ ok: true });
    if (opened.ok) {
      expect(opened.desk.lists[0]).toMatchObject({ title: 'Sealed list' });
      expect(opened.desk.lists[0]?.cards[0]).toMatchObject({
        title: 'Sealed card',
        description: 'Sealed words',
        checklist: [{ title: 'Sealed item' }],
      });
    }
    expect(await unsealDesk(sealedPart, (await createIdentity()).identity)).toEqual({
      ok: false,
      reason: 'wrong_key',
    });
    const damaged = structuredClone(sealedPart) as unknown as {
      cards: { fields: Record<string, { c: string }> }[];
    };
    const title = damaged.cards[0]?.fields.title;
    if (title) title.c = `${title.c.slice(0, -4)}AAAA`;
    expect(await unsealDesk(damaged as never, key.identity)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('restores into another account that has the key, under new ids and sealed again, and needs the key to', async () => {
    const owner = account();
    const key = await createIdentity();
    await setUpPersonalKey(database, owner, key.recipient, 1);
    const a = await devices.device(owner, { plain: 'refuse' });
    a.client.setCipher(new DeskCipher(key.identity, key.recipient));
    const home = list({ title: 'Restored list' });
    const c = card(home.id, { fields: { title: { v: 'Restored card' } } });
    await a.client.commit(mutation(home, c));
    await settleAll([a]);
    const ref = await connect(owner);
    const done = await runBackup(deps(), owner, NOW, 'manual');
    if (!done.ok || done.unchanged) throw new Error('not written');
    const [[, content]] = (await written(ref)) as [[string, string]];
    const read = validateFile(content);
    if (!read.ok || !read.file.sealedDesk) throw new Error('no sealed Desk');

    // A new account with the same key: opens the file and imports it as it imports any, sealed on its way in.
    const fresh = account();
    await setUpPersonalKey(database, fresh, key.recipient, 1);
    const b = await devices.device(fresh, { plain: 'refuse' });
    b.client.setCipher(new DeskCipher(key.identity, key.recipient));
    const opened = await unsealDesk(read.file.sealedDesk, key.identity);
    if (!opened.ok) throw new Error(opened.reason);
    const imported = importDesk(
      opened.desk,
      { lists: [], listRows: 0, cardRows: 0, checkRows: 0, seriesRows: 0 },
      { newId: () => crypto.randomUUID() },
    );
    if (!imported.ok) throw new Error(imported.reason);
    for (const m of imported.mutations) await b.client.commit(m);
    await settleAll([b]);
    const lists = await b.client.read(listsOf);
    expect(lists.map(titleOf)).toEqual(['Restored list']);
    expect(lists[0]?.id).not.toBe(home.id);
    const rows = await b.client.read(allDeskRows);
    expect(rows.cards.map(titleOf)).toEqual(['Restored card']);
    expect(rows.cards[0]?.id).not.toBe(c.id);
    // And the new account holds none of it in the clear either.
    const { snapshot } = await import('../sync/test-support');
    expect(JSON.stringify(await snapshot(database, fresh))).not.toContain('Restored');
  });

  it('waits while the Desk is moving, then until the person has confirmed what stays readable, and then writes it sealed', async () => {
    const owner = account();
    const key = await createIdentity();
    const a = await devices.device(owner);
    const home = list({ title: 'Plain at first' });
    await a.client.commit(
      mutation(home, card(home.id, { fields: { title: { v: 'Plain card' } } })),
    );
    await settleAll([a]);
    const ref = await connect(owner);
    expect((await readConnection(database, owner))?.keyConfirmedAt).toBeNull();

    // Plain, it writes plain, as it always did.
    const before = await runBackup(deps(), owner, NOW - 60_000, 'manual');
    expect(before.ok).toBe(true);
    expect(await written(ref)).toHaveLength(1);

    await beginMove(database, owner, key.recipient, 1);
    expect(await runBackup(deps(), owner, NOW, 'manual')).toEqual({ ok: false, problem: 'moving' });
    a.client.setCipher(new DeskCipher(key.identity, key.recipient));
    await moveToKey(a.client, {
      finish: async () => ((await finishMove(database, owner)).ok ? 'done' : 'not_moving'),
    });
    expect(await runBackup(deps(), owner, NOW, 'manual')).toEqual({
      ok: false,
      problem: 'key_unconfirmed',
    });
    expect(await written(ref)).toHaveLength(1);

    expect(await confirmKey(database, owner, NOW)).toBe(true);
    const after = await runBackup(deps(), owner, NOW + 61_000, 'manual');
    expect(after.ok).toBe(true);
    const files = await written(ref);
    expect(files).toHaveLength(2);
    // The earlier file is plain and stays; the new one is sealed and has none of it.
    expect(files[0]?.[1]).toContain('Plain card');
    expect(files[1]?.[1]).not.toContain('Plain');
    expect(JSON.parse(files[1]?.[1] ?? '{}')).toMatchObject({ encrypted: true });
  });

  it('refuses a file that says it is sealed and has a field in the clear, and one that is not whole', () => {
    const base = {
      format: 'tusk',
      version: 1,
      exportedAt: '2026-11-06T14:30:00.000Z',
      scope: 'desk',
      encrypted: true,
    };
    const id = () => crypto.randomUUID();
    const wrapped = 'K'.repeat(200);
    const listId = id();
    const good = {
      ...base,
      sealedDesk: {
        lists: [
          {
            id: listId,
            position: 'a0',
            fields: { key: { v: wrapped }, title: { c: 'A'.repeat(40) } },
          },
        ],
        cards: [],
        checks: [],
        series: [],
      },
    };
    expect(validateFile(JSON.stringify(good)).ok).toBe(true);
    const plain = structuredClone(good);
    (plain.sealedDesk.lists[0]?.fields as Record<string, unknown>).title = { v: 'In the clear' };
    expect(validateFile(JSON.stringify(plain)).ok).toBe(false);
    const keyless = structuredClone(good);
    delete (keyless.sealedDesk.lists[0]?.fields as Record<string, unknown>).key;
    expect(validateFile(JSON.stringify(keyless)).ok).toBe(false);
    expect(validateFile(JSON.stringify({ ...good, sealedDesk: undefined })).ok).toBe(false);
    expect(validateFile(JSON.stringify({ ...good, encrypted: 'yes' })).ok).toBe(false);
  });
});

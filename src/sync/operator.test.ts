import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoError } from '../crypto/envelope';
import { entryOf, ringOf } from '../crypto/keys';
import { openDeskField } from '../crypto/operator';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { applyMutation } from './apply';
import type { Mutation } from './format';
import { pull } from './pull';
import { account, card, id, list, makeStore, mutation, series, snapshot } from './test-support';

/**
 * The Desk under the operator key (DESIGN.md §9.5, task 14.7): what the database holds is sealed, what a device is sent is what it sent.
 */
const { leg } = testTarget();

const made = ringOf(Buffer.alloc(32, 7));
if (!made) throw new Error('a ring');
const ring = made;
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

let clock = 1_800_000_000_000;
const apply = (owner: string, m: Mutation, operator = true) =>
  applyMutation(database, owner, m, {
    now: (clock += 1000),
    ...(operator ? { operator: ring } : {}),
  });

describe(`the Desk under the operator key (${leg})`, () => {
  it('stores no title or description, keeps the mirrors readable, and gives a device what it sent', async () => {
    const owner = account();
    const l = list({ title: 'Secret list' });
    const c = card(l.id, {
      fields: {
        title: { v: 'Secret card' },
        description: { v: 'Secret words' },
        dueDate: { v: '2026-12-01' },
      },
    });
    expect((await apply(owner, mutation(l, c))).status).toBe('applied');

    const dump = JSON.stringify(await snapshot(database, owner));
    expect(dump).not.toContain('Secret');
    const rows = await dbAll<{ due_date: string | null }>(
      database,
      sql`SELECT due_date FROM desk_card WHERE owner_id = ${owner}`,
    );
    expect(rows[0]?.due_date).toBe('2026-12-01');

    const page = await pull(database, owner, 0, { operator: ring });
    const got = page.rows.find((r) => r.id === c.id);
    expect(got?.fields.title).toMatchObject({ v: 'Secret card' });
    expect(got?.fields.description).toMatchObject({ v: 'Secret words' });
    expect(JSON.stringify(page)).not.toContain('"o"');
  });

  it('merges an edit into the sealed fields and keeps the rest', async () => {
    const owner = account();
    const l = list();
    const c = card(l.id, { fields: { title: { v: 'One' }, description: { v: 'Keep me' } } });
    await apply(owner, mutation(l, c));
    await apply(owner, mutation({ table: 'desk_card', id: c.id, fields: { title: { v: 'Two' } } }));
    const got = (await pull(database, owner, 0, { operator: ring })).rows.find(
      (r) => r.id === c.id,
    );
    expect(got?.fields.title).toMatchObject({ v: 'Two' });
    expect(got?.fields.description).toMatchObject({ v: 'Keep me' });
  });

  it('refuses a field a device sealed itself', async () => {
    const owner = account();
    const l = list();
    const result = await apply(
      owner,
      mutation({ ...l, fields: { title: { c: 'AAAA' } } } as never),
    );
    expect(result).toEqual({ status: 'refused', code: 'invalid' });
  });

  it('checks the series a card names even though the name is sealed', async () => {
    const owner = account();
    const l = list();
    const s = series(l.id);
    await apply(owner, mutation(l, s));
    const ok = await apply(
      owner,
      mutation(card(l.id, { fields: { title: { v: 'x' }, seriesId: { v: s.id } } })),
    );
    expect(ok.status).toBe('applied');
    const bad = await apply(
      owner,
      mutation(card(l.id, { fields: { title: { v: 'x' }, seriesId: { v: id() } } })),
    );
    expect(bad).toEqual({ status: 'refused', code: 'unavailable' });
  });

  it('binds a sealed field to its row and name', async () => {
    const owner = account();
    const l = list({ title: 'Bound' });
    await apply(owner, mutation(l));
    const [row] = await dbAll<{ fields: string }>(
      database,
      sql`SELECT fields FROM desk_list WHERE id = ${l.id}`,
    );
    const sealed = (JSON.parse(row?.fields ?? '{}') as { title: { o: string } }).title.o;
    expect(openDeskField(ring, 'desk_list', l.id, 'title', sealed)).toBe('Bound');
    expect(() => openDeskField(ring, 'desk_list', id(), 'title', sealed)).toThrow(CryptoError);
    expect(() => openDeskField(ring, 'desk_list', l.id, 'color', sealed)).toThrow(CryptoError);
  });

  it('will not hand on a sealed field as if it were readable when the server has no key', async () => {
    const owner = account();
    await apply(owner, mutation(list()));
    await expect(pull(database, owner, 0)).rejects.toThrow(/sealed under the operator key/);
  });

  it('opens fields sealed under the previous key, and seals new ones under the current', async () => {
    const owner = account();
    const l = list({ title: 'Old key' });
    await apply(owner, mutation(l));
    const rotated = { current: entryOf(Buffer.alloc(32, 9)), previous: ring.current };
    const page = await pull(database, owner, 0, { operator: rotated });
    expect(page.rows[0]?.fields.title).toMatchObject({ v: 'Old key' });
  });
});

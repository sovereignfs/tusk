import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './db/client';
import { dbAll, dbRun } from './db/exec';
import * as postgresSchema from './db/schema/postgres';
import * as sqliteSchema from './db/schema/sqlite';
import { testTarget } from './db/test-support';
import { after, before, between, comparePositions, first, isPosition, many } from './position';
import { account, id, makeStore } from './sync/test-support';

const { leg } = testTarget();

/** A small deterministic generator, so that a failing run is a run that can be run again: the seed is in the test's name. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plain byte order, written out, so that the tests do not trust the function they test to say what order is. */
const bytewise = (a: string, b: string): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
};

describe('a position', () => {
  it('is a key for the first row, and keys go above and below it', () => {
    const one = first();
    expect(before(one) < one).toBe(true);
    expect(after(one) > one).toBe(true);
    expect(between(before(one), one) > before(one)).toBe(true);
    expect(between(before(one), one) < one).toBe(true);
  });

  it('is between two others, and the two may be given in either order', () => {
    const [a, b] = [first(), after(first())];
    const middle = between(a, b);
    expect(a < middle && middle < b).toBe(true);
    expect(between(b, a)).toBe(middle);
    expect(between(null, null)).toBe(first());
  });

  it('does not throw for equal keys, which two devices can make, and gives that key', () => {
    const a = first();
    expect(between(a, a)).toBe(a);
    expect(many(a, a, 3)).toEqual([a, a, a]);
  });

  it('does not throw for a key that is not one, and treats it as no key', () => {
    for (const bad of ['', 'a00', '!', 'é', 'a0 ', '000000000']) {
      expect(isPosition(bad), JSON.stringify(bad)).toBe(false);
      expect(() => between(bad, first())).not.toThrow();
      expect(() => between(first(), bad)).not.toThrow();
      expect(() => before(bad)).not.toThrow();
      expect(() => after(bad)).not.toThrow();
    }
    expect(isPosition(first())).toBe(true);
    expect(isPosition(before(first()))).toBe(true);
  });

  it('makes several in a gap, in order and distinct', () => {
    const [a, b] = [first(), after(first())];
    const keys = many(a, b, 20);
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect([...keys].sort(bytewise)).toEqual(keys);
    expect(keys.every((key) => a < key && key < b)).toBe(true);
    expect(many(b, a, 3)).toHaveLength(3);
    expect(many(null, null, 0)).toEqual([]);
  });

  it('compares as bytes, so that upper case comes before lower case and "a" before "a1"', () => {
    expect(comparePositions('B', 'a')).toBe(-1);
    expect(comparePositions('Zz', 'a0')).toBe(-1);
    expect(comparePositions('a', 'a1')).toBe(-1);
    expect(comparePositions('a1', 'a1')).toBe(0);
    // And not as a locale does, which puts "a" before "B".
    expect('a'.localeCompare('B')).toBeLessThan(0);
    expect(comparePositions('a', 'B')).toBe(1);
  });
});

describe('order through any number of inserts', () => {
  it.each([1, 2, 3, 42, 2026])(
    'stays the order it was made in, whatever the sequence of places (seed %i)',
    (seed) => {
      const next = random(seed);
      const list: string[] = [];
      for (let i = 0; i < 2000; i++) {
        // A random gap, with the top and the bottom among them.
        const gap = Math.floor(next() * (list.length + 1));
        const key = between(list[gap - 1] ?? null, list[gap] ?? null);
        expect(key > (list[gap - 1] ?? ''), `insert ${i}`).toBe(true);
        if (gap < list.length) expect(key < (list[gap] as string), `insert ${i}`).toBe(true);
        list.splice(gap, 0, key);
      }
      expect([...list].sort(bytewise)).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
    },
  );

  it('keeps keys short across 10,000 inserts at the top, and at the bottom', () => {
    let top = first();
    let bottom = first();
    let longest = 0;
    for (let i = 0; i < 10_000; i++) {
      top = before(top);
      bottom = after(bottom);
      longest = Math.max(longest, top.length, bottom.length);
    }
    expect(longest).toBeLessThanOrEqual(5);
  });

  it('keeps keys short across 10,000 inserts at random places', () => {
    const next = random(7);
    const list: string[] = [];
    let longest = 0;
    for (let i = 0; i < 10_000; i++) {
      const gap = Math.floor(next() * (list.length + 1));
      const key = between(list[gap - 1] ?? null, list[gap] ?? null);
      list.splice(gap, 0, key);
      longest = Math.max(longest, key.length);
    }
    expect(longest).toBeLessThanOrEqual(16);
  });

  it('grows without limit only when the same gap is halved again and again, and takes 300 of those to reach half the most the server allows', () => {
    const a = first();
    let b = after(a);
    for (let i = 0; i < 300; i++) b = between(a, b);
    // The server refuses a position over 64 characters (LIMITS.positionChars); a gap reached this way is for the order task to rebalance (3.6).
    expect(b.length).toBeLessThan(64);
    expect(b.length).toBeGreaterThan(20);
  });
});

describe(`through ORDER BY (${leg})`, () => {
  let database: Database;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ database, close } = await makeStore());
  });
  afterAll(async () => close());

  it('gives the order JavaScript gives, for keys of every shape, including upper case, lower case and digits', async () => {
    const next = random(99);
    const list: string[] = [];
    for (let i = 0; i < 400; i++) {
      const gap = Math.floor(next() * (list.length + 1));
      list.splice(gap, 0, between(list[gap - 1] ?? null, list[gap] ?? null));
    }
    // Keys that make a locale-aware collation disagree with bytes: a mix of cases, digits, and a key and its extension.
    const awkward = ['a', 'B', 'a1', 'Zz', 'aB', 'ab', 'a0', 'A0', 'b', 'a9', 'aA'];
    const keys = [...new Set([...list, ...awkward])];

    const owner = account();
    const table = database.dialect === 'postgres' ? postgresSchema.deskList : sqliteSchema.deskList;
    for (const key of keys) {
      await dbRun(
        database,
        sql`INSERT INTO ${table} (id, owner_id, position, seq, created_at) VALUES (${id()}, ${owner}, ${key}, 1, 1)`,
      );
    }
    const rows = await dbAll<{ position: string }>(
      database,
      sql`SELECT position FROM ${table} WHERE owner_id = ${owner} ORDER BY position`,
    );
    expect(rows.map((row) => row.position)).toEqual([...keys].sort(bytewise));
  });
});

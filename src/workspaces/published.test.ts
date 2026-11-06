import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { testTarget } from '../db/test-support';
import { renderBoard, renderCard, renderNotHere } from '../published/render';
import { makeStore } from '../sync/test-support';
import { applyOp } from './apply';
import { type Op, type OpRequest, TOKEN_PATTERN } from './format';
import { type PublishedBoard, publicationOf, publicationsOf, readPublished } from './published';
import { tablesOf } from './tables';
import { type Role, type World, seedBoardContents, seedWorld } from './testing/roles';

/**
 * A published board (DESIGN.md §14.6), on whichever database the leg runs on: who may give an address and take it away, what the address shows, and
 * above all what it does not: no person, no comment, no activity, no markup of anyone's.
 */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

const NOW = 1_800_000_700_000;
const directory = { idOfEmail: async () => undefined };
const id = () => crypto.randomUUID();
const apply = (w: World, role: Role, op: Op) =>
  applyOp(database, w.accounts[role], { opId: id(), ...op } as OpRequest, { now: NOW, directory });
/** A published board that must be there: the test fails, with a reason, if it is not. */
const published = async (token: string | undefined): Promise<PublishedBoard> => {
  const board = await readPublished(database, token ?? '');
  if (!board) throw new Error('the board is not published');
  return board;
};
const publish = async (w: World, role: Role = 'boardOwner') => {
  const result = await apply(w, role, { op: 'board.publish', id: w.boards.publicBoard });
  return result.status === 'applied' ? result.rows.publication?.token : undefined;
};

describe(`publishing (${leg})`, () => {
  it('gives a board an address of 32 random bytes, the same one if asked again, and a different one after it is taken away', async () => {
    const w = await seedWorld(database);
    const first = await publish(w);
    expect(first).toMatch(TOKEN_PATTERN);
    expect(await publish(w, 'owner')).toBe(first);
    expect(
      await apply(w, 'owner', { op: 'board.unpublish', id: w.boards.publicBoard }),
    ).toMatchObject({ status: 'applied', rows: { unpublished: w.boards.publicBoard } });
    expect(await readPublished(database, first ?? '')).toBeUndefined();
    const second = await publish(w);
    expect(second).toMatch(TOKEN_PATTERN);
    expect(second).not.toBe(first);
    // Taking it away when there is none is not a thing.
    await apply(w, 'owner', { op: 'board.unpublish', id: w.boards.publicBoard });
    expect(await apply(w, 'owner', { op: 'board.unpublish', id: w.boards.publicBoard })).toEqual({
      status: 'refused',
      code: 'stale',
    });
  });

  it('is an administrator’s: a member, a viewer and an outsider are told nothing but that it is not there, and nothing is written', async () => {
    const w = await seedWorld(database);
    const before = (await dbAll(database, sql`SELECT 1 FROM ${tablesOf(database).publication}`))
      .length;
    for (const role of ['boardMember', 'member', 'outsider'] as const)
      expect(await apply(w, role, { op: 'board.publish', id: w.boards.publicBoard }), role).toEqual(
        { status: 'refused', code: 'not_found' },
      );
    expect(
      (await dbAll(database, sql`SELECT 1 FROM ${tablesOf(database).publication}`)).length,
    ).toBe(before);
    // A workspace owner who is not on the board administers it.
    expect(await publish(w, 'owner')).toMatch(TOKEN_PATTERN);
    // Only an administrator reads the address.
    expect(
      (await publicationOf(database, w.accounts.boardOwner, w.boards.publicBoard))?.token,
    ).toMatch(TOKEN_PATTERN);
    expect(
      await publicationOf(database, w.accounts.boardMember, w.boards.publicBoard),
    ).toBeUndefined();
    expect(
      await publicationOf(database, w.accounts.outsider, w.boards.publicBoard),
    ).toBeUndefined();
    expect((await publicationsOf(database, w.accounts.owner)).map((p) => p.boardName)).toEqual([
      'Roadmap',
    ]);
    expect(await publicationsOf(database, w.accounts.boardMember)).toEqual([]);
  });

  it('publishes only while the board is open, stays published when archived, and can be taken down then', async () => {
    const w = await seedWorld(database);
    expect(
      await apply(w, 'boardOwner', { op: 'board.publish', id: w.boards.archivedBoard }),
    ).toEqual({ status: 'refused', code: 'not_found' });
    const token = await publish(w);
    await apply(w, 'boardOwner', { op: 'board.archive', id: w.boards.publicBoard });
    expect((await readPublished(database, token ?? ''))?.archived).toBe(true);
    expect(
      (await apply(w, 'boardOwner', { op: 'board.unpublish', id: w.boards.publicBoard })).status,
    ).toBe('applied');
    expect(await readPublished(database, token ?? '')).toBeUndefined();
  });

  it('is nothing for a token that never was, one that is not the right shape, one taken away, and a board that was deleted', async () => {
    const w = await seedWorld(database);
    const token = (await publish(w)) ?? '';
    expect(await readPublished(database, token)).toBeDefined();
    for (const bad of ['', 'x', token.slice(1), `${token}x`, '../etc/passwd', "' OR 1=1 --"])
      expect(await readPublished(database, bad), bad).toBeUndefined();
    expect(await readPublished(database, 'A'.repeat(43))).toBeUndefined();
    await apply(w, 'boardOwner', { op: 'board.delete', id: w.boards.publicBoard, name: 'Roadmap' });
    expect(await readPublished(database, token)).toBeUndefined();
  });

  it('shows the work and not a single person: no name, address, assignee, comment or activity is in what it reads or in its HTML', async () => {
    const w = await seedWorld(database);
    await seedBoardContents(database, w);
    // The contents seed a publication of their own with a short token; this test publishes the board properly.
    await dbAll(
      database,
      sql`DELETE FROM ${tablesOf(database).publication} WHERE board_id = ${w.boards.publicBoard} RETURNING 1 AS one`,
    );
    await apply(w, 'boardMember', {
      op: 'card.assign',
      cardId: w.cards.open,
      accountId: w.accounts.boardMember,
    });
    await apply(w, 'boardMember', {
      op: 'comment.add',
      id: id(),
      cardId: w.cards.open,
      body: 'A SECRET COMMENT <b>x</b>',
    });
    await apply(w, 'boardMember', {
      op: 'card.describe',
      id: w.cards.open,
      description: 'Plain words\nsecond line',
    });
    await apply(w, 'boardMember', {
      op: 'card.addLabel',
      cardId: w.cards.open,
      labelId: w.labels.publicBoard,
    });
    await apply(w, 'boardMember', {
      op: 'card.setDue',
      id: w.cards.open,
      dueDate: '2026-12-01',
      dueTime: '09:00',
    });
    const token = (await publish(w)) ?? '';
    const board = await published(token);
    expect(board.lists.flatMap((l) => l.cards).map((c) => c.title)).toEqual(
      expect.arrayContaining(['Open one', 'First']),
    );
    // The archived card is not part of it.
    expect(JSON.stringify(board)).not.toContain('Old one');
    const html =
      renderBoard(board, 'NONCE', '1970-01-01') +
      renderCard(board, w.cards.open, 'NONCE', '1970-01-01');
    const everyone = [
      ...Object.values(w.accounts),
      'SECRET COMMENT',
      'example.com',
      'mailto:',
      'assigned',
      'commented',
      'By the owner',
      'An old comment',
      'Hello',
    ];
    for (const secret of everyone) {
      expect(JSON.stringify(board), secret).not.toContain(secret);
      expect(html, secret).not.toContain(secret);
    }
    // It is a document with no script and nothing that reaches out, and the work is there.
    expect(html).not.toMatch(/<script|<link|<iframe|<img|<form|javascript:|\son[a-z]+\s*=/i);
    expect(html).toContain('Open one');
    expect(html).toContain('Plain words');
    expect(html).toContain('First step');
    expect(html).toContain('noindex');
  });

  it('shows what a person wrote as text: markup in a title, a description, a label or a list is escaped', async () => {
    const w = await seedWorld(database);
    await apply(w, 'boardMember', {
      op: 'card.rename',
      id: w.cards.open,
      title: '<script>alert(1)</script> & "quoted"',
    });
    await apply(w, 'boardMember', {
      op: 'card.describe',
      id: w.cards.open,
      description: '<img src=x onerror=alert(1)>',
    });
    await apply(w, 'boardMember', {
      op: 'list.rename',
      id: w.lists.publicBoard,
      name: '</h2><script>x</script>',
    });
    await apply(w, 'boardMember', {
      op: 'label.update',
      id: w.labels.publicBoard,
      name: '"><svg onload=1>',
      color: '#dc2626',
    });
    await apply(w, 'boardMember', {
      op: 'card.addLabel',
      cardId: w.cards.open,
      labelId: w.labels.publicBoard,
    });
    const board = await published(await publish(w));
    const html =
      renderBoard(board, 'N', '1970-01-01') + renderCard(board, w.cards.open, 'N', '1970-01-01');
    expect(html).not.toMatch(/<script|<svg|<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;/h2&gt;&lt;script&gt;x&lt;/script&gt;');
  });

  it('draws a colour that is not #rrggbb as no colour at all, and a card of another board as not there', async () => {
    const w = await seedWorld(database);
    const board = await published(await publish(w));
    const hostile = {
      ...board,
      color: 'red;}</style><script>x</script>',
      labels: [{ id: 'l', name: 'x', color: 'url(javascript:1)' }],
    };
    const html = renderBoard(hostile, 'N', '1970-01-01');
    expect(html).not.toMatch(/<script|javascript:/i);
    expect(html).toContain('c-none');
    // A card of the private board is not on this board's page.
    expect(renderCard(board, w.cards.archived, 'N', '1970-01-01')).toBeUndefined();
    expect(renderCard(board, id(), 'N', '1970-01-01')).toBeUndefined();
    expect(renderNotHere('N')).toContain('noindex');
  });

  it('writes activity for publishing and unpublishing, once', async () => {
    const w = await seedWorld(database);
    await publish(w);
    await publish(w);
    await apply(w, 'boardOwner', { op: 'board.unpublish', id: w.boards.publicBoard });
    const kinds = (
      await dbAll<{ kind: string }>(
        database,
        sql`SELECT kind FROM ${tablesOf(database).activity} WHERE board_id = ${w.boards.publicBoard} AND kind LIKE 'board.%publish%' ORDER BY created_at, id`,
      )
    ).map((r) => r.kind);
    expect(kinds.sort()).toEqual(['board.published', 'board.unpublished']);
  });
});

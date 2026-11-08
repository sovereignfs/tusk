import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ringOf } from '../crypto/keys';
import { dbAll } from '../db/exec';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import * as workspaceTables from '../db/schema/sqlite/workspaces';
import { applyOp } from './apply';
import {
  CONTENT_COLUMNS,
  STRUCTURAL_TEXT_COLUMNS,
  configureOperator,
  operatorRing,
  open,
} from './content';
import type { OpRequest } from './format';
import { readBoard } from './reads';
import { exportBoard } from './export';
import { readPublished } from './published';
import { activityOfBoard } from './activity-reads';
import { type World, seedWorld } from './testing/roles';
import { makeStore } from '../sync/test-support';

/**
 * The operator key on workspaces (DESIGN.md §9.5, task 14.7). Two things make the rest checkable. **The schema is asked for its columns**: a text column that is
 * neither content nor structure fails here, so a new column cannot be added as plain by omission. And **a dump of every workspace table after a run of
 * operations holds none of what was written**, which is the property the mode exists for and is what finds a statement that bypasses `content.ts`.
 */
const { leg } = testTarget();

describe('the workspace schema and the content boundary', () => {
  const tables = Object.values(workspaceTables).flatMap((value) => {
    try {
      const config = getTableConfig(value as never);
      return [
        {
          name: config.name,
          text: config.columns.filter((c) => c.dataType === 'string').map((c) => c.name),
        },
      ];
    } catch {
      return [];
    }
  });

  it('puts every text column of every workspace table on one side: content or structure', () => {
    for (const table of tables) {
      const content: readonly string[] =
        (CONTENT_COLUMNS as Record<string, readonly string[]>)[table.name] ?? [];
      const structural = STRUCTURAL_TEXT_COLUMNS[table.name] ?? [];
      const unclassified = table.text.filter(
        (c) => !content.includes(c) && !structural.includes(c),
      );
      expect(
        unclassified,
        `${table.name}: decide each of these in src/workspaces/content.ts`,
      ).toEqual([]);
      // And nothing is on both sides, or listed that the table does not have.
      expect(content.filter((c) => structural.includes(c))).toEqual([]);
      for (const c of [...content, ...structural])
        expect(table.text, `${table.name}.${c}`).toContain(c);
    }
  });

  it('names a table of the schema for every table it lists', () => {
    const names = tables.map((t) => t.name);
    for (const name of Object.keys(CONTENT_COLUMNS)) expect(names).toContain(name);
    for (const name of Object.keys(STRUCTURAL_TEXT_COLUMNS)) expect(names).toContain(name);
  });
});

describe(`workspace content under the operator key (${leg})`, () => {
  const ring = ringOf(Buffer.alloc(32, 11));
  let database: Database;
  let close: () => Promise<void>;
  let world: World;
  const MARK = 'zqxmark';
  const mark = (what: string) => `${MARK}-${what}`;
  let before: ReturnType<typeof operatorRing>;

  beforeAll(async () => {
    ({ database, close } = await makeStore());
  });
  afterAll(async () => close());
  beforeEach(() => {
    before = operatorRing();
    configureOperator(ring);
  });
  afterEach(() => configureOperator(before));

  const run = async (who: string, op: Record<string, unknown>) => {
    const result = await applyOp(database, who, { opId: crypto.randomUUID(), ...op } as OpRequest, {
      now: 1_800_000_000_000,
    });
    if (result.status !== 'applied') throw new Error(`${String(op.op)}: ${JSON.stringify(result)}`);
    return result;
  };

  /** Every cell of every workspace table, as text: what a dump of the database holds. */
  const dump = async () => {
    const parts: string[] = [];
    for (const table of Object.values(workspaceTables)) {
      let name: string;
      try {
        name = getTableConfig(table as never).name;
      } catch {
        continue;
      }
      parts.push(JSON.stringify(await dbAll(database, sql`SELECT * FROM ${sql.raw(`"${name}"`)}`)));
    }
    return parts.join('\n');
  };

  it('holds no name, title, description, label, checklist item, comment or activity in plain, whatever the operation', async () => {
    world = await seedWorld(database);
    const owner = world.accounts.boardOwner;
    const board = crypto.randomUUID();
    const list = crypto.randomUUID();
    const list2 = crypto.randomUUID();
    const card = crypto.randomUUID();
    const label = crypto.randomUUID();
    const item = crypto.randomUUID();
    const comment = crypto.randomUUID();
    const clone = crypto.randomUUID();
    const workspace = crypto.randomUUID();

    await run(world.accounts.owner, {
      op: 'workspace.create',
      id: workspace,
      name: mark('workspace'),
    });
    await run(world.accounts.owner, {
      op: 'workspace.rename',
      id: workspace,
      name: mark('workspace-renamed'),
    });
    await run(owner, {
      op: 'board.create',
      id: board,
      workspaceId: world.workspace,
      name: mark('board'),
      color: '#2563eb',
    });
    await run(owner, {
      op: 'board.update',
      id: board,
      name: mark('board2'),
      color: '#2563eb',
      description: mark('board-description'),
    });
    await run(owner, {
      op: 'list.create',
      id: list,
      boardId: board,
      name: mark('list'),
      position: 'a1',
    });
    await run(owner, {
      op: 'list.create',
      id: list2,
      boardId: board,
      name: mark('list2'),
      position: 'a2',
    });
    await run(owner, { op: 'list.rename', id: list, name: mark('list-renamed') });
    await run(owner, {
      op: 'card.create',
      id: card,
      listId: list,
      title: mark('card'),
      position: 'a0',
    });
    await run(owner, { op: 'card.rename', id: card, title: mark('card-renamed') });
    await run(owner, { op: 'card.describe', id: card, description: mark('card-description') });
    await run(owner, {
      op: 'label.create',
      id: label,
      boardId: board,
      name: mark('label'),
      color: '#dc2626',
    });
    await run(owner, { op: 'label.update', id: label, name: mark('label2'), color: '#dc2626' });
    await run(owner, { op: 'card.addLabel', cardId: card, labelId: label });
    await run(owner, {
      op: 'item.add',
      id: item,
      cardId: card,
      title: mark('item'),
      position: 'a0',
    });
    await run(owner, { op: 'item.rename', id: item, title: mark('item-renamed') });
    await run(owner, { op: 'item.tick', id: item });
    await run(owner, { op: 'comment.add', id: comment, cardId: card, body: mark('comment') });
    await run(owner, { op: 'comment.edit', id: comment, body: mark('comment-edited') });
    await run(owner, { op: 'card.move', id: card, listId: list2, position: 'a5' });
    await run(owner, { op: 'card.clone', id: card, newId: clone });
    await run(owner, {
      op: 'card.moveToBoard',
      id: card,
      boardId: world.boards.publicBoard,
      listId: world.lists.publicBoard,
      position: 'a9',
    });
    await run(owner, { op: 'board.publish', id: board });

    expect(await dump()).not.toContain(MARK);

    // And what is read back is what was written, through every reader.
    const read = await readBoard(database, owner, board);
    expect(read?.board.name).toBe(mark('board2'));
    expect(read?.board.description).toBe(mark('board-description'));
    expect(read?.lists.map((l) => l.name).sort()).toEqual(
      ['Backlog', mark('list-renamed'), mark('list2')].sort(),
    );
    expect(read?.cards.map((c) => c.title)).toContain(mark('card-renamed'));
    const exported = await exportBoard(
      database,
      {
        profiles: async (ids: readonly string[]) =>
          new Map(ids.map((id) => [id, { id, name: 'N', email: `${id}@x`, image: null }])),
      },
      owner,
      board,
    );
    const text = JSON.stringify(exported);
    for (const wanted of ['board2', 'board-description', 'list-renamed', 'label2'])
      expect(text).toContain(mark(wanted));
    const published = await readPublished(
      database,
      (
        await dbAll<{ token: string }>(
          database,
          sql`SELECT token FROM publication WHERE board_id = ${board}`,
        )
      )[0]?.token ?? '',
    );
    expect(published?.name).toBe(mark('board2'));
    const activity = await activityOfBoard(
      database,
      { profiles: async () => new Map() },
      owner,
      board,
    );
    expect(activity?.activity.map((a) => a.text).join('\n')).toContain(mark('board2'));
  });

  it('opens nothing that was sealed to another row, column or table', async () => {
    const [row] = await dbAll<{ id: string; name: string }>(
      database,
      sql`SELECT id, name FROM board LIMIT 1`,
    );
    expect(row).toBeDefined();
    expect(() => open('board', row?.id ?? '', 'name', row?.name ?? '')).not.toThrow();
    expect(() => open('board', row?.id ?? '', 'description', row?.name ?? '')).toThrow();
    expect(() => open('board', crypto.randomUUID(), 'name', row?.name ?? '')).toThrow();
    expect(() => open('workspace', row?.id ?? '', 'name', row?.name ?? '')).toThrow();
  });
});

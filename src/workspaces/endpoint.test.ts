import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import type { Limiter } from '../limits/rate';
import { makeStore } from '../sync/test-support';
import { handleOp, opsResponse } from './endpoint';
import { WORKSPACE_LIMITS } from './format';
import { applyOp } from './apply';
import { seedWorld, type World } from './testing/roles';

/** `POST /api/ops` (DESIGN.md §7.3), as a request reaches it and as each kind of caller is answered. */
const { leg } = testTarget();

let database: Database;
let close: () => Promise<void>;
let world: World;
beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
});
afterAll(async () => close());

const open: Limiter = { take: async () => ({ ok: true }) };
const deps = (limiter: Limiter = open) => ({ database, limiter, now: () => 1_800_000_200_000 });
const id = () => crypto.randomUUID();
const create = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ opId: id(), op: 'workspace.create', id: id(), name: 'Mine', ...extra });

describe(`POST /api/ops (${leg})`, () => {
  it('applies an operation and answers with the row as it now is', async () => {
    const response = await handleOp(create({ name: ' Side project ' }), id(), deps());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 'applied',
      replay: false,
      rows: { workspace: { name: 'Side project', role: 'owner' } },
    });
  });

  it('answers a repeat as applied and does it no more', async () => {
    const account = id();
    const request = create();
    const first = await (await handleOp(request, account, deps())).json();
    const again = await (await handleOp(request, account, deps())).json();
    expect(first.replay).toBe(false);
    expect(again).toMatchObject({ status: 'applied', replay: true });
  });

  it('refuses what is not an operation with 400, and says no more', async () => {
    for (const body of [
      'not json',
      '[]',
      '{}',
      create({ op: 'workspace.destroy' }),
      create({ name: '' }),
    ]) {
      const response = await handleOp(body, id(), deps());
      expect(response.status, body).toBe(400);
      expect(await response.json()).toEqual({ code: 'BAD_REQUEST' });
    }
  });

  it('answers an operation that is refused with 200 and the same word for what is not theirs', async () => {
    const mine = JSON.stringify({
      opId: id(),
      op: 'workspace.rename',
      id: world.workspace,
      name: 'Taken',
    });
    const response = await handleOp(mine, world.accounts.outsider, deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'refused', code: 'not_found' });
  });

  it('is 429 when it comes too often, and 413 when it is too big', async () => {
    const full: Limiter = { take: async () => ({ ok: false, retryAfterMs: 4000 }) };
    const limited = await handleOp(create(), id(), deps(full));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('4');

    const big = await opsResponse(
      new Request('http://localhost/api/ops', {
        method: 'POST',
        body: 'x'.repeat(WORKSPACE_LIMITS.bodyBytes + 1),
      }),
      id(),
      deps(),
    );
    expect(big.status).toBe(413);
  });

  it('refuses an account that has made as many workspaces as it may', async () => {
    const account = id();
    for (let i = 0; i < WORKSPACE_LIMITS.workspacesPerAccount; i++)
      expect(
        (
          await applyOp(
            database,
            account,
            { opId: id(), op: 'workspace.create', id: id(), name: 'w' },
            { now: 1 },
          )
        ).status,
      ).toBe('applied');
    expect(
      await applyOp(
        database,
        account,
        { opId: id(), op: 'workspace.create', id: id(), name: 'w' },
        { now: 1 },
      ),
    ).toEqual({ status: 'refused', code: 'limit' });
    // Another account is not held up by it.
    expect(
      (
        await applyOp(
          database,
          id(),
          { opId: id(), op: 'workspace.create', id: id(), name: 'w' },
          { now: 1 },
        )
      ).status,
    ).toBe('applied');
  });

  it('refuses an id another account already uses, as not found, and writes nothing', async () => {
    const taken = await applyOp(
      database,
      world.accounts.outsider,
      { opId: id(), op: 'workspace.create', id: world.workspace, name: 'Mine' },
      { now: 1 },
    );
    expect(taken).toEqual({ status: 'refused', code: 'not_found' });
  });

  it('is not recorded as done when it was refused: a refusal rolls back the record of its opId', async () => {
    const opId = id();
    const refused = await applyOp(
      database,
      world.accounts.outsider,
      { opId, op: 'workspace.rename', id: world.workspace, name: 'No' },
      { now: 1 },
    );
    expect(refused.status).toBe('refused');
    const retried = await applyOp(
      database,
      world.accounts.owner,
      { opId, op: 'workspace.rename', id: world.workspace, name: 'Yes' },
      { now: 2 },
    );
    expect(retried).toMatchObject({ status: 'applied', replay: false });
  });
});

describe('the door is the only way in', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const files = (folder: string): string[] =>
    readdirSync(path.join(ROOT, folder)).flatMap((name) => {
      const relative = path.join(folder, name);
      if (statSync(path.join(ROOT, relative)).isDirectory()) return files(relative);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative] : [];
    });

  it('has nothing under app/ or src/ that touches the workspace tables except src/workspaces/, the schema and the seed', () => {
    const allowed = (file: string) =>
      file.startsWith(path.join('src', 'workspaces') + path.sep) ||
      file.startsWith(path.join('src', 'db') + path.sep);
    const offenders = [...files('app'), ...files('src')]
      .filter((file) => !allowed(file))
      .filter((file) =>
        /schema\/(sqlite|postgres)\/workspaces|workspaces\/tables/.test(
          readFileSync(path.join(ROOT, file), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('has no route under app/api/ that writes a workspace but /api/ops', () => {
    const routes = files(path.join('app', 'api')).filter((file) => file.endsWith('route.ts'));
    const writers = routes.filter((file) =>
      /workspaces\/(apply|tables)|applyOp\(/.test(readFileSync(path.join(ROOT, file), 'utf8')),
    );
    expect(writers).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { OPS, WORKSPACE_LIMITS } from './format';
import { parseOp } from './validate';

const ID = () => crypto.randomUUID();

describe('an operation', () => {
  it('is accepted whole, with its name trimmed, and comes back the same through JSON', () => {
    for (const op of ['workspace.create', 'workspace.rename', 'workspace.delete'] as const) {
      const request = { opId: ID(), op, id: ID(), name: '  Acme  ' };
      const parsed = parseOp(JSON.parse(JSON.stringify(request)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual({ ...request, name: 'Acme' });
    }
    expect([...OPS]).toEqual([
      'workspace.create',
      'workspace.rename',
      'workspace.delete',
      'member.add',
      'member.setRole',
      'member.remove',
      'member.leave',
    ]);
  });

  it('takes the operations on people whole, with an address trimmed and lower case', () => {
    const workspaceId = ID();
    const accountId = 'account-1';
    const good = [
      { op: 'member.add', workspaceId, email: ' Ada@Example.COM ' },
      { op: 'member.setRole', workspaceId, accountId, role: 'owner' },
      { op: 'member.remove', workspaceId, accountId },
      { op: 'member.leave', workspaceId },
    ];
    for (const each of good) {
      const parsed = parseOp(JSON.parse(JSON.stringify({ opId: ID(), ...each })));
      expect(parsed.ok, each.op).toBe(true);
      if (parsed.ok && parsed.value.op === 'member.add')
        expect(parsed.value.email).toBe('ada@example.com');
    }
  });

  it('refuses what is not an address, not a role, or says more than it takes', () => {
    const workspaceId = ID();
    const bad: unknown[] = [
      { op: 'member.add', workspaceId, email: 'not an address' },
      { op: 'member.add', workspaceId, email: 'a@b@c' },
      { op: 'member.add', workspaceId, email: `${'a'.repeat(250)}@example.com` },
      { op: 'member.add', workspaceId, email: 7 },
      { op: 'member.add', workspaceId: 'x', email: 'a@b.c' },
      { op: 'member.setRole', workspaceId, accountId: 'a', role: 'admin' },
      { op: 'member.setRole', workspaceId, accountId: 'a' },
      { op: 'member.remove', workspaceId, accountId: '' },
      // Leaving is the asker's own: it names nobody.
      { op: 'member.leave', workspaceId, accountId: 'someone-else' },
    ];
    for (const each of bad)
      expect(parseOp({ opId: ID(), ...(each as object) }).ok, JSON.stringify(each)).toBe(false);
  });

  it('is refused for every shape that is not one', () => {
    const base = { opId: ID(), op: 'workspace.create', id: ID(), name: 'Acme' };
    const bad: unknown[] = [
      null,
      undefined,
      'workspace.create',
      42,
      [],
      {},
      { ...base, opId: 'abc' },
      { ...base, opId: undefined },
      { ...base, op: 'workspace.destroy' },
      { ...base, op: 'toString' },
      { ...base, op: ['workspace.create'] },
      { ...base, id: 'nope' },
      { ...base, id: ID().toUpperCase() },
      { ...base, name: '' },
      { ...base, name: '   ' },
      { ...base, name: 5 },
      { ...base, name: 'x'.repeat(WORKSPACE_LIMITS.nameChars + 1) },
      { ...base, name: 'has\u0000nul' },
    ];
    for (const value of bad) expect(parseOp(value).ok, JSON.stringify(value)).toBe(false);
  });

  it('names nothing it does not take: no account, no owner, no role, nothing of a kind it is not', () => {
    const base = { opId: ID(), op: 'workspace.rename', id: ID(), name: 'Acme' };
    for (const extra of [
      { accountId: ID() },
      { ownerId: ID() },
      { createdBy: ID() },
      { role: 'owner' },
      { boardId: ID() },
      { constructor: 'x' },
    ]) {
      expect(parseOp({ ...base, ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
    const hostile = JSON.parse(
      `{"opId":"${ID()}","op":"workspace.rename","id":"${ID()}","name":"x","__proto__":{"accountId":"y"}}`,
    );
    expect(parseOp(hostile).ok).toBe(false);
    expect(({} as Record<string, unknown>).accountId).toBeUndefined();
  });

  it('never repeats the input in why it was refused', () => {
    const secret = 'hunter2-the-secret-name';
    for (const value of [
      { opId: ID(), op: secret, id: ID(), name: 'x' },
      { opId: ID(), op: 'workspace.create', id: secret, name: 'x' },
      { opId: ID(), op: 'workspace.create', id: ID(), name: secret + 'x'.repeat(500) },
      { opId: ID(), op: 'workspace.create', id: ID(), name: 'x', [secret]: 1 },
    ]) {
      const parsed = parseOp(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).not.toContain(secret);
    }
  });
});

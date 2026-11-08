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
      'board.create',
      'list.create',
      'list.rename',
      'list.move',
      'list.delete',
      'card.create',
      'card.move',
      'card.archive',
      'card.restore',
      'card.delete',
      'card.rename',
      'card.describe',
      'board.update',
      'board.archive',
      'board.restore',
      'board.delete',
      'board.setVisibility',
      'boardMember.add',
      'boardMember.setRole',
      'boardMember.remove',
      'board.join',
      'board.leave',
      'card.setDue',
      'label.create',
      'label.update',
      'label.delete',
      'card.addLabel',
      'card.removeLabel',
      'card.assign',
      'card.unassign',
      'item.add',
      'item.rename',
      'item.tick',
      'item.untick',
      'item.move',
      'item.delete',
      'comment.add',
      'comment.edit',
      'comment.delete',
      'card.moveToBoard',
      'card.clone',
      'board.publish',
      'board.unpublish',
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

  it('takes the board and list operations whole, with names trimmed', () => {
    const [a, b] = [ID(), ID()];
    const good = [
      { op: 'board.create', id: a, workspaceId: b, name: ' Roadmap ', color: '#2563eb' },
      { op: 'list.create', id: a, boardId: b, name: ' Doing ', position: 'a1' },
      { op: 'list.rename', id: a, name: ' Later ' },
      { op: 'list.move', id: a, position: 'a0V' },
      { op: 'list.delete', id: a },
    ];
    for (const each of good) {
      const parsed = parseOp(JSON.parse(JSON.stringify({ opId: ID(), ...each })));
      expect(parsed.ok, each.op).toBe(true);
      if (parsed.ok && 'name' in parsed.value)
        expect(parsed.value.name).toBe(parsed.value.name.trim());
    }
  });

  it('takes the card operations whole, and refuses a blank title, a long one and a key it does not take', () => {
    const [a, b] = [ID(), ID()];
    const good = [
      { op: 'card.create', id: a, listId: b, title: ' Write it ', position: 'a0' },
      { op: 'card.move', id: a, listId: b, position: 'a1' },
      { op: 'card.archive', id: a },
      { op: 'card.restore', id: a },
      { op: 'card.delete', id: a },
    ];
    for (const each of good) expect(parseOp({ opId: ID(), ...each }).ok, each.op).toBe(true);
    const parsed = parseOp({ opId: ID(), ...good[0] });
    if (parsed.ok && parsed.value.op === 'card.create') expect(parsed.value.title).toBe('Write it');
    const bad: unknown[] = [
      { op: 'card.create', id: a, listId: b, title: '  ', position: 'a0' },
      { op: 'card.create', id: a, listId: b, title: 'x'.repeat(501), position: 'a0' },
      { op: 'card.create', id: a, listId: b, title: 'x', position: '' },
      { op: 'card.create', id: a, listId: b, title: 'x', position: 'a0', boardId: b },
      { op: 'card.move', id: a, position: 'a1' },
      { op: 'card.archive', id: 'x' },
      { op: 'card.delete', id: a, force: true },
    ];
    for (const each of bad)
      expect(parseOp({ opId: ID(), ...(each as object) }).ok, JSON.stringify(each)).toBe(false);
  });

  it('takes a rename and a description, and refuses a blank title, and a description that is too long', () => {
    const a = ID();
    const lines = 'one\n\n two ';
    expect(parseOp({ opId: ID(), op: 'card.rename', id: a, title: ' New ' })).toMatchObject({
      ok: true,
      value: { title: 'New' },
    });
    // A description is kept as written, and an empty one is a description of nothing.
    expect(parseOp({ opId: ID(), op: 'card.describe', id: a, description: lines })).toMatchObject({
      ok: true,
      value: { description: lines },
    });
    expect(parseOp({ opId: ID(), op: 'card.describe', id: a, description: '' }).ok).toBe(true);
    for (const bad of [
      { op: 'card.rename', id: a, title: '   ' },
      { op: 'card.describe', id: a, description: 'x'.repeat(20_001) },
      { op: 'card.describe', id: a, description: 7 },
      { op: 'card.describe', id: a },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes the board settings whole, and refuses a colour, a long description and a name typed with the space it was given', () => {
    const a = ID();
    const update = {
      op: 'board.update',
      id: a,
      name: ' Plans ',
      color: '#7c3aed',
      description: 'Why\nand how',
    };
    expect(parseOp({ opId: ID(), ...update })).toMatchObject({
      ok: true,
      value: { name: 'Plans', description: 'Why\nand how' },
    });
    for (const each of [
      { op: 'board.archive', id: a },
      { op: 'board.restore', id: a },
    ])
      expect(parseOp({ opId: ID(), ...each }).ok, each.op).toBe(true);
    // The name to delete is compared as typed: it is not trimmed.
    expect(parseOp({ opId: ID(), op: 'board.delete', id: a, name: 'Plans ' })).toMatchObject({
      ok: true,
      value: { name: 'Plans ' },
    });
    for (const bad of [
      { ...update, color: 'purple' },
      { ...update, description: 'x'.repeat(2001) },
      { ...update, visibility: 'private' },
      { op: 'board.update', id: a, name: 'x', color: '#7c3aed' },
      { op: 'board.delete', id: a, name: '' },
      { op: 'board.archive', id: a, name: 'x' },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes visibility, board people, join and leave whole, and refuses a visibility or a role that is not one', () => {
    const [a, b] = [ID(), ID()];
    for (const good of [
      { op: 'board.setVisibility', id: a, visibility: 'private' },
      { op: 'boardMember.add', boardId: a, accountId: b },
      { op: 'boardMember.setRole', boardId: a, accountId: b, role: 'owner' },
      { op: 'boardMember.remove', boardId: a, accountId: b },
      { op: 'board.join', id: a },
      { op: 'board.leave', id: a },
    ])
      expect(parseOp({ opId: ID(), ...good }).ok, good.op).toBe(true);
    for (const bad of [
      { op: 'board.setVisibility', id: a, visibility: 'secret' },
      { op: 'board.setVisibility', id: a },
      { op: 'boardMember.setRole', boardId: a, accountId: b, role: 'admin' },
      { op: 'boardMember.add', boardId: a },
      { op: 'board.join', id: a, accountId: b },
      { op: 'board.leave', id: 'x' },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes a due date and time together, and no time without a date, and nothing that is not a date or a time', () => {
    const a = ID();
    for (const good of [
      { dueDate: '2026-11-07', dueTime: '09:30' },
      { dueDate: '2026-11-07', dueTime: null },
      { dueDate: null, dueTime: null },
    ])
      expect(
        parseOp({ opId: ID(), op: 'card.setDue', id: a, ...good }).ok,
        JSON.stringify(good),
      ).toBe(true);
    for (const bad of [
      { dueDate: null, dueTime: '09:30' },
      { dueDate: '2026-02-30', dueTime: null },
      { dueDate: '2026-11-07', dueTime: '24:00' },
      { dueDate: '2026-11-07', dueTime: '9:30' },
      { dueDate: '2026-11-07' },
      { dueTime: null },
      { dueDate: 20261107, dueTime: null },
    ])
      expect(
        parseOp({ opId: ID(), op: 'card.setDue', id: a, ...bad }).ok,
        JSON.stringify(bad),
      ).toBe(false);
  });

  it('takes an end only with a time and after it, and a request without one as no end (task 19.5)', () => {
    const a = ID();
    const parse = (extra: object) => parseOp({ opId: ID(), op: 'card.setDue', id: a, ...extra });
    const ok = parse({ dueDate: '2026-11-07', dueTime: '09:30', dueEnd: '10:15' });
    expect(ok.ok && ok.value).toMatchObject({ dueEnd: '10:15' });
    const none = parse({ dueDate: '2026-11-07', dueTime: '09:30' });
    expect(none.ok && none.value).toMatchObject({ dueEnd: null });
    expect(parse({ dueDate: '2026-11-07', dueTime: '09:30', dueEnd: null }).ok).toBe(true);
    for (const bad of [
      { dueDate: '2026-11-07', dueTime: null, dueEnd: '10:15' },
      { dueDate: '2026-11-07', dueTime: '09:30', dueEnd: '09:30' },
      { dueDate: '2026-11-07', dueTime: '09:30', dueEnd: '09:00' },
      { dueDate: '2026-11-07', dueTime: '09:30', dueEnd: '25:00' },
      { dueDate: '2026-11-07', dueTime: '09:30', dueEnd: 1015 },
    ])
      expect(parse(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes the label operations, a name that may be empty, and refuses a colour that is not one or a name that is too long', () => {
    const [a, b] = [ID(), ID()];
    for (const good of [
      { op: 'label.create', id: a, boardId: b, name: '', color: '#12ab9f' },
      { op: 'label.create', id: a, boardId: b, name: ' Bug ', color: '#12ab9f' },
      { op: 'label.update', id: a, name: '', color: '#000000' },
      { op: 'label.delete', id: a },
      { op: 'card.addLabel', cardId: a, labelId: b },
      { op: 'card.removeLabel', cardId: a, labelId: b },
    ])
      expect(parseOp({ opId: ID(), ...good }).ok, good.op).toBe(true);
    for (const bad of [
      { op: 'label.create', id: a, boardId: b, name: 'x', color: 'red' },
      { op: 'label.create', id: a, boardId: b, name: 'x'.repeat(51), color: '#12ab9f' },
      { op: 'label.update', id: a, name: 'x', color: '#12AB9F' },
      { op: 'card.addLabel', cardId: a },
      { op: 'card.addLabel', cardId: a, labelId: 'x' },
      { op: 'label.delete', id: a, boardId: b },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes assigning and unassigning whole, and refuses a missing person or an id that is not one', () => {
    const a = ID();
    for (const good of [
      { op: 'card.assign', cardId: a, accountId: 'account-1' },
      { op: 'card.unassign', cardId: a, accountId: 'account-1' },
    ])
      expect(parseOp({ opId: ID(), ...good }).ok, good.op).toBe(true);
    for (const bad of [
      { op: 'card.assign', cardId: a },
      { op: 'card.assign', cardId: a, accountId: '' },
      { op: 'card.assign', cardId: 'x', accountId: 'account-1' },
      { op: 'card.unassign', cardId: a, accountId: 'account-1', notify: false },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes the checklist operations whole, and refuses a blank title or a position that is not one', () => {
    const [a, b] = [ID(), ID()];
    for (const good of [
      { op: 'item.add', id: a, cardId: b, title: ' Step ', position: 'a0' },
      { op: 'item.rename', id: a, title: 'New' },
      { op: 'item.tick', id: a },
      { op: 'item.untick', id: a },
      { op: 'item.move', id: a, position: 'a1' },
      { op: 'item.delete', id: a },
    ])
      expect(parseOp({ opId: ID(), ...good }).ok, good.op).toBe(true);
    for (const bad of [
      { op: 'item.add', id: a, cardId: b, title: '  ', position: 'a0' },
      { op: 'item.add', id: a, cardId: b, title: 'x', position: '' },
      { op: 'item.add', id: a, title: 'x', position: 'a0' },
      { op: 'item.rename', id: a, title: 'x'.repeat(501) },
      { op: 'item.move', id: a, position: 'a b' },
      { op: 'item.tick', id: a, done: true },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes the comment operations whole, keeps the text as written, and refuses a blank or a long one', () => {
    const [a, b] = [ID(), ID()];
    const text = 'Line one\n\n  <b>two</b> ';
    expect(parseOp({ opId: ID(), op: 'comment.add', id: a, cardId: b, body: text })).toMatchObject({
      ok: true,
      value: { body: text },
    });
    expect(parseOp({ opId: ID(), op: 'comment.edit', id: a, body: 'Changed' }).ok).toBe(true);
    expect(parseOp({ opId: ID(), op: 'comment.delete', id: a }).ok).toBe(true);
    for (const bad of [
      { op: 'comment.add', id: a, cardId: b, body: '' },
      { op: 'comment.add', id: a, cardId: b, body: ' \n ' },
      { op: 'comment.add', id: a, cardId: b, body: 'x'.repeat(5001) },
      { op: 'comment.edit', id: a, body: '   ' },
      { op: 'comment.add', id: a, body: 'x' },
      { op: 'comment.delete', id: a, authorId: 'me' },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes moving to a board and cloning whole, and refuses a missing board, a bad position or a stray key', () => {
    const [a, b, c] = [ID(), ID(), ID()];
    expect(
      parseOp({ opId: ID(), op: 'card.moveToBoard', id: a, boardId: b, listId: c, position: 'a0' })
        .ok,
    ).toBe(true);
    expect(parseOp({ opId: ID(), op: 'card.clone', id: a, newId: b }).ok).toBe(true);
    for (const bad of [
      { op: 'card.moveToBoard', id: a, listId: c, position: 'a0' },
      { op: 'card.moveToBoard', id: a, boardId: b, listId: c, position: '' },
      { op: 'card.moveToBoard', id: a, boardId: b, listId: c, position: 'a0', labels: [] },
      { op: 'card.clone', id: a },
      { op: 'card.clone', id: a, newId: 'x' },
      { op: 'card.clone', id: a, newId: b, comments: true },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('takes publishing and unpublishing by board id alone', () => {
    const a = ID();
    expect(parseOp({ opId: ID(), op: 'board.publish', id: a }).ok).toBe(true);
    expect(parseOp({ opId: ID(), op: 'board.unpublish', id: a }).ok).toBe(true);
    for (const bad of [
      { op: 'board.publish' },
      { op: 'board.publish', id: 'x' },
      { op: 'board.publish', id: a, token: 'chosen' },
    ])
      expect(parseOp({ opId: ID(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it('refuses a colour that is not #rrggbb, a position that is not one, a blank name and a key it does not take', () => {
    const [a, b] = [ID(), ID()];
    const bad: unknown[] = [
      { op: 'board.create', id: a, workspaceId: b, name: 'x', color: 'blue' },
      { op: 'board.create', id: a, workspaceId: b, name: 'x', color: '#2563EB' },
      { op: 'board.create', id: a, workspaceId: b, name: '  ', color: '#2563eb' },
      {
        op: 'board.create',
        id: a,
        workspaceId: b,
        name: 'x',
        color: '#2563eb',
        visibility: 'private',
      },
      { op: 'list.create', id: a, boardId: b, name: 'x', position: '' },
      { op: 'list.create', id: a, boardId: b, name: 'x', position: 'a b' },
      { op: 'list.create', id: a, boardId: b, name: 'x', position: 'a'.repeat(65) },
      { op: 'list.move', id: a, position: 'a1', boardId: b },
      { op: 'list.rename', id: a, name: 'x'.repeat(101) },
      { op: 'list.delete', id: 'x' },
    ];
    for (const each of bad)
      expect(parseOp({ opId: ID(), ...(each as object) }).ok, JSON.stringify(each)).toBe(false);
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

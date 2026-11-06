import { type Parsed, type Parser, oneOf, text, uuid } from '../access/parse';
import { HEX_COLOR } from '../lists/colors';
import { isPosition } from '../position';
import { OPS, type OpName, type OpRequest, WORKSPACE_LIMITS } from './format';

/**
 * The rules for an operation (DESIGN.md §7.3), **in one module, run in both places**: in the browser before it is sent, so a person is told at once, and
 * on the server for everything it receives. Pure. A reason never contains the input.
 *
 * An operation is a closed record: the keys of its kind and nothing else, so that a device cannot say more than the server reads.
 */
const no = (reason: string): Parsed<never> => ({ ok: false, reason });

const NAME = text(1, WORKSPACE_LIMITS.nameChars);

/** The arguments each kind takes, beside `opId` and `op`. */
const ARGUMENTS: Record<OpName, readonly string[]> = {
  'workspace.create': ['id', 'name'],
  'workspace.rename': ['id', 'name'],
  'workspace.delete': ['id', 'name'],
  'member.add': ['workspaceId', 'email'],
  'member.setRole': ['workspaceId', 'accountId', 'role'],
  'member.remove': ['workspaceId', 'accountId'],
  'member.leave': ['workspaceId'],
  'board.create': ['id', 'workspaceId', 'name', 'color'],
  'list.create': ['id', 'boardId', 'name', 'position'],
  'list.rename': ['id', 'name'],
  'list.move': ['id', 'position'],
  'list.delete': ['id'],
  'card.create': ['id', 'listId', 'title', 'position'],
  'card.move': ['id', 'listId', 'position'],
  'card.archive': ['id'],
  'card.restore': ['id'],
  'card.delete': ['id'],
  'card.rename': ['id', 'title'],
  'card.describe': ['id', 'description'],
};

const DESCRIPTION = text(0, WORKSPACE_LIMITS.descriptionChars);

const TITLE = text(1, WORKSPACE_LIMITS.cardTitleChars);

const POSITION: Parser<string> = (value) =>
  typeof value === 'string' && value.length <= WORKSPACE_LIMITS.positionChars && isPosition(value)
    ? { ok: true, value }
    : { ok: false, reason: 'not a position' };

const ROLE = oneOf('owner', 'member');
/** An address as a person types it: one @ with something either side, no space. Whether it belongs to an account is the server's to say. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX = 254;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export function parseOp(value: unknown): Parsed<OpRequest> {
  if (!isRecord(value)) return no('an operation is an object');
  const opId = uuid(value.opId);
  if (!opId.ok) return no('opId: not an id');
  const name = value.op;
  if (typeof name !== 'string' || !(OPS as readonly string[]).includes(name))
    return no('not an operation');
  const kind = name as OpName;
  const allowed = ['opId', 'op', ...ARGUMENTS[kind]];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    return no('an operation names something it does not take');

  switch (kind) {
    case 'workspace.create':
    case 'workspace.rename':
    case 'workspace.delete': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      // A name is what is written, trimmed: a blank one is no name.
      const trimmed = typeof value.name === 'string' ? value.name.trim() : value.name;
      const parsed = NAME(trimmed);
      if (!parsed.ok) return no(`name: ${parsed.reason}`);
      return { ok: true, value: { opId: opId.value, op: kind, id: id.value, name: parsed.value } };
    }
    case 'member.add': {
      const workspaceId = uuid(value.workspaceId);
      if (!workspaceId.ok) return no('workspaceId: not an id');
      // Trimmed and lower case, as accounts are looked up: an address is not told apart by its capitals.
      const typed =
        typeof value.email === 'string' ? value.email.trim().toLowerCase() : value.email;
      if (typeof typed !== 'string' || typed.length > EMAIL_MAX || !EMAIL.test(typed))
        return no('email: not an address');
      return {
        ok: true,
        value: { opId: opId.value, op: kind, workspaceId: workspaceId.value, email: typed },
      };
    }
    case 'member.setRole': {
      const workspaceId = uuid(value.workspaceId);
      if (!workspaceId.ok) return no('workspaceId: not an id');
      const accountId = text(1, 128)(value.accountId);
      if (!accountId.ok) return no('accountId: not an id');
      const role = ROLE(value.role);
      if (!role.ok) return no('role: not a role');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          workspaceId: workspaceId.value,
          accountId: accountId.value,
          role: role.value,
        },
      };
    }
    case 'member.remove': {
      const workspaceId = uuid(value.workspaceId);
      if (!workspaceId.ok) return no('workspaceId: not an id');
      const accountId = text(1, 128)(value.accountId);
      if (!accountId.ok) return no('accountId: not an id');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          workspaceId: workspaceId.value,
          accountId: accountId.value,
        },
      };
    }
    case 'member.leave': {
      const workspaceId = uuid(value.workspaceId);
      if (!workspaceId.ok) return no('workspaceId: not an id');
      return { ok: true, value: { opId: opId.value, op: kind, workspaceId: workspaceId.value } };
    }
    case 'board.create': {
      const id = uuid(value.id);
      const workspaceId = uuid(value.workspaceId);
      if (!id.ok || !workspaceId.ok) return no('not an id');
      const name = NAME(typeof value.name === 'string' ? value.name.trim() : value.name);
      if (!name.ok) return no(`name: ${name.reason}`);
      if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color))
        return no('color: not a colour');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          id: id.value,
          workspaceId: workspaceId.value,
          name: name.value,
          color: value.color,
        },
      };
    }
    case 'list.create': {
      const id = uuid(value.id);
      const boardId = uuid(value.boardId);
      if (!id.ok || !boardId.ok) return no('not an id');
      const name = NAME(typeof value.name === 'string' ? value.name.trim() : value.name);
      if (!name.ok) return no(`name: ${name.reason}`);
      const position = POSITION(value.position);
      if (!position.ok) return no('position: not a position');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          id: id.value,
          boardId: boardId.value,
          name: name.value,
          position: position.value,
        },
      };
    }
    case 'list.rename': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      const name = NAME(typeof value.name === 'string' ? value.name.trim() : value.name);
      if (!name.ok) return no(`name: ${name.reason}`);
      return { ok: true, value: { opId: opId.value, op: kind, id: id.value, name: name.value } };
    }
    case 'list.move': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      const position = POSITION(value.position);
      if (!position.ok) return no('position: not a position');
      return {
        ok: true,
        value: { opId: opId.value, op: kind, id: id.value, position: position.value },
      };
    }
    case 'list.delete': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      return { ok: true, value: { opId: opId.value, op: kind, id: id.value } };
    }
    case 'card.create': {
      const id = uuid(value.id);
      const listId = uuid(value.listId);
      if (!id.ok || !listId.ok) return no('not an id');
      const title = TITLE(typeof value.title === 'string' ? value.title.trim() : value.title);
      if (!title.ok) return no(`title: ${title.reason}`);
      const position = POSITION(value.position);
      if (!position.ok) return no('position: not a position');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          id: id.value,
          listId: listId.value,
          title: title.value,
          position: position.value,
        },
      };
    }
    case 'card.move': {
      const id = uuid(value.id);
      const listId = uuid(value.listId);
      if (!id.ok || !listId.ok) return no('not an id');
      const position = POSITION(value.position);
      if (!position.ok) return no('position: not a position');
      return {
        ok: true,
        value: {
          opId: opId.value,
          op: kind,
          id: id.value,
          listId: listId.value,
          position: position.value,
        },
      };
    }
    case 'card.archive':
    case 'card.restore':
    case 'card.delete': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      return { ok: true, value: { opId: opId.value, op: kind, id: id.value } };
    }
    case 'card.rename': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      const title = TITLE(typeof value.title === 'string' ? value.title.trim() : value.title);
      if (!title.ok) return no(`title: ${title.reason}`);
      return { ok: true, value: { opId: opId.value, op: kind, id: id.value, title: title.value } };
    }
    case 'card.describe': {
      const id = uuid(value.id);
      if (!id.ok) return no('id: not an id');
      const description = DESCRIPTION(value.description);
      if (!description.ok) return no(`description: ${description.reason}`);
      return {
        ok: true,
        value: { opId: opId.value, op: kind, id: id.value, description: description.value },
      };
    }
  }
}

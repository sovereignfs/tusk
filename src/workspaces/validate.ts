import { type Parsed, text, uuid } from '../access/parse';
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
};

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
  }
}

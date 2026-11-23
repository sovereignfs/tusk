import { createSovereign } from '@sovereignfs/sdk';
import { authDirectory } from '../auth/directory';
import { takeSnapshot } from '../backup/snapshot';
import { getConfig } from '../config/current';
import { operatorOf } from '../crypto/operator';
import { getAuthStore, getDatabase } from '../db/boot';
import { accountOfSub } from '../sovereign/identity';
import type { TuskExport } from './format';
import packageJson from '../../package.json';

/** One file of records in a person's export: its path in the archive, its kind, its lines, and whether they are sealed with the person's own key. */
export interface RecordsPart {
  readonly path: string;
  readonly kind: string;
  readonly records: readonly Record<string, unknown>[];
  readonly endToEnd: boolean;
}

/** A time Tusk's file holds in milliseconds, written as the export format asks: ISO 8601 in UTC. Nested values are walked; everything else is as it is. */
export function timed(value: unknown, name = ''): unknown {
  if (typeof value === 'number' && /At$/.test(name)) return new Date(value).toISOString();
  if (Array.isArray(value)) return value.map((each) => timed(each));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, field]) => [
        key,
        timed(field, key),
      ]),
    );
  return value;
}

const part = (kind: string, records: readonly unknown[], endToEnd = false): RecordsPart => ({
  path: `apps/tusk/records/${kind}.jsonl`,
  kind,
  records: records.map((record) => timed(record) as Record<string, unknown>),
  endToEnd,
});

/**
 * The person's "everything" file (DESIGN.md §20.1), as records of the export format (`contracts/export.md` §3): the Desk's lists (each with its cards) and
 * series, and each workspace they own (each with its boards). A Desk with a key of the person's own is as the server holds it, every field ciphertext and
 * each list's key wrapped, in files marked end to end; the browser's own export is the one that opens it. Kinds with nothing in them are left out.
 */
export function fileRecords(file: TuskExport): RecordsPart[] {
  const parts: RecordsPart[] = [];
  if (file.desk) {
    parts.push(part('desk_list', file.desk.lists), part('desk_series', file.desk.series));
  }
  if (file.sealedDesk) {
    const sealed = file.sealedDesk;
    parts.push(
      part('sealed_desk_list', sealed.lists, true),
      part('sealed_desk_card', sealed.cards, true),
      part('sealed_desk_check', sealed.checks, true),
      part('sealed_desk_series', sealed.series, true),
    );
  }
  parts.push(part('workspace', file.workspaces ?? []));
  return parts.filter((each) => each.records.length > 0);
}

/**
 * What the SDK remembers of a token it has seen, so that a replay is refused. Tusk keeps its own sessions with better-auth, so this holds nothing else; it
 * is in memory, since an export asked for twice is the same export (sdk §9.1) and no harm comes of a second.
 */
const seen = new Map<string, { record: unknown; expiresAt: number }>();
const replays = {
  get: (id: string) => {
    const kept = seen.get(id);
    if (!kept || kept.expiresAt < Date.now()) return undefined;
    return kept.record as never;
  },
  set: (id: string, record: unknown, expiresAt: number) => void seen.set(id, { record, expiresAt }),
  delete: (id: string) => void seen.delete(id),
  deleteMatching: () => undefined,
};

/**
 * **Core's export of a person** (`signIn.export`, sdk §9.1): core asks for Tusk's part with a signed token, and the SDK checks it (a replay refused),
 * answers at once with an export in the contract's format, and finishes it as the records are written. The part is what a backup holds (`takeSnapshot`),
 * read on the server. A person Tusk does not know gets an empty part. `undefined` where core is not set: the route is then not there.
 */
export async function answerCoreExport(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  const core = config.auth?.sovereign;
  if (!core || !config.url) return undefined;
  const client = createSovereign({
    appUrl: config.url,
    coreUrl: new URL(core.issuer).origin,
    clientId: core.clientId,
    clientSecret: core.clientSecret,
    sessionStore: replays,
  });
  return client.auth.handleExportRequest(
    request,
    { prefix: 'tusk', version: packageJson.version },
    async ({ sub, writer }) => {
      const authDatabase = await getAuthStore();
      const accountId = await accountOfSub(authDatabase, sub);
      if (!accountId) return;
      const operator = operatorOf(config);
      const { file } = await takeSnapshot(
        await getDatabase(),
        authDirectory(authDatabase),
        accountId,
        new Date(),
        ...(operator ? [operator] : []),
      );
      for (const each of fileRecords(file))
        await writer.addRecords(each.path, each.kind, [...each.records], {
          endToEnd: each.endToEnd,
        });
    },
  );
}

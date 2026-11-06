import type { SyncClient } from '../sync/client';
import { allDeskRows } from '../local/store';
import {
  type TuskExport,
  type WorkspacePart,
  buildDesk,
  envelope,
  fileNameOf,
  serialise,
} from './format';

/**
 * The browser's half of an export (DESIGN.md §20.1). **The Desk is made here, from the working copy,** so that it is the same on any encryption mode and
 * works with no network; if there is one it is synced first, so that the file has what the person has done on their other devices. "Everything" joins that
 * to the server's part (the workspaces the person owns), and needs the network for it.
 */
export async function deskFile(client: SyncClient, now = new Date()): Promise<TuskExport> {
  // Online, what other devices wrote comes first; offline, `sync` answers `offline` and the copy is what there is.
  if (typeof navigator === 'undefined' || navigator.onLine !== false) await client.sync();
  const rows = await client.read(allDeskRows);
  return envelope('desk', { desk: buildDesk(rows) }, now);
}

/** The Desk, and every workspace the person owns. Throws if the server cannot be reached: a file that said "everything" and had not all of it would lie. */
export async function everythingFile(client: SyncClient, now = new Date()): Promise<TuskExport> {
  const desk = (await deskFile(client, now)).desk;
  const reply = await fetch('/api/export?scope=owned', { cache: 'no-store' });
  if (!reply.ok) throw new Error('the server could not be reached');
  const server = (await reply.json()) as { workspaces?: WorkspacePart[] };
  return envelope(
    'everything',
    { ...(desk ? { desk } : {}), workspaces: server.workspaces ?? [] },
    now,
  );
}

/** Saves a file as the browser saves a download, named `tusk-<scope>-<date>.json`. */
export function save(file: TuskExport, now = new Date()): void {
  const blob = new Blob([serialise(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameOf(file.scope, now);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

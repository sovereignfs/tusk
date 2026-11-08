import type { Database } from '../db/client';
import { readSettings } from '../settings/account-settings';
import { openText } from '../workspaces/content';
import { type NoticeKind } from '../workspaces/format';
import { claimUnsent } from '../workspaces/notices';
import { type Channel, type Log, fanOut } from './channels';

/**
 * Sending Inbox notices outside the app (DESIGN.md §25.2, task 8.3). **The database decides who sends:** a notice is claimed by one conditional update that stamps
 * `sent_at`, which only one process wins however many run this, and the notice was written (and is shown in the Inbox) in the transaction of what caused it, so the
 * channels fan out after that and never before it. Everything claimed is looked at once: a notice of a kind the person did not ask to have sent is claimed and left,
 * which is what keeps it from being looked at again. **A notice is not sent twice on a lost answer, and a failed send is not retried**: a late notice is worth less
 * than a repeated one. Only a day's notices are looked at, so a job that was down for a week does not send a week's.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** What an Inbox notice says as a line of its own, outside the Inbox. The subject is what it is about, as it was then (§16). */
export function noticeText(kind: NoticeKind, subject: string): string {
  const quoted = `“${subject.length > 100 ? `${subject.slice(0, 99)}…` : subject}”`;
  switch (kind) {
    case 'assigned':
      return `You were assigned ${quoted}`;
    case 'comment':
      return `New comment on ${quoted}`;
    case 'added_to_workspace':
      return `You were added to the workspace ${quoted}`;
    case 'added_to_board':
      return `You were added to the board ${quoted}`;
    case 'backup_stopped':
      return 'Your automatic backups stopped';
    case 'brief':
      return subject;
    case 'reminder':
      // A Desk the server cannot read has no title to give (task 14.6).
      return subject === '' ? 'You have cards due' : `Due now: ${quoted}`;
    case 'workspace_passed':
      return `The workspace ${quoted} was passed to you`;
  }
}

const subjectOf = (details: string): string => {
  try {
    const parsed: unknown = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && 'title' in parsed
      ? String((parsed as { title: unknown }).title)
      : '';
  } catch {
    return '';
  }
};

export interface Delivered {
  /** How many notices this run claimed. */
  readonly claimed: number;
  /** How many of them were of a kind someone asked to have sent, and so were fanned out. */
  readonly fannedOut: number;
}

export async function deliverNotices(
  database: Database,
  channels: readonly Channel[],
  now: number,
  options: { limit?: number; log?: Log } = {},
): Promise<Delivered> {
  const rows = await claimUnsent(database, now, now - WINDOW_MS, options.limit ?? 100);
  const asked = new Map<string, readonly NoticeKind[]>();
  let fannedOut = 0;
  for (const row of rows) {
    let kinds = asked.get(row.accountId);
    if (!kinds) {
      kinds = (await readSettings(database, row.accountId)).sentKinds;
      asked.set(row.accountId, kinds);
    }
    // The brief and a reminder have a switch of their own, and are only written for the person who turned it on: they are sent, not asked for by kind.
    if (
      row.kind !== 'brief' &&
      row.kind !== 'reminder' &&
      !(kinds as readonly string[]).includes(row.kind)
    )
      continue;
    fannedOut += 1;
    const subject = subjectOf(openText('notice', row.id, 'details', row.details));
    await fanOut(
      channels,
      {
        accountId: row.accountId,
        kind: row.kind,
        title: noticeText(row.kind as NoticeKind, subject),
        // A reminder with no subject is the one made for a Desk that cannot be read (task 14.6): a device is woken to say what is due.
        ...(row.kind === 'reminder' && subject === ''
          ? { wake: true, path: '/desk' }
          : { path: '/inbox' }),
        key: row.id,
      },
      options.log,
    );
  }
  return { claimed: rows.length, fannedOut };
}

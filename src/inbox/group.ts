import { addDays, localNow, todayFor } from '../time';
import type { NoticeKind, NoticeRow } from '../workspaces/format';

/**
 * How the Inbox reads (DESIGN.md §16). Pure, and given the time and the zone, so that it is tested with no clock: notices are grouped by the day they
 * were written in the person's own zone, as "Today", "Yesterday" or the date, newest day first and newest notice first within it.
 */
export interface DayGroup {
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly label: string;
  readonly notices: readonly NoticeRow[];
}

export function groupByDay(
  notices: readonly NoticeRow[],
  now: number,
  zone: string,
  locale?: string,
): DayGroup[] {
  const today = todayFor(zone, now);
  const yesterday = addDays(today, -1);
  const groups = new Map<string, NoticeRow[]>();
  for (const notice of [...notices].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  )) {
    const date = localNow(zone, notice.createdAt).date;
    groups.set(date, [...(groups.get(date) ?? []), notice]);
  }
  return [...groups]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, list]) => {
      const [y, m, d] = date.split('-').map(Number);
      return {
        date,
        label:
          date === today
            ? 'Today'
            : date === yesterday
              ? 'Yesterday'
              : new Intl.DateTimeFormat(locale, {
                  timeZone: 'UTC',
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
                }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))),
        notices: list,
      };
    });
}

/** What a notice says, in words: who did what to what. */
export function noticeText(notice: Pick<NoticeRow, 'kind' | 'actorName' | 'subject'>): string {
  const who = notice.actorName ?? 'Someone';
  const what = notice.subject === '' ? 'a card' : notice.subject;
  const texts: Record<NoticeKind, string> = {
    assigned: `${who} assigned you to ${what}`,
    comment: `${who} commented on ${what}`,
    added_to_workspace: `${who} added you to the workspace ${notice.subject}`,
    added_to_board: `${who} added you to the board ${notice.subject}`,
    backup_stopped: backupStoppedText(notice.subject),
  };
  return texts[notice.kind];
}

/** What a stopped backup says, by the kind of failure (a word of ours): why, and what to do. */
function backupStoppedText(kind: string): string {
  const why: Record<string, string> = {
    token_rejected: 'GitHub no longer accepts the saved token',
    read_only: 'the saved token can no longer write to the repository',
    not_visible: 'the repository cannot be seen any more',
    public: 'the repository has been made public',
    empty: 'the repository has nothing in it',
    too_large: 'everything together is over 50 MB',
    key_unconfirmed: 'your Desk has a key now and backups wait for you to confirm it',
    no_key: 'this server has lost its encryption key',
  };
  return `Automatic backups have stopped: ${why[kind] ?? 'a backup could not be made'}. Open Settings, Data, to see what to do.`;
}

/** Where a notice goes when it is opened: the card, the board or the workspace it is about. */
export function noticeHref(
  notice: Pick<NoticeRow, 'workspaceId' | 'boardId' | 'cardId'> & { kind?: NoticeRow['kind'] },
): string {
  if (notice.kind === 'backup_stopped') return '/account?section=data';
  if (notice.boardId && notice.cardId) return `/b/${notice.boardId}/c/${notice.cardId}`;
  if (notice.boardId) return `/b/${notice.boardId}`;
  if (notice.workspaceId) return `/w/${notice.workspaceId}`;
  return '/boards';
}

/** The count shown on the sidebar's Inbox entry: nothing for none, the number, and "99+" for a hundred or more. */
export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count >= 100 ? '99+' : String(count);
}

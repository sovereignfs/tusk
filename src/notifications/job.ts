import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import * as postgresApp from '../db/schema/postgres/app';
import * as sqliteApp from '../db/schema/sqlite/app';
import { operatorRing } from '../workspaces/content';
import {
  assignedDueCounts,
  claimBoardReminder,
  dueBoardCards,
  peopleToRemind,
} from '../workspaces/due';
import { raiseSystem } from '../workspaces/notices';
import { openStored } from '../sync/operator-fields';
import { decodeFields } from '../sync/validate';
import { type LocalNow, localNow } from '../time';

/**
 * The daily brief and the reminders at a due time (DESIGN.md §25.2, tasks 8.5 and 8.6), one job at one minute. **The database decides who sends, by a conditional
 * update**, so any process may run it and one does: the brief by a claim on `account_settings.last_digest_on`, a reminder by a claim on the card's
 * `reminded_for`, each in the transaction that writes the Inbox notice. Fan-out to email, core's bell and Push is `send-notices`' (task 8.3), which takes the notice
 * from there, so a failed channel loses nothing (the Inbox has it) and is not retried.
 *
 * **Zones are worked out in JavaScript, one query for each zone** (`src/time.ts`): the local date and time of the zone now, and the accounts and cards that are due in
 * it. A day is the account's own, so a brief at 08:00 is 08:00 where they are, either side of midnight in UTC. The time `now` is given, never read.
 *
 * What the server can count is what it can read: the mirrors of the due date and time (`due_date`, `due_time`) that it fills in for a card it can read. **A Desk sealed
 * with a key of its own has no mirrors and is not counted here**; times for it come with task 14.6.
 */
export const REMINDER_WINDOW_MINUTES = 30;
/** The most reminders written in one tick, so that a first run after a long stop cannot write thousands at once. */
export const REMINDER_CAP = 200;

const settings = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.accountSettings : sqliteApp.accountSettings;
const deskCard = (database: Database) =>
  database.dialect === 'postgres' ? postgresApp.deskCard : sqliteApp.deskCard;

/** `HH:MM` less some minutes, never before midnight: the earliest a reminder of today is still worth sending. */
export function minusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** What the brief says: "3 due today · 2 overdue", the counts that are not nothing. */
export function briefLine(today: number, overdue: number): string {
  const parts = [
    ...(today > 0 ? [`${today} due today`] : []),
    ...(overdue > 0 ? [`${overdue} overdue`] : []),
  ];
  return parts.join(' · ');
}

export interface Ticked {
  /** Briefs written (claimed, and not a quiet day). */
  readonly briefs: number;
  /** Briefs claimed on a quiet day: written to nothing. */
  readonly quiet: number;
  readonly reminders: number;
}

export async function tick(
  database: Database,
  now: number,
  options: { cap?: number } = {},
): Promise<Ticked> {
  const cap = options.cap ?? REMINDER_CAP;
  const zones = await dbAll<{ zone: string }>(
    database,
    sql`SELECT DISTINCT time_zone AS zone FROM ${settings(database)} WHERE brief_on = ${flag(database, true)} OR reminders_on = ${flag(database, true)}`,
  );
  const total = { briefs: 0, quiet: 0, reminders: 0 };
  for (const { zone } of zones) {
    const local = localNow(zone, now);
    const brief = await briefs(database, zone, local, now);
    total.briefs += brief.written;
    total.quiet += brief.quiet;
    total.reminders += await reminders(database, zone, local, now, cap - total.reminders);
  }
  return total;
}

const flag = (database: Database, value: boolean) =>
  database.dialect === 'postgres' ? value : value ? 1 : 0;

async function briefs(database: Database, zone: string, local: LocalNow, now: number) {
  const due = await dbAll<{ accountId: string }>(
    database,
    sql`SELECT account_id AS "accountId" FROM ${settings(database)}
        WHERE time_zone = ${zone} AND brief_on = ${flag(database, true)} AND brief_at <= ${local.time}
          AND (last_digest_on IS NULL OR last_digest_on <> ${local.date})`,
  );
  let written = 0;
  let quiet = 0;
  for (const { accountId } of due) {
    await transaction(database, async (tx) => {
      // The claim: only one process gets this row for this day.
      const claimed = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${settings(tx)} SET last_digest_on = ${local.date}
            WHERE account_id = ${accountId} AND brief_on = ${flag(tx, true)} AND (last_digest_on IS NULL OR last_digest_on <> ${local.date})
            RETURNING account_id AS id`,
      );
      if (claimed.length === 0) return;
      const counts = await countsFor(tx, accountId, local.date);
      const line = briefLine(counts.today, counts.overdue);
      // A quiet day writes nothing, and keeps the claim: there is no second look at it.
      if (line === '') return void (quiet += 1);
      await raiseSystem(tx, { recipient: accountId, kind: 'brief', subject: line }, now);
      written += 1;
    });
  }
  return { written, quiet };
}

/** How many open cards are due today and overdue: the Desk's (from the mirrors) and the board cards assigned to the account. */
async function countsFor(tx: Database, accountId: string, date: string) {
  const desk = await dbGet<{ today: number | string | null; overdue: number | string | null }>(
    tx,
    sql`SELECT SUM(CASE WHEN due_date = ${date} THEN 1 ELSE 0 END) AS today, SUM(CASE WHEN due_date < ${date} THEN 1 ELSE 0 END) AS overdue
        FROM ${deskCard(tx)} WHERE owner_id = ${accountId} AND deleted_at IS NULL AND completed_at IS NULL AND due_date IS NOT NULL AND due_date <= ${date}`,
  );
  const board = await assignedDueCounts(tx, accountId, date);
  return {
    today: Number(desk?.today ?? 0) + board.today,
    overdue: Number(desk?.overdue ?? 0) + board.overdue,
  };
}

async function reminders(
  database: Database,
  zone: string,
  local: LocalNow,
  now: number,
  room: number,
): Promise<number> {
  if (room <= 0) return 0;
  const since = minusMinutes(local.time, REMINDER_WINDOW_MINUTES);
  let sent = 0;

  // Desk cards: the account's own, with the mirrors of the date and time.
  const desk = await dbAll<{ id: string; ownerId: string; fields: string }>(
    database,
    sql`SELECT c.id AS id, c.owner_id AS "ownerId", c.fields AS fields
        FROM ${deskCard(database)} c JOIN ${settings(database)} s ON s.account_id = c.owner_id
        WHERE s.reminders_on = ${flag(database, true)} AND s.time_zone = ${zone}
          AND c.due_date = ${local.date} AND c.due_time IS NOT NULL AND c.due_time <= ${local.time} AND c.due_time >= ${since}
          AND c.deleted_at IS NULL AND c.completed_at IS NULL
          AND (c.reminded_for IS NULL OR c.reminded_for <> c.due_date || ' ' || c.due_time)
        ORDER BY c.due_time, c.id LIMIT ${room}`,
  );
  for (const card of desk) {
    await transaction(database, async (tx) => {
      const claimed = await dbAll<{ id: string }>(
        tx,
        sql`UPDATE ${deskCard(tx)} SET reminded_for = due_date || ' ' || due_time
            WHERE id = ${card.id} AND owner_id = ${card.ownerId} AND due_date = ${local.date} AND due_time IS NOT NULL AND due_time <= ${local.time}
              AND deleted_at IS NULL AND completed_at IS NULL AND (reminded_for IS NULL OR reminded_for <> due_date || ' ' || due_time)
            RETURNING id`,
      );
      if (claimed.length === 0) return;
      await raiseSystem(
        tx,
        { recipient: card.ownerId, kind: 'reminder', subject: deskTitle(card.id, card.fields) },
        now,
      );
      sent += 1;
    });
  }

  // Board cards: one reminder for each person assigned, who has reminders on and is in this zone. One claim for the card.
  const board = await dueBoardCards(database, zone, local, since, Math.max(0, room - sent));
  for (const card of board) {
    await transaction(database, async (tx) => {
      if (!(await claimBoardReminder(tx, card.id, local))) return;
      const people = await peopleToRemind(tx, card.id, zone);
      for (const person of people)
        await raiseSystem(
          tx,
          {
            recipient: person,
            kind: 'reminder',
            subject: card.title,
            workspaceId: card.workspaceId,
            boardId: card.boardId,
            cardId: card.id,
          },
          now,
        );
      sent += people.length;
    });
  }
  return sent;
}

/** A Desk card's title as the server can read it: plain, or sealed under the operator key; a card it cannot read says "A card". */
function deskTitle(id: string, fieldsText: string): string {
  const decoded = decodeFields(fieldsText);
  if (!decoded.ok) return 'A card';
  try {
    const field = openStored(operatorRing(), 'desk_card', id, decoded.value).title;
    return field && 'v' in field && typeof field.v === 'string' && field.v !== ''
      ? field.v
      : 'A card';
  } catch {
    return 'A card';
  }
}

import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import type { ActivityKind, OpRequest, OpRows } from './format';
import type { Details } from './describe';
import { openText, sealText } from './content';
import { tablesOf } from './tables';

/**
 * What the server writes of a change, **in the transaction of the change** (DESIGN.md §15.6, §7.3): never the browser, never later, and so never a change
 * without its row or a row without its change. Each row keeps the names its sentence needs as they were, so that it reads the same after a card is
 * renamed or deleted; it keeps the card's id, which may point at nothing. It is not edited, and goes only with its board or its workspace.
 *
 * `capture` is read before the operation, for the names the change is about to take away (a card's title before it is renamed, the list it leaves);
 * `record` is called after the operation has succeeded, with what it answered. A refused operation rolls both back with everything else.
 */
export interface Before {
  card?: {
    id: string;
    title: string;
    listId: string;
    listName: string;
    boardId: string;
    assigned: readonly string[];
  };
  toList?: { id: string; name: string };
  list?: { id: string; name: string; boardId: string };
  item?: { title: string; cardId: string; cardTitle: string; boardId: string };
  label?: { name: string };
  board?: { id: string; name: string; workspaceId: string };
  /** The board is published (before a publish). */
  published?: boolean;
}

const cardIdOf = (request: OpRequest): string | undefined =>
  'cardId' in request
    ? request.cardId
    : request.op.startsWith('card.') && 'id' in request
      ? request.id
      : undefined;

export async function capture(tx: Database, request: OpRequest): Promise<Before> {
  const t = tablesOf(tx);
  const before: Before = {};
  const cardId = cardIdOf(request);
  if (cardId) {
    const card = await dbGet<{
      id: string;
      title: string;
      listId: string;
      listName: string;
      boardId: string;
    }>(
      tx,
      sql`SELECT c.id AS id, c.title AS title, c.list_id AS "listId", l.name AS "listName", c.board_id AS "boardId"
          FROM ${t.card} c JOIN ${t.boardList} l ON l.id = c.list_id WHERE c.id = ${cardId}`,
    );
    if (card) {
      const assigned = await dbAll<{ id: string }>(
        tx,
        sql`SELECT account_id AS id FROM ${t.cardAssignee} WHERE card_id = ${cardId}`,
      );
      before.card = {
        ...card,
        title: openText('card', card.id, 'title', card.title),
        listName: openText('board_list', card.listId, 'name', card.listName),
        assigned: assigned.map((each) => each.id),
      };
    }
  }
  if (request.op === 'card.move' || request.op === 'card.create') {
    const list = await dbGet<{ id: string; name: string }>(
      tx,
      sql`SELECT id, name FROM ${t.boardList} WHERE id = ${request.listId}`,
    );
    if (list)
      before.toList = { id: list.id, name: openText('board_list', list.id, 'name', list.name) };
  }
  if (request.op === 'list.rename' || request.op === 'list.move' || request.op === 'list.delete') {
    const list = await dbGet<{ id: string; name: string; boardId: string }>(
      tx,
      sql`SELECT id, name, board_id AS "boardId" FROM ${t.boardList} WHERE id = ${request.id}`,
    );
    if (list) before.list = { ...list, name: openText('board_list', list.id, 'name', list.name) };
  }
  if (request.op.startsWith('item.') && request.op !== 'item.add' && 'id' in request) {
    const item = await dbGet<{ title: string; cardId: string; cardTitle: string; boardId: string }>(
      tx,
      sql`SELECT i.title AS title, i.card_id AS "cardId", c.title AS "cardTitle", i.board_id AS "boardId"
          FROM ${t.checklistItem} i JOIN ${t.card} c ON c.id = i.card_id WHERE i.id = ${request.id}`,
    );
    if (item)
      before.item = {
        ...item,
        title: openText('checklist_item', request.id, 'title', item.title),
        cardTitle: openText('card', item.cardId, 'title', item.cardTitle),
      };
  }
  if (request.op === 'label.update' || request.op === 'label.delete') {
    const label = await dbGet<{ name: string }>(
      tx,
      sql`SELECT name FROM ${t.label} WHERE id = ${request.id}`,
    );
    if (label) before.label = { name: openText('label', request.id, 'name', label.name) };
  }
  if (request.op === 'card.addLabel' || request.op === 'card.removeLabel') {
    const label = await dbGet<{ name: string }>(
      tx,
      sql`SELECT name FROM ${t.label} WHERE id = ${request.labelId}`,
    );
    if (label) before.label = { name: openText('label', request.labelId, 'name', label.name) };
  }
  if (request.op === 'board.publish') {
    const there = await dbGet<{ one: number }>(
      tx,
      sql`SELECT 1 AS one FROM ${t.publication} WHERE board_id = ${request.id}`,
    );
    before.published = there !== undefined;
  }
  const boardOp =
    request.op === 'board.update' ||
    request.op === 'board.archive' ||
    request.op === 'board.restore' ||
    request.op === 'board.setVisibility' ||
    request.op === 'board.join' ||
    request.op === 'board.leave';
  if (boardOp) {
    const board = await dbGet<{ id: string; name: string; workspaceId: string }>(
      tx,
      sql`SELECT id, name, workspace_id AS "workspaceId" FROM ${t.board} WHERE id = ${request.id}`,
    );
    if (board) before.board = { ...board, name: openText('board', board.id, 'name', board.name) };
  }
  return before;
}

export async function write(
  tx: Database,
  actorId: string,
  boardId: string,
  cardId: string | null,
  kind: ActivityKind,
  details: Details,
  now: number,
): Promise<void> {
  const id = crypto.randomUUID();
  await dbAll(
    tx,
    sql`INSERT INTO ${tablesOf(tx).activity} (id, board_id, card_id, actor_id, kind, details, created_at)
        VALUES (${id}, ${boardId}, ${cardId}, ${actorId}, ${kind}, ${sealText('activity', id, 'details', JSON.stringify(details))}, ${now})
        RETURNING id`,
  );
}

/** Writes what the operation did, from what it changed and what was true before. */
export async function record(
  tx: Database,
  actorId: string,
  request: OpRequest,
  before: Before,
  rows: OpRows,
  now: number,
): Promise<void> {
  const log = (boardId: string, cardId: string | null, kind: ActivityKind, details: Details) =>
    write(tx, actorId, boardId, cardId, kind, details, now);
  const card = before.card;
  const title = rows.card?.title ?? card?.title;
  switch (request.op) {
    case 'board.create':
      return log(request.id, null, 'board.created', { name: request.name });
    case 'board.update':
      if (before.board && before.board.name !== request.name)
        return log(request.id, null, 'board.renamed', {
          from: before.board.name,
          to: request.name,
        });
      return;
    case 'board.setVisibility':
      return log(request.id, null, 'board.visibility', { visibility: request.visibility });
    case 'board.archive':
      return log(request.id, null, 'board.archived', {});
    case 'board.restore':
      return log(request.id, null, 'board.restored', {});
    case 'board.publish':
      // Only when it was not published already.
      if (!before.published) return log(request.id, null, 'board.published', {});
      return;
    case 'board.unpublish':
      return log(request.id, null, 'board.unpublished', {});
    case 'board.join':
      return log(request.id, null, 'board.joined', {});
    case 'board.leave':
      return log(request.id, null, 'board.left', {});
    case 'boardMember.add':
      return log(request.boardId, null, 'board.member_added', { person: request.accountId });
    case 'boardMember.remove':
      return log(request.boardId, null, 'board.member_removed', { person: request.accountId });
    case 'boardMember.setRole':
      if (request.role === 'owner')
        return log(request.boardId, null, 'board.member_owner', { person: request.accountId });
      return;
    case 'list.create': {
      return log(rows.list?.boardId ?? request.boardId, null, 'list.created', {
        name: request.name,
      });
    }
    case 'list.rename':
      if (before.list && before.list.name !== request.name)
        return log(before.list.boardId, null, 'list.renamed', {
          from: before.list.name,
          to: request.name,
        });
      return;
    case 'list.move':
      if (before.list)
        return log(before.list.boardId, null, 'list.moved', { name: before.list.name });
      return;
    case 'list.delete':
      if (before.list)
        return log(before.list.boardId, null, 'list.deleted', { name: before.list.name });
      return;
    case 'card.create':
      if (rows.card)
        return log(rows.card.boardId, rows.card.id, 'card.created', {
          title: request.title,
          list: before.toList?.name ?? '',
        });
      return;
    case 'card.move':
      if (card && card.listId !== request.listId)
        return log(card.boardId, card.id, 'card.moved', {
          title: card.title,
          from: card.listName,
          to: before.toList?.name ?? '',
        });
      return;
    case 'card.archive':
      if (card) return log(card.boardId, card.id, 'card.archived', { title: card.title });
      return;
    case 'card.restore':
      if (card) return log(card.boardId, card.id, 'card.restored', { title: card.title });
      return;
    case 'card.delete':
      if (card) return log(card.boardId, card.id, 'card.deleted', { title: card.title });
      return;
    case 'card.rename':
      if (card && card.title !== request.title)
        return log(card.boardId, card.id, 'card.renamed', { from: card.title, to: request.title });
      return;
    case 'card.setDue':
      if (card)
        return request.dueDate === null
          ? log(card.boardId, card.id, 'card.due_cleared', { title: card.title })
          : log(card.boardId, card.id, 'card.due_set', {
              title: card.title,
              date: request.dueDate,
              time: request.dueTime,
            });
      return;
    case 'card.addLabel':
    case 'card.removeLabel':
      if (card && before.label)
        return log(
          card.boardId,
          card.id,
          request.op === 'card.addLabel' ? 'card.label_added' : 'card.label_removed',
          {
            title: card.title,
            label: before.label.name === '' ? 'a colour' : before.label.name,
          },
        );
      return;
    case 'card.assign':
      if (card && !card.assigned.includes(request.accountId))
        return log(card.boardId, card.id, 'card.assigned', {
          title: card.title,
          person: request.accountId,
        });
      return;
    case 'card.unassign':
      if (card && card.assigned.includes(request.accountId))
        return log(card.boardId, card.id, 'card.unassigned', {
          title: card.title,
          person: request.accountId,
        });
      return;
    case 'item.add':
      if (rows.card)
        return log(rows.card.boardId, rows.card.id, 'card.item_added', {
          title: rows.card.title,
          item: request.title,
        });
      return;
    case 'item.tick':
      if (before.item && rows.card)
        return log(rows.card.boardId, rows.card.id, 'card.item_ticked', {
          title: before.item.cardTitle,
          item: before.item.title,
        });
      return;
    case 'comment.add':
      if (rows.card)
        return log(rows.card.boardId, rows.card.id, 'card.commented', { title: title ?? '' });
      return;
    default:
      return;
  }
}

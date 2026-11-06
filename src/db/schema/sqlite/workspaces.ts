import { index, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { counter, epochMs, hhmm, id, isoDate, position, ref } from './columns';

/**
 * The tables of workspaces, boards and cards (DESIGN.md §23.3). Unlike the Desk's they are ordinary rows, written only through `POST /api/ops`
 * (`src/workspaces/`), with the permission in the statement (§7.1). There are no foreign keys; every row below a board carries `board_id`, so that deleting
 * a board names what it deletes and a permission is one subquery. Accounts are by value (`account_id`), as everywhere.
 */

/** A workspace: a name, its people and its boards (DESIGN.md §13). `updated_at` moves with every operation in it, for "recently updated" (§17.3). */
export const workspace = sqliteTable('workspace', {
  id: id('id'),
  name: text('name').notNull(),
  createdBy: ref('created_by').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

/** A person in a workspace, and their role. The sidebar and the boards index read it by account. */
export const workspaceMember = sqliteTable(
  'workspace_member',
  {
    workspaceId: ref('workspace_id').notNull(),
    accountId: ref('account_id').notNull(),
    /** `owner` or `member` (§7.2). */
    role: text('role').notNull(),
    addedBy: ref('added_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.accountId] }),
    index('workspace_member_account_idx').on(table.accountId),
  ],
);

/** A board in a workspace (DESIGN.md §14). */
export const board = sqliteTable(
  'board',
  {
    id: id('id'),
    workspaceId: ref('workspace_id').notNull(),
    name: text('name').notNull(),
    /** `#rrggbb`, any colour (§17.7). */
    color: text('color').notNull(),
    description: text('description'),
    /** `public` (everyone in the workspace sees it) or `private` (its members and the workspace's owners; §14.3). */
    visibility: text('visibility').notNull(),
    /** When it was archived, or null. An archived board is read-only for everyone (§14.4). */
    archivedAt: epochMs('archived_at'),
    /** Moved on by every operation on the board, so that an open board can tell it has changed (§14.7). */
    version: counter('version').notNull().default(1),
    createdBy: ref('created_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [index('board_workspace_idx').on(table.workspaceId)],
);

/** A person on a board, who may change its cards. Drawn from the workspace's people (§13.2). */
export const boardMember = sqliteTable(
  'board_member',
  {
    boardId: ref('board_id').notNull(),
    accountId: ref('account_id').notNull(),
    workspaceId: ref('workspace_id').notNull(),
    /** `owner` or `member` (§7.2). */
    role: text('role').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.accountId] }),
    index('board_member_account_idx').on(table.accountId),
  ],
);

/** A list of a board (§14.2). */
export const boardList = sqliteTable(
  'board_list',
  {
    id: id('id'),
    boardId: ref('board_id').notNull(),
    name: text('name').notNull(),
    position: position('position').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [index('board_list_board_idx').on(table.boardId, table.position)],
);

/** A card on a board (§15.1). */
export const card = sqliteTable(
  'card',
  {
    id: id('id'),
    boardId: ref('board_id').notNull(),
    listId: ref('list_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: isoDate('due_date'),
    dueTime: hhmm('due_time'),
    position: position('position').notNull(),
    /** When it was archived, or null (§15.8). */
    archivedAt: epochMs('archived_at'),
    createdBy: ref('created_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
    updatedAt: epochMs('updated_at').notNull(),
  },
  (table) => [
    index('card_list_idx').on(table.listId, table.position),
    index('card_board_idx').on(table.boardId),
  ],
);

/** A label of a board (§15.2). */
export const label = sqliteTable(
  'label',
  {
    id: id('id'),
    boardId: ref('board_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('label_board_idx').on(table.boardId)],
);

/** A label on a card. */
export const cardLabel = sqliteTable(
  'card_label',
  {
    cardId: ref('card_id').notNull(),
    labelId: ref('label_id').notNull(),
    boardId: ref('board_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.labelId] })],
);

/** A member of a board a card is assigned to (§15.3). The Inbox reads it by account. */
export const cardAssignee = sqliteTable(
  'card_assignee',
  {
    cardId: ref('card_id').notNull(),
    accountId: ref('account_id').notNull(),
    boardId: ref('board_id').notNull(),
    assignedBy: ref('assigned_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.accountId] }),
    index('card_assignee_account_idx').on(table.accountId),
  ],
);

/** An item of a board card's checklist (§15.4). */
export const checklistItem = sqliteTable(
  'checklist_item',
  {
    id: id('id'),
    cardId: ref('card_id').notNull(),
    boardId: ref('board_id').notNull(),
    title: text('title').notNull(),
    completedAt: epochMs('completed_at'),
    position: position('position').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('checklist_item_card_idx').on(table.cardId, table.position)],
);

/** A comment on a card (§15.5). */
export const comment = sqliteTable(
  'comment',
  {
    id: id('id'),
    cardId: ref('card_id').notNull(),
    boardId: ref('board_id').notNull(),
    authorId: ref('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: epochMs('created_at').notNull(),
    editedAt: epochMs('edited_at'),
  },
  (table) => [index('comment_card_idx').on(table.cardId, table.createdAt)],
);

/** What happened on a board, written by the server in the transaction of the change (§15.6). */
export const activity = sqliteTable(
  'activity',
  {
    id: id('id'),
    boardId: ref('board_id').notNull(),
    /** The card it is about, which may be gone: activity outlives its card (§15.6). */
    cardId: ref('card_id'),
    actorId: ref('actor_id').notNull(),
    kind: text('kind').notNull(),
    /** JSON text: the names the sentence needs, as they were (§15.6). */
    details: text('details').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [
    index('activity_board_idx').on(table.boardId, table.createdAt),
    index('activity_card_idx').on(table.cardId, table.createdAt),
  ],
);

/** A board's public address (§14.6). */
export const publication = sqliteTable(
  'publication',
  {
    boardId: ref('board_id').primaryKey(),
    /** 32 random bytes, base64url: the address of a published board (§14.6). */
    token: text('token').notNull(),
    createdBy: ref('created_by').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [uniqueIndex('publication_token_idx').on(table.token)],
);

/** Something a person is told about, in their Inbox (§16). */
export const notice = sqliteTable(
  'notice',
  {
    id: id('id'),
    accountId: ref('account_id').notNull(),
    kind: text('kind').notNull(),
    actorId: ref('actor_id'),
    workspaceId: ref('workspace_id'),
    boardId: ref('board_id'),
    cardId: ref('card_id'),
    details: text('details').notNull(),
    createdAt: epochMs('created_at').notNull(),
  },
  (table) => [index('notice_account_idx').on(table.accountId, table.createdAt)],
);

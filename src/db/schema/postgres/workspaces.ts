import { index, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { app } from './app';
import { counter, epochMs, hhmm, id, isoDate, position, ref } from './columns';

/** The tables of workspaces, boards and cards; see `schema/sqlite/workspaces.ts`, which says what each is. */

export const workspace = app.table('workspace', {
  id: id('id'),
  name: text('name').notNull(),
  createdBy: ref('created_by').notNull(),
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

export const workspaceMember = app.table(
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

export const board = app.table(
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

export const boardMember = app.table(
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

export const boardList = app.table(
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

export const card = app.table(
  'card',
  {
    id: id('id'),
    boardId: ref('board_id').notNull(),
    listId: ref('list_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: isoDate('due_date'),
    dueTime: hhmm('due_time'),
    /** When a card that starts at `due_time` ends, the same day (task 19.5): `HH:MM` after it, or null. */
    dueEnd: hhmm('due_end'),
    /** The due date and time (`YYYY-MM-DD HH:MM`) a reminder was last claimed for, as on a Desk card (task 8.6). */
    remindedFor: text('reminded_for'),
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

export const label = app.table(
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

export const cardLabel = app.table(
  'card_label',
  {
    cardId: ref('card_id').notNull(),
    labelId: ref('label_id').notNull(),
    boardId: ref('board_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.cardId, table.labelId] })],
);

export const cardAssignee = app.table(
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

export const checklistItem = app.table(
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

export const comment = app.table(
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

export const activity = app.table(
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

export const publication = app.table(
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

export const notice = app.table(
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
    /** When the job that sends notices outside the app claimed it (DESIGN.md §25.2), which is the one claim there is: null until a process has. */
    sentAt: epochMs('sent_at'),
    /** When the person read it, or null (task 8.7). A notice is also read when it is at or before `account_settings.inbox_seen_at`, which is what "Mark all read" moves on. */
    readAt: epochMs('read_at'),
    /** When the person dismissed it, or null: a dismissed notice is shown nowhere and counts for nothing (task 8.7). */
    dismissedAt: epochMs('dismissed_at'),
  },
  (table) => [index('notice_account_idx').on(table.accountId, table.createdAt)],
);

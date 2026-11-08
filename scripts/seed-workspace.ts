import { sql } from 'drizzle-orm';
import { authDirectory } from '../src/auth/directory';
import type { Database } from '../src/db/client';
import { dbGet, dbRun } from '../src/db/exec';
import * as postgresSchema from '../src/db/schema/postgres';
import * as sqliteSchema from '../src/db/schema/sqlite';
import { applyOp } from '../src/workspaces/apply';
import { openText } from '../src/workspaces/content';
import type { Op, OpRequest } from '../src/workspaces/format';
import { tablesOf } from '../src/workspaces/tables';
import { TUSK_NAMESPACE, uuid5 } from '../src/uuid5';

/**
 * A shared workspace for development (task 11.6): owned by the first seed account, with the second as a member, and a board for each way a board can be.
 * Like the Desk's seed it **goes through the door**: every change is `applyOp`, as one of the two people would have made it, so that the activity and the
 * notices are the ones the app writes, with the checks the app makes. Nothing is written to a table directly except to take it away again.
 *
 * **Idempotent:** every id is derived from a name, and every step has an `opId` derived from its place in the run, so running it again finds every step
 * done and changes nothing. A step added to the run goes at its end; one put in the middle would move the ids after it (and the seed is for development,
 * where `--reset` starts again).
 */
export const WORKSPACE_NAME = 'Seed Studio';

/** The most steps a run has: removal forgets this many `opId`s for each person. */
export const STEP_LIMIT = 400;

const id = (name: string) => uuid5(`seed:workspace:${name}`, TUSK_NAMESPACE);
const opIdOf = (step: number) => uuid5(`seed:workspace:step:${step}`, TUSK_NAMESPACE);

export interface People {
  /** The workspace's owner. */
  one: string;
  /** A member of it. */
  two: string;
}

export interface WorkspaceIds {
  workspace: string;
  boards: { roadmap: string; hiring: string; lastYear: string; website: string };
}

export const workspaceIds = (): WorkspaceIds => ({
  workspace: id('workspace'),
  boards: {
    roadmap: id('board:roadmap'),
    hiring: id('board:hiring'),
    lastYear: id('board:last-year'),
    website: id('board:website'),
  },
});

export interface WorkspaceResult {
  /** Whether this run made the workspace, or found it. */
  created: boolean;
  steps: number;
}

export async function seedWorkspace(
  app: Database,
  auth: Database,
  people: People,
  options: { now: number },
): Promise<WorkspaceResult> {
  const directory = authDirectory(auth);
  const ids = workspaceIds();
  let step = 0;
  let created = false;

  /** One change, as `who` would have made it. A step already done answers as done, and is not done again. */
  const make = async (who: keyof People, op: Op) => {
    const n = step++;
    if (n >= STEP_LIMIT) throw new Error('the workspace seed has more steps than STEP_LIMIT');
    const result = await applyOp(app, people[who], { opId: opIdOf(n), ...op } as OpRequest, {
      now: options.now + n * 1000,
      directory,
    });
    if (result.status === 'refused')
      throw new Error(
        `the workspace seed was refused at step ${n} (${op.op}: ${result.code}${'reason' in result && result.reason ? `, ${result.reason}` : ''})`,
      );
    if (n === 0 && !result.replay) created = true;
    return result;
  };

  const backlog = async (board: string) =>
    (
      await dbGet<{ id: string }>(
        app,
        sql`SELECT id FROM ${tablesOf(app).boardList} WHERE board_id = ${board} ORDER BY created_at, id LIMIT 1`,
      )
    )?.id ?? '';
  const list = (key: string) => id(`list:${key}`);
  const card = (key: string) => id(`card:${key}`);
  const label = (key: string) => id(`label:${key}`);
  const item = (key: string) => id(`item:${key}`);
  const position = (i: number) => `a${i}`;

  // The workspace, and its second person, who is told of it.
  await make('one', { op: 'workspace.create', id: ids.workspace, name: WORKSPACE_NAME });
  await make('one', { op: 'member.add', workspaceId: ids.workspace, email: 'seed2@example.test' });

  // ── A public board with a card at every state ────────────────────────────────────────────────────────────────
  const roadmap = ids.boards.roadmap;
  await make('one', {
    op: 'board.create',
    id: roadmap,
    workspaceId: ids.workspace,
    name: 'Product roadmap',
    color: '#2563eb',
  });
  await make('one', {
    op: 'board.update',
    id: roadmap,
    name: 'Product roadmap',
    color: '#2563eb',
    description: 'What we are building, and in what order.',
  });
  await make('one', { op: 'boardMember.add', boardId: roadmap, accountId: people.two });
  const todo = await backlog(roadmap);
  await make('one', {
    op: 'list.create',
    id: list('doing'),
    boardId: roadmap,
    name: 'Doing',
    position: 'a5',
  });
  await make('one', {
    op: 'list.create',
    id: list('done'),
    boardId: roadmap,
    name: 'Done',
    position: 'a9',
  });
  for (const [key, name, color] of [
    ['bug', 'Bug', '#dc2626'],
    ['feature', 'Feature', '#16a34a'],
    ['urgent', 'Urgent', '#d97706'],
    ['plain', '', '#7c3aed'],
  ] as const)
    await make('one', { op: 'label.create', id: label(key), boardId: roadmap, name, color });

  const cards: { key: string; list: string; title: string; by: keyof People }[] = [
    { key: 'post', list: todo, title: 'Write the launch post', by: 'one' },
    { key: 'login', list: todo, title: 'Fix the login redirect', by: 'two' },
    { key: 'quarter', list: todo, title: 'Plan the next quarter', by: 'one' },
    { key: 'settings', list: list('doing'), title: 'Design the board settings', by: 'one' },
    { key: 'dialog', list: list('done'), title: 'Ship the card dialog', by: 'two' },
    { key: 'old', list: todo, title: 'An old idea', by: 'one' },
  ];
  let n = 0;
  for (const each of cards)
    await make(each.by, {
      op: 'card.create',
      id: card(each.key),
      listId: each.list,
      title: each.title,
      position: position(n++),
    });

  await make('one', {
    op: 'card.describe',
    id: card('quarter'),
    description:
      'Three things, in this order:\n\n1. The mobile app\n2. Search across boards\n3. Reminders\n\nEach with a date.',
  });
  // Labelled, assigned (the other person is told), and due: overdue, soon, and a week away.
  await make('one', { op: 'card.addLabel', cardId: card('post'), labelId: label('feature') });
  await make('one', { op: 'card.assign', cardId: card('post'), accountId: people.two });
  await make('one', {
    op: 'card.setDue',
    id: card('post'),
    dueDate: '2030-06-01',
    dueTime: '09:00',
  });
  await make('one', { op: 'card.addLabel', cardId: card('login'), labelId: label('bug') });
  await make('one', { op: 'card.addLabel', cardId: card('login'), labelId: label('urgent') });
  await make('one', { op: 'card.assign', cardId: card('login'), accountId: people.one });
  await make('two', { op: 'card.setDue', id: card('login'), dueDate: '2026-01-02', dueTime: null });
  await make('one', { op: 'card.assign', cardId: card('settings'), accountId: people.one });
  await make('one', { op: 'card.assign', cardId: card('settings'), accountId: people.two });
  await make('one', { op: 'card.addLabel', cardId: card('settings'), labelId: label('feature') });
  await make('one', { op: 'card.addLabel', cardId: card('settings'), labelId: label('plain') });
  await make('two', { op: 'card.addLabel', cardId: card('dialog'), labelId: label('feature') });
  await make('two', {
    op: 'card.setDue',
    id: card('dialog'),
    dueDate: '2026-11-01',
    dueTime: null,
  });

  // Checklists: part of one done, all of one done while the card is open, none of one.
  const steps: [string, string[], number][] = [
    ['login', ['Reproduce it', 'Find where it redirects', 'Write a test'], 1],
    ['settings', ['Name and colour', 'Description', 'Labels'], 3],
    ['post', ['Outline', 'Draft', 'Pictures', 'Review'], 0],
  ];
  for (const [cardKey, titles, ticked] of steps) {
    let at = 0;
    for (const title of titles) {
      const key = `${cardKey}:${title}`;
      await make('one', {
        op: 'item.add',
        id: item(key),
        cardId: card(cardKey),
        title,
        position: position(at++),
      });
    }
    for (const title of titles.slice(0, ticked))
      await make('one', { op: 'item.tick', id: item(`${cardKey}:${title}`) });
  }

  // Said by both of them.
  await make('two', {
    op: 'comment.add',
    id: id('comment:1'),
    cardId: card('login'),
    body: 'It sends me to /sign-in even when I am signed in.\nOnly on the second tab.',
  });
  await make('one', {
    op: 'comment.add',
    id: id('comment:2'),
    cardId: card('login'),
    body: 'Reproduced. Looking.',
  });
  await make('two', {
    op: 'comment.add',
    id: id('comment:3'),
    cardId: card('settings'),
    body: 'Can the colour be any colour?',
  });
  await make('one', {
    op: 'comment.add',
    id: id('comment:4'),
    cardId: card('settings'),
    body: 'Yes, and the text on it is chosen by contrast.',
  });

  // Moved, cloned, archived, and a card that is only an old idea.
  await make('two', { op: 'card.move', id: card('dialog'), listId: list('done'), position: 'a0' });
  await make('one', { op: 'card.clone', id: card('login'), newId: card('login-copy') });
  await make('one', { op: 'card.archive', id: card('old') });

  // ── A private board: only its members, and the workspace's owners ────────────────────────────────────────────
  const hiring = ids.boards.hiring;
  await make('one', {
    op: 'board.create',
    id: hiring,
    workspaceId: ids.workspace,
    name: 'Hiring',
    color: '#7c3aed',
  });
  await make('one', { op: 'board.setVisibility', id: hiring, visibility: 'private' });
  const interviews = await backlog(hiring);
  await make('one', {
    op: 'card.create',
    id: card('interview-1'),
    listId: interviews,
    title: 'Interview notes: first round',
    position: 'a0',
  });
  await make('one', {
    op: 'card.create',
    id: card('interview-2'),
    listId: interviews,
    title: 'Send the offer',
    position: 'a1',
  });

  // ── An archived board ────────────────────────────────────────────────────────────────────────────────────────
  const lastYear = ids.boards.lastYear;
  await make('one', {
    op: 'board.create',
    id: lastYear,
    workspaceId: ids.workspace,
    name: 'Last year',
    color: '#6b7280',
  });
  await make('one', {
    op: 'card.create',
    id: card('wrapped'),
    listId: await backlog(lastYear),
    title: 'Everything that was finished',
    position: 'a0',
  });
  await make('one', { op: 'board.archive', id: lastYear });

  // ── A published board ────────────────────────────────────────────────────────────────────────────────────────
  const website = ids.boards.website;
  await make('one', {
    op: 'board.create',
    id: website,
    workspaceId: ids.workspace,
    name: 'Marketing site',
    color: '#16a34a',
  });
  await make('one', { op: 'boardMember.add', boardId: website, accountId: people.two });
  const pages = await backlog(website);
  await make('one', {
    op: 'label.create',
    id: label('site'),
    boardId: website,
    name: 'Copy',
    color: '#2563eb',
  });
  await make('one', {
    op: 'card.create',
    id: card('home'),
    listId: pages,
    title: 'Write the home page',
    position: 'a0',
  });
  await make('one', {
    op: 'card.describe',
    id: card('home'),
    description: 'A heading, three sentences, one picture.',
  });
  await make('one', { op: 'card.addLabel', cardId: card('home'), labelId: label('site') });
  await make('one', {
    op: 'item.add',
    id: item('home:heading'),
    cardId: card('home'),
    title: 'Heading',
    position: 'a0',
  });
  await make('one', { op: 'item.tick', id: item('home:heading') });
  await make('one', {
    op: 'card.create',
    id: card('pricing'),
    listId: pages,
    title: 'Pricing page',
    position: 'a1',
  });
  await make('one', { op: 'board.publish', id: website });

  return { created, steps: step };
}

const schemaOf = (database: Database) =>
  database.dialect === 'postgres' ? postgresSchema : sqliteSchema;

/**
 * Takes away the workspace the seed made, by deleting it through the door (everything below it goes with it, in one transaction), and forgets the
 * `opId`s of the steps so that a run starts again. Nothing else is touched. Returns whether there was a workspace.
 */
export async function removeWorkspaceSeed(
  app: Database,
  people: Partial<People>,
  now: number,
): Promise<boolean> {
  const ids = workspaceIds();
  const t = tablesOf(app);
  const found = await dbGet<{ name: string }>(
    app,
    sql`SELECT name FROM ${t.workspace} WHERE id = ${ids.workspace}`,
  );
  if (found && people.one) {
    const result = await applyOp(
      app,
      people.one,
      {
        opId: crypto.randomUUID(),
        op: 'workspace.delete',
        id: ids.workspace,
        // Typed as a person would type it: under the operator key the column holds ciphertext, and what is typed is the name.
        name: openText('workspace', ids.workspace, 'name', found.name),
      },
      { now },
    );
    if (result.status === 'refused')
      throw new Error(`the workspace could not be removed (${result.code})`);
  }
  for (const who of [people.one, people.two])
    if (who)
      for (let n = 0; n < STEP_LIMIT; n++)
        await dbRun(
          app,
          sql`DELETE FROM ${schemaOf(app).appliedMutation} WHERE account_id = ${who} AND id = ${opIdOf(n)}`,
        );
  return found !== undefined;
}

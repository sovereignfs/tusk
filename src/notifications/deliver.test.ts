import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { saveSettings } from '../settings/account-settings';
import { makeStore } from '../sync/test-support';
import { seedBoardContents, seedWorld, type World } from '../workspaces/testing/roles';
import { type Channel, type Outgoing } from './channels';
import { deliverNotices, noticeText } from './deliver';

/** Sending Inbox notices outside the app (DESIGN.md §25.2, task 8.3), on every form of the database. */
const { leg } = testTarget();
const NOW = 1_800_000_000_000;
let database: Database;
let close: () => Promise<void>;
let world: World;
const seen: Outgoing[] = [];
const recorder: Channel = {
  name: 'test',
  send: async (notice) => {
    seen.push(notice);
    return { outcome: 'sent' };
  },
};

beforeAll(async () => {
  ({ database, close } = await makeStore());
  world = await seedWorld(database);
  // One notice, for the world's member: "added to a workspace" (its subject is what the fixture wrote).
  await seedBoardContents(database, world);
});
afterAll(async () => close());

describe(`sending notices outside the app (${leg})`, () => {
  it('claims a notice and sends nothing for a kind the person did not ask to have sent, and claims each notice once', async () => {
    seen.length = 0;
    const first = await deliverNotices(database, [recorder], NOW + 1000);
    expect(first).toEqual({ claimed: 1, fannedOut: 0 });
    expect(seen).toEqual([]);
    // It was claimed: even if the person now asks for the kind, this notice is not looked at again.
    await saveSettings(database, world.accounts.member, { sentKinds: ['added_to_workspace'] }, NOW);
    expect(await deliverNotices(database, [recorder], NOW + 2000)).toEqual({
      claimed: 0,
      fannedOut: 0,
    });
    expect(seen).toEqual([]);
  });

  it('sends a notice of a kind that was asked for, once, with its line and where it goes, and two processes send it once between them', async () => {
    const other = await seedWorld(database);
    await seedBoardContents(database, other);
    await saveSettings(database, other.accounts.member, { sentKinds: ['added_to_workspace'] }, NOW);
    seen.length = 0;
    const runs = await Promise.all([
      deliverNotices(database, [recorder], NOW + 5000),
      deliverNotices(database, [recorder], NOW + 5000),
    ]);
    expect(runs[0].claimed + runs[1].claimed).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      accountId: other.accounts.member,
      kind: 'added_to_workspace',
      path: '/inbox',
    });
    expect(seen[0]?.title).toMatch(/^You were added to the workspace /);
    expect(seen[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    // And never again.
    expect(await deliverNotices(database, [recorder], NOW + 9000)).toMatchObject({ claimed: 0 });
  });

  it('looks only at a day’s notices, so that a job that was down for a week does not send a week’s', async () => {
    const old = await seedWorld(database);
    await seedBoardContents(database, old);
    await saveSettings(database, old.accounts.member, { sentKinds: ['added_to_workspace'] }, NOW);
    seen.length = 0;
    // The fixture's notices are from `NOW`; two days on, they are not looked at.
    expect(await deliverNotices(database, [recorder], NOW + 2 * 24 * 60 * 60 * 1000)).toMatchObject(
      {
        claimed: 0,
      },
    );
    expect(seen).toEqual([]);
  });
});

describe('the line a notice is outside the app', () => {
  it('says each kind, and shortens a long subject', () => {
    expect(noticeText('assigned', 'Pay the rent')).toBe('You were assigned “Pay the rent”');
    expect(noticeText('comment', 'Pay the rent')).toBe('New comment on “Pay the rent”');
    expect(noticeText('added_to_workspace', 'Acme')).toBe('You were added to the workspace “Acme”');
    expect(noticeText('added_to_board', 'Roadmap')).toBe('You were added to the board “Roadmap”');
    expect(noticeText('workspace_passed', 'Acme')).toBe('The workspace “Acme” was passed to you');
    expect(noticeText('backup_stopped', 'token_rejected')).toBe('Your automatic backups stopped');
    expect(noticeText('comment', 'x'.repeat(300)).length).toBeLessThan(140);
  });
});

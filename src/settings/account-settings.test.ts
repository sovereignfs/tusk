import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { account, makeStore } from '../sync/test-support';
import { parseSettingsChange, readSettings, saveSettings } from './account-settings';

/** What an account keeps for what leaves the app (DESIGN.md §19, §25.2), on every form of the database. */
const { leg } = testTarget();
let database: Database;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ database, close } = await makeStore());
});
afterAll(async () => close());

describe(`the settings for what leaves the app (${leg})`, () => {
  it('starts with everything off, the brief at eight, and nothing sent outside', async () => {
    expect(await readSettings(database, account())).toEqual({
      workspaceSort: 'name',
      timeZone: 'UTC',
      noticesOff: [],
      briefOn: false,
      briefAt: '08:00',
      remindersOn: false,
      emailOn: false,
      sentKinds: [],
    });
  });

  it('keeps each setting, one at a time and together, and leaves the others as they were', async () => {
    const who = account();
    await saveSettings(database, who, { briefOn: true }, 1);
    await saveSettings(database, who, { briefAt: '06:45', remindersOn: true }, 2);
    await saveSettings(database, who, { emailOn: true, sentKinds: ['assigned', 'comment'] }, 3);
    await saveSettings(database, who, { noticesOff: ['backup_stopped'] }, 4);
    expect(await readSettings(database, who)).toMatchObject({
      briefOn: true,
      briefAt: '06:45',
      remindersOn: true,
      emailOn: true,
      sentKinds: ['assigned', 'comment'],
      noticesOff: ['backup_stopped'],
    });
    // And back off.
    await saveSettings(database, who, { briefOn: false, emailOn: false, sentKinds: [] }, 5);
    expect(await readSettings(database, who)).toMatchObject({
      briefOn: false,
      briefAt: '06:45',
      emailOn: false,
      sentKinds: [],
    });
  });

  it('is the account’s own: another account is unchanged', async () => {
    const one = account();
    const two = account();
    await saveSettings(database, one, { briefOn: true, sentKinds: ['assigned'] }, 1);
    expect(await readSettings(database, two)).toMatchObject({ briefOn: false, sentKinds: [] });
  });
});

describe('a change to them', () => {
  it('takes the settings it names, a time as HH:MM, and kinds that exist, each once', () => {
    expect(
      parseSettingsChange({
        briefOn: true,
        briefAt: '07:30',
        remindersOn: false,
        sentKinds: ['assigned', 'assigned', 'comment'],
      }),
    ).toEqual({
      ok: true,
      value: {
        briefOn: true,
        briefAt: '07:30',
        remindersOn: false,
        sentKinds: ['assigned', 'comment'],
      },
    });
  });

  it('refuses what is not a setting, a flag that is not true or false, a time that is not one, and a kind that is not', () => {
    for (const bad of [
      { briefOn: 'yes' },
      { briefAt: '25:00' },
      { briefAt: '8:00' },
      { sentKinds: ['nothing'] },
      { sentKinds: 'assigned' },
      { pushOn: true },
    ])
      expect(parseSettingsChange(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it('refuses turning email on where the server has no mail, and takes it turned off', () => {
    expect(parseSettingsChange({ emailOn: true }, { email: false })).toMatchObject({ ok: false });
    expect(parseSettingsChange({ emailOn: false }, { email: false })).toMatchObject({ ok: true });
    expect(parseSettingsChange({ emailOn: true }, { email: true })).toMatchObject({ ok: true });
  });
});

import { createSovereign } from '@sovereignfs/sdk';
import { createFakeCore } from '@sovereignfs/sdk/testing';
import { describe, expect, it } from 'vitest';
import { MemoryMailer } from '../mail/memory';
import {
  CORE_REST_MS,
  type Channel,
  type Outgoing,
  coreChannel,
  emailChannel,
  fanOut,
} from './channels';

/**
 * The channels (DESIGN.md §25.2, task 8.3), against the test mailer and the SDK's fake core: each of the five results is reached, one channel failing leaves the
 * other working, and no title, address or `sub` is in anything that is logged.
 */
const SUB = 'sub-secret-1234';
const notice = (extra: Partial<Outgoing> = {}): Outgoing => ({
  accountId: 'acc-1',
  kind: 'assigned',
  title: 'You were assigned “Pay the rent”',
  path: '/inbox',
  key: 'n1',
  ...extra,
});
const absolute = (path: string) => `https://tusk.example.com${path}`;

function fixture(options: { api?: boolean } = {}) {
  const core = createFakeCore({
    api:
      options.api === false
        ? undefined
        : { versions: ['v1'], capabilities: ['directory', 'notifications', 'email', 'activity'] },
  });
  core.addPerson({ sub: SUB, name: 'Pat' });
  const sovereign = createSovereign({
    appUrl: 'https://tusk.example.com',
    coreUrl: core.url,
    clientId: core.credentials.clientId,
    clientSecret: core.credentials.clientSecret,
    fetch: core.fetch,
  });
  let clock = 1_800_000_000_000;
  const logged: string[] = [];
  const channel = coreChannel({
    sovereign: sovereign.app,
    subOf: async (account) => (account === 'acc-1' ? SUB : undefined),
    absolute,
    now: () => clock,
    log: (line) => logged.push(line),
  });
  return { core, channel, logged, advance: (ms: number) => (clock += ms) };
}

describe('the email channel', () => {
  const mailer = () => new MemoryMailer();
  const make = (m: MemoryMailer, over: { enabled?: boolean; address?: string | undefined } = {}) =>
    emailChannel({
      mailer: m,
      app: 'Tusk',
      addressOf: async () => ('address' in over ? over.address : 'pat@example.com'),
      enabled: async () => over.enabled ?? true,
      settingsUrl: 'https://tusk.example.com/account?section=notifications',
      absolute,
    });

  it('sends to the person’s address, with a link to the notice and one to Settings to turn it off', async () => {
    const m = mailer();
    expect(await make(m).send(notice({ body: 'On the Roadmap board.' }))).toEqual({
      outcome: 'sent',
    });
    expect(m.sent).toHaveLength(1);
    const message = m.sent[0];
    expect(message?.to).toBe('pat@example.com');
    expect(message?.subject).toBe('You were assigned “Pay the rent”');
    expect(message?.text).toContain('https://tusk.example.com/inbox');
    expect(message?.text).toContain('account?section=notifications');
  });

  it('has no channel for a person who turned email off, or has no address', async () => {
    const m = mailer();
    expect(await make(m, { enabled: false }).send(notice())).toEqual({ outcome: 'no_channel' });
    expect(await make(m, { address: undefined }).send(notice())).toEqual({ outcome: 'no_channel' });
    expect(m.sent).toEqual([]);
  });

  it('says failed, and does not throw, when the mail server does not take it', async () => {
    const m = mailer();
    m.failNext = 1;
    expect(await make(m).send(notice())).toEqual({ outcome: 'failed' });
  });
});

describe('the core channel', () => {
  it('sends to the person’s sub, with the key, a whole address, and text within core’s limits', async () => {
    const { core, channel } = fixture();
    const result = await channel.send(notice({ title: 'T'.repeat(300), body: 'B'.repeat(900) }));
    expect(result).toEqual({ outcome: 'sent' });
    const sent = core.notificationsSent[0];
    expect(sent?.to).toBe(SUB);
    expect(sent?.title.length).toBeLessThanOrEqual(120);
    expect(sent?.body?.length).toBeLessThanOrEqual(500);
    expect(sent?.url).toBe('https://tusk.example.com/inbox');
  });

  it('has no channel for a person with no account on the core', async () => {
    const { core, channel } = fixture();
    expect(await channel.send(notice({ accountId: 'someone-else' }))).toEqual({
      outcome: 'no_channel',
    });
    expect(core.notificationsSent).toEqual([]);
  });

  it('says retry_after, with the seconds, when core says 429', async () => {
    const { core, channel } = fixture();
    core.fail({ kind: 'status', status: 429, retryAfter: 7 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'retry_after', retryAfterSeconds: 7 });
  });

  it('says failed, and never sends twice, when core is down, times out, or the answer is lost', async () => {
    for (const kind of ['down', 'timeout', 'lost-answer'] as const) {
      const { core, channel } = fixture();
      core.fail({ kind }, { target: 'api' });
      expect(await channel.send(notice()), kind).toEqual({ outcome: 'failed' });
    }
  });

  it('says failed for a core that is failing, and works again when it is healed', async () => {
    const { core, channel } = fixture();
    core.fail({ kind: 'status', status: 503 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'failed' });
    core.heal();
    expect(await channel.send(notice())).toEqual({ outcome: 'sent' });
  });

  it('says not_permitted when core refuses this app, logs it once, and rests for hours', async () => {
    const { core, channel, logged, advance } = fixture();
    core.fail({ kind: 'status', status: 403 }, { target: 'api' });
    expect(await channel.send(notice())).toEqual({ outcome: 'not_permitted' });
    // Resting: it does not ask again, and does not log again.
    core.heal();
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(logged).toHaveLength(1);
    expect(core.notificationsSent).toEqual([]);
    // After the rest it tries once more.
    advance(CORE_REST_MS + 1);
    expect(await channel.send(notice())).toEqual({ outcome: 'sent' });
  });

  it('has no channel, and rests, on a core too old to serve notifications', async () => {
    const { channel, logged } = fixture({ api: false });
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(await channel.send(notice())).toEqual({ outcome: 'no_channel' });
    expect(logged).toHaveLength(1);
  });
});

describe('fanning out', () => {
  it('runs every channel, and one failing leaves the other working', async () => {
    const { core, channel } = fixture();
    const m = new MemoryMailer();
    m.failNext = 1;
    const email = emailChannel({
      mailer: m,
      app: 'Tusk',
      addressOf: async () => 'pat@example.com',
      enabled: async () => true,
      settingsUrl: 'https://tusk.example.com/account',
      absolute,
    });
    const results = await fanOut([email, channel], notice());
    expect(results).toEqual({ email: { outcome: 'failed' }, core: { outcome: 'sent' } });
    expect(core.notificationsSent).toHaveLength(1);
  });

  it('counts a channel that throws as failed, and still runs the rest', async () => {
    const broken: Channel = {
      name: 'push',
      send: async () => {
        throw new Error('boom');
      },
    };
    const { core, channel } = fixture();
    const results = await fanOut([broken, channel], notice());
    expect(results).toEqual({ push: { outcome: 'failed' }, core: { outcome: 'sent' } });
    expect(core.notificationsSent).toHaveLength(1);
  });

  it('logs the channel, the kind and the outcome, and no title, address or sub', async () => {
    const { channel } = fixture();
    const m = new MemoryMailer();
    const email = emailChannel({
      mailer: m,
      app: 'Tusk',
      addressOf: async () => 'pat@example.com',
      enabled: async () => true,
      settingsUrl: 'https://tusk.example.com/account',
      absolute,
    });
    const lines: string[] = [];
    await fanOut([email, channel], notice(), (line) => lines.push(line));
    const text = lines.join('\n');
    expect(text).toContain('email sent');
    expect(text).toContain('core sent');
    for (const secret of ['Pay the rent', 'pat@example.com', SUB, 'acc-1'])
      expect(text).not.toContain(secret);
  });
});

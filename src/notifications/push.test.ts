import { createECDH, randomBytes } from 'node:crypto';
import { Agent } from 'node:https';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ringOf } from '../crypto/keys';
import type { Database } from '../db/client';
import { testTarget } from '../db/test-support';
import { devicesOf, removeDevice, saveSubscription } from '../push/store';
import { account, makeStore } from '../sync/test-support';
import type { Outgoing } from './channels';
import { pushChannel } from './push';
import { LOCALHOST_CERT, LOCALHOST_KEY } from './testing/localhost';

/**
 * Web Push as a channel (DESIGN.md §25.2, task 8.4), against **a push service of our own**: an https server that records what it is sent and answers as a push service
 * does (201, and 404, 410, 429, 403 for a path it is told). The send is encrypted to a device whose keys the test made, and a device the service says is gone is removed.
 */
const { leg } = testTarget();
const ring = ringOf(Buffer.alloc(32, 5));
if (!ring) throw new Error('a ring');
const vapid = webpush.generateVAPIDKeys();
const subject = 'mailto:admin@example.com';

interface Received {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
const received: Received[] = [];
const answers = new Map<string, { status: number; headers?: Record<string, string> }>();
let origin = '';
let service: ReturnType<typeof createServer>;
let database: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ database, close } = await makeStore());
  service = createServer({ key: LOCALHOST_KEY, cert: LOCALHOST_CERT }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      received.push({ path, headers: request.headers, body: Buffer.concat(chunks) });
      const answer = answers.get(path) ?? { status: 201 };
      response.writeHead(answer.status, answer.headers ?? {});
      response.end();
    });
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${(service.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => service.close(resolve));
  await close();
});

/** A device's keys, as a browser makes them. */
function keys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

const notice = (accountId: string): Outgoing => ({
  accountId,
  kind: 'assigned',
  title: 'You were assigned “Pay the rent”',
  path: '/inbox',
  key: 'n1',
});

function channelFor() {
  return pushChannel({
    vapid: { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject },
    devicesOf: (accountId) => devicesOf(database, ring as NonNullable<typeof ring>, accountId),
    remove: (accountId, id) => removeDevice(database, accountId, id),
    agent: new Agent({ ca: LOCALHOST_CERT }),
    timeoutMs: 3000,
  });
}

async function subscribe(who: string, path: string) {
  await saveSubscription(
    database,
    ring as NonNullable<typeof ring>,
    who,
    { endpoint: `${origin}${path}`, ...keys() },
    1_800_000_000_000,
  );
}

describe(`Web Push, against a push service of our own (${leg})`, () => {
  it('sends a notice encrypted to a device, signed with the VAPID keys, and the service cannot read it', async () => {
    received.length = 0;
    const who = account();
    await subscribe(who, '/device-a');
    expect(await channelFor().send(notice(who))).toEqual({ outcome: 'sent' });
    expect(received).toHaveLength(1);
    const got = received[0];
    expect(got?.path).toBe('/device-a');
    expect(got?.headers['content-encoding']).toBe('aes128gcm');
    expect(String(got?.headers.authorization)).toMatch(/^vapid t=.+, k=/);
    expect(got?.headers.ttl).toBe('3600');
    // What went out is not the text: neither the title nor a word of it is in the bytes.
    const bytes = got?.body.toString('latin1') ?? '';
    expect(bytes.length).toBeGreaterThan(40);
    for (const clear of ['Pay the rent', 'assigned', '/inbox', 'title'])
      expect(bytes).not.toContain(clear);
  });

  it('removes a device the service says is gone (410), and has no channel when that was the only one', async () => {
    const who = account();
    answers.set('/gone', { status: 410 });
    await subscribe(who, '/gone');
    expect((await devicesOf(database, ring as NonNullable<typeof ring>, who)).length).toBe(1);
    expect(await channelFor().send(notice(who))).toEqual({ outcome: 'no_channel' });
    expect(await devicesOf(database, ring as NonNullable<typeof ring>, who)).toEqual([]);
  });

  it('removes a device on 404 too, and still sends to the person’s other device', async () => {
    received.length = 0;
    const who = account();
    answers.set('/missing', { status: 404 });
    await subscribe(who, '/missing');
    await subscribe(who, '/phone');
    expect(await channelFor().send(notice(who))).toEqual({ outcome: 'sent' });
    expect(
      (await devicesOf(database, ring as NonNullable<typeof ring>, who)).map((d) => d.endpoint),
    ).toEqual([`${origin}/phone`]);
    expect(received.map((r) => r.path).sort()).toEqual(['/missing', '/phone']);
  });

  it('says retry_after with the service’s seconds on 429, and not_permitted when the VAPID signature is refused', async () => {
    const slow = account();
    answers.set('/slow', { status: 429, headers: { 'retry-after': '42' } });
    await subscribe(slow, '/slow');
    expect(await channelFor().send(notice(slow))).toEqual({
      outcome: 'retry_after',
      retryAfterSeconds: 42,
    });
    const refused = account();
    answers.set('/refused', { status: 403 });
    await subscribe(refused, '/refused');
    expect(await channelFor().send(notice(refused))).toEqual({ outcome: 'not_permitted' });
    // Neither removes the device: it may be fine next time.
    expect((await devicesOf(database, ring as NonNullable<typeof ring>, slow)).length).toBe(1);
  });

  it('says failed for a service that is down or answers with a failure, and has no channel for a person with no device', async () => {
    const down = account();
    await saveSubscription(
      database,
      ring as NonNullable<typeof ring>,
      down,
      { endpoint: 'https://127.0.0.1:1/never', ...keys() },
      1,
    );
    expect(await channelFor().send(notice(down))).toEqual({ outcome: 'failed' });
    const broken = account();
    answers.set('/broken', { status: 500 });
    await subscribe(broken, '/broken');
    expect(await channelFor().send(notice(broken))).toEqual({ outcome: 'failed' });
    expect(await channelFor().send(notice(account()))).toEqual({ outcome: 'no_channel' });
  });
});

import type { Agent } from 'node:https';
import webpush, { type PushSubscription, WebPushError } from 'web-push';
import type { PushSettings } from '../config';
import type { Channel, Outcome, Result } from './channels';

/**
 * **Web Push** as a channel (DESIGN.md §25.2, task 8.4): a notice goes to every device the person turned Push on from. What is sent is encrypted to each device (the
 * `web-push` library does RFC 8291 and signs with the operator's VAPID keys), so the push service carries a message it cannot read. The payload is the title, the body
 * and where choosing it goes; **the service worker shows it** and opens that address.
 *
 * A device the service says is gone (404, 410) is removed. Over all of a person's devices the result is `sent` if any took it, otherwise the most telling thing that
 * happened: a 429 asks to wait (`retry_after`), a VAPID refusal is `not_permitted`, anything else `failed`, and no device at all is `no_channel`. Nothing of the person
 * or the endpoint is in a log.
 */
export interface PushDeps {
  readonly vapid: PushSettings;
  /** The account's devices, with their keys opened. */
  devicesOf(
    accountId: string,
  ): Promise<{ id: string; endpoint: string; p256dh: string; auth: string }[]>;
  /** Removes a device the push service says is gone. */
  remove(accountId: string, id: string): Promise<void>;
  /** How long a service may keep it for a device that is off, in seconds. A notice that is late is not worth much: an hour. */
  ttlSeconds?: number;
  /** How long to wait for the push service. */
  timeoutMs?: number;
  /** The https agent to send with: a test's, which trusts the certificate of its stand-in push service. */
  agent?: Agent;
}

const rank: Record<Outcome, number> = {
  sent: 0,
  retry_after: 1,
  not_permitted: 2,
  failed: 3,
  no_channel: 4,
};

export function pushChannel(deps: PushDeps): Channel {
  return {
    name: 'push',
    async send(notice): Promise<Result> {
      const devices = await deps.devicesOf(notice.accountId);
      if (devices.length === 0) return { outcome: 'no_channel' };
      const payload = JSON.stringify({
        title: notice.title,
        ...(notice.body ? { body: notice.body } : {}),
        path: notice.path,
        key: notice.key,
      });
      const results = await Promise.all(
        devices.map(async (device): Promise<Result> => {
          const subscription: PushSubscription = {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          };
          try {
            await webpush.sendNotification(subscription, payload, {
              vapidDetails: {
                subject: deps.vapid.subject,
                publicKey: deps.vapid.publicKey,
                privateKey: deps.vapid.privateKey,
              },
              TTL: deps.ttlSeconds ?? 3600,
              urgency: 'normal',
              timeout: deps.timeoutMs ?? 10_000,
              ...(deps.agent ? { agent: deps.agent } : {}),
            });
            return { outcome: 'sent' };
          } catch (error) {
            if (error instanceof WebPushError) {
              if (error.statusCode === 404 || error.statusCode === 410) {
                await deps.remove(notice.accountId, device.id).catch(() => undefined);
                return { outcome: 'no_channel' };
              }
              if (error.statusCode === 429) {
                const header = (error.headers as Record<string, string | undefined> | undefined)?.[
                  'retry-after'
                ];
                const seconds = Number(header);
                return {
                  outcome: 'retry_after',
                  ...(Number.isFinite(seconds) ? { retryAfterSeconds: seconds } : {}),
                };
              }
              // The service refused the VAPID signature or the sender: this app may not send to it.
              if (error.statusCode === 401 || error.statusCode === 403)
                return { outcome: 'not_permitted' };
            }
            return { outcome: 'failed' };
          }
        }),
      );
      // Any device took it: sent. Otherwise the most telling of what happened.
      return (
        [...results].sort((a, b) => rank[a.outcome] - rank[b.outcome])[0] ?? {
          outcome: 'no_channel',
        }
      );
    },
  };
}

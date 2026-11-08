import { createSovereign } from '@sovereignfs/sdk';
import { authDirectory } from '../auth/directory';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { smtpMailer } from '../mail/smtp';
import { subOfAccount } from '../sovereign/identity';
import { readSettings } from '../settings/account-settings';
import { devicesOf, removeDevice } from '../push/store';
import { type Channel, coreChannel, emailChannel } from './channels';
import { pushChannel } from './push';

/**
 * The channels this server has (DESIGN.md §25.2): email where there is mail, and core's bell where the people sign in through a core. **A channel is here only
 * where it can work**, as Settings offers only those, and with neither this is empty and the job that sends does not claim anything (so that turning one on later
 * does not send what was waiting). Both need the address people use, since a notification links to the app.
 */
export function serverChannels(
  config: Config,
  databases: { app: Database; auth: Database },
  log: (line: string) => void,
): Channel[] {
  const url = config.url;
  if (!url) return [];
  const absolute = (path: string) => `${url}${path}`;
  const channels: Channel[] = [];
  if (config.mail) {
    const mailer = smtpMailer(config.mail);
    const directory = authDirectory(databases.auth);
    channels.push(
      emailChannel({
        mailer,
        app: 'Tusk',
        addressOf: async (accountId) =>
          (await directory.profiles([accountId])).get(accountId)?.email ?? undefined,
        enabled: async (accountId) => (await readSettings(databases.app, accountId)).emailOn,
        settingsUrl: absolute('/account?section=notifications'),
        absolute,
      }),
    );
  }
  // Web Push, where the operator gave VAPID keys and the instance key that seals each device's keys.
  const ring = config.encryption;
  if (config.push && ring) {
    channels.push(
      pushChannel({
        vapid: config.push,
        devicesOf: (accountId) => devicesOf(databases.app, ring, accountId),
        remove: (accountId, id) => removeDevice(databases.app, accountId, id),
      }),
    );
  }
  const core = config.auth?.sovereign;
  if (core) {
    // Core's address, from its issuer (an address under it): the SDK's client is the app as itself and needs neither a token store nor a session store.
    const sovereign = createSovereign({
      appUrl: url,
      coreUrl: new URL(core.issuer).origin,
      clientId: core.clientId,
      clientSecret: core.clientSecret,
    });
    channels.push(
      coreChannel({
        sovereign: sovereign.app,
        subOf: async (accountId) => (await subOfAccount(databases.auth, accountId)) ?? undefined,
        absolute,
        now: Date.now,
        log,
      }),
    );
  }
  return channels;
}

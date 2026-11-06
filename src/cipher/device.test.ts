import { describe, expect, it } from 'vitest';
import { createIdentity } from './identity';
import { newDeviceKey, openIdentity, sealIdentity } from './device';

/** What a device keeps where the platform cannot store an identity as a key (DESIGN.md §9.2): the identity sealed under a device key that cannot be read back. */
describe('the device’s sealed identity', () => {
  it('opens to the identity under the key it was sealed with, and only that', async () => {
    const person = await createIdentity();
    const device = await newDeviceKey();
    expect(device.extractable).toBe(false);
    const sealed = await sealIdentity(person.identity, device);
    expect(sealed).not.toContain(person.identity);
    expect(await openIdentity(sealed, device)).toBe(person.identity);
    await expect(openIdentity(sealed, await newDeviceKey())).rejects.toMatchObject({
      kind: 'cannot_open',
    });
    await expect(openIdentity('short', device)).rejects.toMatchObject({ kind: 'malformed' });
    expect(await sealIdentity(person.identity, device)).not.toBe(sealed);
  });
});

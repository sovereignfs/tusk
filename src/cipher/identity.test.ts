import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as age from 'age-encryption';
import { describe, expect, it } from 'vitest';
import { createIdentity, identityCryptoKey, keyFile, parseIdentity } from './identity';
import { hasAge, run } from './testing';

/**
 * A key of a person's own (DESIGN.md §9.1): made here and read by the real `age`; made by `age-keygen` (or Fjord, which is the same format) and read here;
 * kept as a browser key that cannot be read back. The fixture is a throwaway key made by `age-keygen` for these tests and used for nothing else.
 */
const FIXTURE = {
  file: `# created: 2026-11-06T23:07:15+01:00
# public key: age1grf7keeshefzun8zk20fahe5z2yljme020mqfgu2782puncdcs4stxwmlr
AGE-SECRET-KEY-12V57LEMWYJJ90MPPM2SR3FNVRPX4MJ5ZU404FQ5LJSPNGSSN5G7Q4C83JF
`,
  identity: 'AGE-SECRET-KEY-12V57LEMWYJJ90MPPM2SR3FNVRPX4MJ5ZU404FQ5LJSPNGSSN5G7Q4C83JF',
  recipient: 'age1grf7keeshefzun8zk20fahe5z2yljme020mqfgu2782puncdcs4stxwmlr',
  // "a list key by real age", encrypted to the recipient by the real `age`.
  fromAge:
    'YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSA0Q0VGVmI0ODVKeGt2Um1YOFRtOUk4Y2RZb01CdGNLdTBHTFoxZEE4MGg4CmRJNGFiVFlCVG1aZSs0SDRyNDMvRHljRVc1MUF2YldhYVM5QkwzR1hsdnMKLS0tIHhDZVZXSmFBajErejgxVlJjaUNySDhocjVaVis4NEpJNUh5aXkzS2ZVNU0KkXi/XkUjmNPMsN3azmlAEl3sgzvlz4i9ZruvHC4P5k8XTLKo+p6+mMasSn8BLns+Up3SJe25',
};

describe('an identity made here', () => {
  it('is an age X25519 identity with the recipient that goes with it', async () => {
    const made = await createIdentity();
    expect(made.identity).toMatch(/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/);
    expect(made.recipient).toMatch(/^age1[0-9a-z]{58}$/);
    expect((await createIdentity()).identity).not.toBe(made.identity);
    expect(await age.identityToRecipient(made.identity)).toBe(made.recipient);
  });

  it('is read back from the key file it is saved as, and the public part comes from the secret and not from the file', async () => {
    const made = await createIdentity();
    const file = keyFile(made, new Date('2026-11-06T14:30:00.123Z'));
    expect(file).toBe(
      `# created: 2026-11-06T14:30:00Z\n# public key: ${made.recipient}\n${made.identity}\n`,
    );
    expect(await parseIdentity(file)).toEqual({ ok: true, ...made });
    // A file whose comment names someone else's public key is not believed.
    const lying = file.replace(made.recipient, FIXTURE.recipient);
    expect(await parseIdentity(lying)).toEqual({ ok: true, ...made });
  });

  it.skipIf(!hasAge)(
    'is read by the real age: what age encrypts to its recipient opens with it, and the file it saves is one age takes',
    async () => {
      const made = await createIdentity();
      const dir = mkdtempSync(join(tmpdir(), 'tusk-age-'));
      const file = join(dir, 'key.txt');
      writeFileSync(file, keyFile(made, new Date()));
      // age-keygen -y reads the saved file and gives the recipient we made.
      expect(run('age-keygen', ['-y', file]).toString().trim()).toBe(made.recipient);
      // Encrypted by the real age to our recipient, opened here.
      const sealed = run('age', ['-r', made.recipient], 'hello from age');
      const decrypter = new age.Decrypter();
      decrypter.addIdentity(made.identity);
      expect(await decrypter.decrypt(Uint8Array.from(sealed), 'text')).toBe('hello from age');
      // Encrypted here, opened by the real age with the file.
      const encrypter = new age.Encrypter();
      encrypter.addRecipient(made.recipient);
      const ours = Buffer.from(await encrypter.encrypt('hello from tusk'));
      expect(run('age', ['-d', '-i', file], ours).toString()).toBe('hello from tusk');
    },
  );
});

describe('an identity from elsewhere', () => {
  it('is taken from the file age-keygen writes, which is what a Fjord identity is too, or from the key alone, with whitespace around it', async () => {
    const expected = { ok: true, identity: FIXTURE.identity, recipient: FIXTURE.recipient };
    expect(await parseIdentity(FIXTURE.file)).toEqual(expected);
    expect(await parseIdentity(FIXTURE.identity)).toEqual(expected);
    expect(await parseIdentity(`\n  ${FIXTURE.identity}\r\n\r\n`)).toEqual(expected);
    expect(await parseIdentity(FIXTURE.file.replaceAll('\n', '\r\n'))).toEqual(expected);
  });

  it('opens a file the real age made, which a fixture kept in the repository shows without the binary', async () => {
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(FIXTURE.identity);
    const bytes = Uint8Array.from(Buffer.from(FIXTURE.fromAge, 'base64'));
    expect(await decrypter.decrypt(bytes, 'text')).toBe('a list key by real age');
  });

  it.skipIf(!hasAge)('is what age-keygen makes, new each time', async () => {
    const out = run('age-keygen', []).toString();
    const parsed = await parseIdentity(out);
    expect(parsed.ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'tusk-age-'));
    writeFileSync(join(dir, 'k.txt'), out);
    if (parsed.ok)
      expect(
        run('age-keygen', ['-y', join(dir, 'k.txt')])
          .toString()
          .trim(),
      ).toBe(parsed.recipient);
  });

  it('refuses what is not one, for its own reason each', async () => {
    expect(await parseIdentity('')).toEqual({ ok: false, reason: 'empty' });
    expect(await parseIdentity('# created: x\n# public key: age1x\n\n')).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(await parseIdentity(`${FIXTURE.identity}\n${FIXTURE.identity}`)).toEqual({
      ok: false,
      reason: 'several',
    });
    expect(await parseIdentity('AGE-SECRET-KEY-PQ-1QQQQ')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    for (const bad of [
      'hello',
      FIXTURE.recipient,
      // One character changed: the checksum fails.
      FIXTURE.identity.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
      FIXTURE.identity.slice(0, -2),
      FIXTURE.identity.toLowerCase(),
      `AGE-SECRET-KEY-1${'Q'.repeat(58)}`,
      'AGE-SECRET-KEY-1',
    ])
      expect(await parseIdentity(bad), bad).toMatchObject({ ok: false, reason: 'not_a_key' });
  });
});

describe('a browser key from an identity', () => {
  it('cannot be read back, and opens what is wrapped to the recipient', async () => {
    const key = await identityCryptoKey(FIXTURE.identity);
    expect(key.extractable).toBe(false);
    expect(key.type).toBe('private');
    expect(key.usages).toEqual(['deriveBits']);
    await expect(crypto.subtle.exportKey('pkcs8', key)).rejects.toThrow();
    // It is the same key as the text: it makes the same recipient, and opens what the real age made.
    expect(await age.identityToRecipient(key)).toBe(FIXTURE.recipient);
    const decrypter = new age.Decrypter();
    decrypter.addIdentity(key);
    const bytes = Uint8Array.from(Buffer.from(FIXTURE.fromAge, 'base64'));
    expect(await decrypter.decrypt(bytes, 'text')).toBe('a list key by real age');
  });

  it('is refused for text that is not an identity', async () => {
    await expect(identityCryptoKey('hello')).rejects.toMatchObject({ kind: 'malformed' });
    await expect(identityCryptoKey(FIXTURE.recipient)).rejects.toMatchObject({ kind: 'malformed' });
  });
});

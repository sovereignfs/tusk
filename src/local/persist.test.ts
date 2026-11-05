import { describe, expect, it } from 'vitest';
import { requestPersistence } from './persist';

describe('asking the browser to keep the working copy', () => {
  it('asks once if it is not kept already, and says what the browser answered', async () => {
    let asked = 0;
    const storage = { persisted: async () => false, persist: async () => (asked++, true) };
    expect(await requestPersistence(storage)).toBe(true);
    expect(asked).toBe(1);
  });

  it('does not ask again for what is kept already', async () => {
    let asked = 0;
    const storage = { persisted: async () => true, persist: async () => (asked++, true) };
    expect(await requestPersistence(storage)).toBe(true);
    expect(asked).toBe(0);
  });

  it('is false, and quiet, when the browser refuses, throws or has no such thing', async () => {
    expect(
      await requestPersistence({ persisted: async () => false, persist: async () => false }),
    ).toBe(false);
    expect(
      await requestPersistence({
        persisted: async () => false,
        persist: async () => {
          throw new Error('denied');
        },
      }),
    ).toBe(false);
    expect(await requestPersistence(undefined)).toBe(false);
    expect(await requestPersistence({} as StorageManager)).toBe(false);
  });
});

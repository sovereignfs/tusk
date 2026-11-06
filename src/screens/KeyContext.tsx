'use client';

import * as age from 'age-encryption';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { parseIdentity } from '../cipher/identity';
import { forgetKey, keepIdentity, loadIdentity } from '../cipher/vault';
import { DeskCipher } from '../local/seal';
import { useSync } from '../sync/react';

/**
 * Whether the Desk has a key of the person's own, and whether this device has it (DESIGN.md §9.1, §9.2). **`plain`**: no key, nothing is asked. **`offer`**:
 * no key, and the person has not yet been asked. **`locked`**: a key was set up, and this device does not have it, so **the Desk shows nothing** and asks;
 * boards and the Inbox are not the Desk's and show as they do. **`unlocked`**: this device has it, in the form the platform stores (`src/cipher/vault.ts`).
 *
 * The server's word is read when online and kept on the device, so that an offline start knows the same; the key itself is only ever in the vault. A key whose
 * public part is not the one the server has is not believed: it is the same as having none.
 */
export type KeyStatus = 'loading' | 'plain' | 'offer' | 'locked' | 'unlocked';

export type UnlockResult =
  'ok' | 'empty' | 'not_a_key' | 'unsupported' | 'several' | 'wrong_key' | 'failed';

export interface KeyApi {
  readonly status: KeyStatus;
  /** The public key the Desk is sealed to, if there is one. */
  readonly recipient: string | null;
  /** Whether the Desk is sealed to a key (set up, or being moved to one), whether or not this device has it yet: what hides the Desk meanwhile. */
  readonly sealed: boolean;
  /** Whether this server offers personal keys at all (not in the operator's mode). */
  readonly available: boolean;
  /** The key, as the thing that opens list keys, while unlocked. */
  readonly identity: string | CryptoKey | undefined;
  /** Sets up a key made or brought here: the public part to the server, the secret to this device. */
  setUp(identity: string): Promise<'ok' | 'conflict' | 'failed'>;
  /** Gives this device the key: checked to be the one the Desk was set up with. */
  unlock(text: string): Promise<UnlockResult>;
  /** Keeps the Desk plain, for now. */
  skip(): Promise<boolean>;
  /** Forgets the key on this device; the Desk asks for it again. */
  lock(): Promise<void>;
}

interface Server {
  mode: 'none' | 'moving' | 'personal';
  recipient: string | null;
  available: boolean;
  offer: boolean;
}

const cacheKey = (accountId: string) => `tusk.key.${accountId}`;

function readCache(accountId: string): Server | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(accountId));
    return raw ? (JSON.parse(raw) as Server) : undefined;
  } catch {
    return undefined;
  }
}
function writeCache(accountId: string, server: Server) {
  try {
    localStorage.setItem(cacheKey(accountId), JSON.stringify(server));
  } catch {
    // A device that will not keep it asks the server each time.
  }
}

const Context = createContext<KeyApi | null>(null);

/** A key situation of nothing: for a place that has no provider, which asks for nothing. */
const NONE: KeyApi = {
  status: 'plain',
  sealed: false,
  recipient: null,
  available: false,
  identity: undefined,
  setUp: async () => 'failed',
  unlock: async () => 'failed',
  skip: async () => false,
  lock: async () => undefined,
};

export function useKey(): KeyApi {
  return useContext(Context) ?? NONE;
}

export function KeyProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const client = useSync();
  const [server, setServer] = useState<Server | undefined>(() => undefined);
  const [identity, setIdentity] = useState<string | CryptoKey | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  /** Takes the device's key, if it has one and it is the one the Desk was set up with. */
  const settle = useCallback(
    async (known: Server) => {
      setServer(known);
      if (known.mode === 'none' || known.recipient === null) {
        client.setCipher(undefined);
        setIdentity(undefined);
        return setLoaded(true);
      }
      const kept = await loadIdentity(accountId);
      let valid: string | CryptoKey | undefined;
      try {
        if (kept && (await age.identityToRecipient(kept)) === known.recipient) valid = kept;
      } catch {
        valid = undefined;
      }
      // The working copy seals and opens with the key from here on, or with none (DESIGN.md §9.2).
      client.setCipher(valid ? new DeskCipher(valid, known.recipient) : undefined);
      setIdentity(valid);
      setLoaded(true);
    },
    [accountId, client],
  );

  const refresh = useCallback(async (): Promise<void> => {
    // What this device last knew is enough to hide a sealed Desk before the server has answered.
    const known = readCache(accountId);
    if (known) setServer((have) => have ?? known);
    try {
      const reply = await fetch('/api/encryption', { cache: 'no-store' });
      if (!reply.ok) throw new Error('not ok');
      const answered = (await reply.json()) as Server;
      writeCache(accountId, answered);
      await settle(answered);
    } catch {
      // Offline, or the server is unwell: what this device last knew. With nothing known it does not guess that the Desk is plain: it stays undecided and
      // asks again, so that a failed request is never taken for an answer.
      const cached = readCache(accountId);
      if (cached) await settle(cached);
      else setTimeout(() => void refresh(), 3000);
    }
  }, [accountId, settle]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const api = useMemo<KeyApi>(() => {
    const status: KeyStatus = !loaded
      ? 'loading'
      : !server || server.mode === 'none'
        ? server?.offer
          ? 'offer'
          : 'plain'
        : identity !== undefined
          ? 'unlocked'
          : 'locked';
    return {
      status,
      sealed: server !== undefined && server.mode !== 'none',
      recipient: server?.recipient ?? null,
      available: server?.available ?? false,
      identity,
      async setUp(secret) {
        try {
          const recipient = await age.identityToRecipient(secret);
          const reply = await fetch('/api/encryption/setup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipient }),
          });
          if (reply.status === 409) return 'conflict';
          if (!reply.ok) return 'failed';
          // The secret is kept on this device before anything shows that the Desk is sealed to it.
          await keepIdentity(accountId, secret);
          await refresh();
          return 'ok';
        } catch {
          return 'failed';
        }
      },
      async unlock(text) {
        const parsed = await parseIdentity(text);
        if (!parsed.ok) return parsed.reason;
        // Told apart before it is kept: a key that is a key but not this Desk's.
        if (!server?.recipient || parsed.recipient !== server.recipient) return 'wrong_key';
        try {
          await keepIdentity(accountId, parsed.identity);
          await refresh();
          return 'ok';
        } catch {
          return 'failed';
        }
      },
      async skip() {
        try {
          const reply = await fetch('/api/encryption/skip', { method: 'POST' });
          if (!reply.ok) return false;
          await refresh();
          return true;
        } catch {
          return false;
        }
      },
      async lock() {
        await forgetKey(accountId);
        client.setCipher(undefined);
        setIdentity(undefined);
      },
    };
  }, [accountId, client, identity, loaded, refresh, server]);

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

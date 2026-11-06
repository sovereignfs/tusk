'use client';

import { Button } from '../ui';
import { useKey } from '../screens/KeyContext';
import styles from './Account.module.css';

/**
 * Settings, Data, Encryption (DESIGN.md §9.1, §19): whether the Desk has a key of its own, and whether this device has it. It says plainly what a key does and
 * does not cover (the Desk, not the boards, which the server reads), and in the operator's mode (§9.5) that the operator manages encryption and a key of
 * one's own is not available. The offer itself is the one the Desk makes, and this points to it. Turning a key on for a Desk that has data is task 14.4's.
 */
export function EncryptionSection() {
  const key = useKey();
  return (
    <div className={styles.group}>
      <h2>Encryption</h2>
      <p>Your Desk can be yours alone. Boards are shared, and the server can read them.</p>
      {key.status === 'loading' ? <p className={styles.hint}>…</p> : null}
      {key.status === 'plain' && !key.available ? (
        <p className={styles.muted}>
          This server manages encryption itself, and can read your data. A key of your own is not
          offered here.
        </p>
      ) : null}
      {key.status === 'plain' && key.available ? (
        <p className={styles.muted}>
          Your Desk is stored as plain text on the server, as you chose. A key of your own can be
          turned on later.
        </p>
      ) : null}
      {key.status === 'offer' ? (
        <p className={styles.muted}>
          You have not chosen yet. Your <a href="/desk">Desk</a> will ask you.
        </p>
      ) : null}
      {key.status === 'locked' ? (
        <p role="status">
          Your Desk is sealed with a key of your own, and this device does not have it. Open your{' '}
          <a href="/desk">Desk</a> to give it the key.
        </p>
      ) : null}
      {key.status === 'unlocked' ? (
        <>
          <p role="status">Your Desk is sealed with a key of your own, and this device has it.</p>
          <p className={styles.hint}>
            It stays on this device until you sign out. Nobody can recover it for you: keep the file
            you saved.
          </p>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => void key.lock()}>
              Forget the key on this device
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

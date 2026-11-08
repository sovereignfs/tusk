'use client';

import { useState } from 'react';
import { Alert, Button, Textarea } from '@sovereignfs/ui';
import { useKey } from './KeyContext';
import { KEY_PROBLEMS } from './KeyOffer';
import styles from './KeyOffer.module.css';

/**
 * Shown in place of the Desk on a device that does not have the key (DESIGN.md §9.1): **no data is displayed,** only what is needed to give it. The key is
 * asked for once and kept until sign-out. A key that is a key but not this Desk's is told apart from one that is not a key at all. Boards and the Inbox are
 * not the Desk's, and are reached as always.
 */
export function UnlockKey() {
  const key = useKey();
  const [paste, setPaste] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function unlock(text: string) {
    setWorking(true);
    setProblem(null);
    const result = await key.unlock(text);
    if (result !== 'ok') setProblem(KEY_PROBLEMS[result] ?? KEY_PROBLEMS.failed ?? '');
    setWorking(false);
  }

  return (
    <section className={styles.offer} aria-label="Unlock your Desk">
      <h2>Your Desk is locked</h2>
      <p>
        Your Desk is sealed with a key of your own, and this device does not have it yet. Give it
        the key you saved when you set it up: choose the file, or paste the key. It is kept on this
        device until you sign out. Your boards and Inbox do not need it.
      </p>
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      <input
        type="file"
        aria-label="Key file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void file.text().then((text) => void unlock(text));
        }}
      />
      <Textarea
        aria-label="Or paste the key"
        rows={3}
        value={paste}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setPaste(event.target.value)}
      />
      <div className={styles.row}>
        <Button disabled={working || paste.trim() === ''} onClick={() => void unlock(paste)}>
          Unlock
        </Button>
      </div>
    </section>
  );
}

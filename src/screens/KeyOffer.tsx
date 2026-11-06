'use client';

import { useState } from 'react';
import { createIdentity, keyFile, parseIdentity, type Identity } from '../cipher/identity';
import { Alert, Button, Checkbox, Textarea } from '../ui';
import { useKey } from './KeyContext';
import styles from './KeyOffer.module.css';

/** What a refused key is told, in words that say what to do. */
export const KEY_PROBLEMS: Record<string, string> = {
  empty: 'Choose a key file, or paste the key.',
  not_a_key: 'That does not look like an age key. It begins AGE-SECRET-KEY-1 and has no typos.',
  unsupported: 'That is a post-quantum key, which this does not take yet. Use an ordinary age key.',
  several: 'That has more than one key in it. Use a file or a paste with just the one.',
  wrong_key:
    'That is a key, but it is not the one this Desk was set up with. Try the key you saved when you set it up.',
  failed: 'That could not be done. Try again.',
};

/** Saves the key file, named for what it is. */
function download(text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tusk-key.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * After first signing in (DESIGN.md §9.1): a Desk can be the person's alone, and they are offered it once, on the Desk and not in the way of it. **Create**
 * makes a key here, shows it, makes them save it (download it, and say they did) before it is used, and says that nobody can recover it. **Upload** takes a
 * key they already have, from a file or a paste, the same key they may use elsewhere. **Skip** keeps the Desk plain; Settings can turn a key on later.
 * Boards are shared and the server reads them, and the offer says so.
 */
export function KeyOffer() {
  const key = useKey();
  const [step, setStep] = useState<'ask' | 'create' | 'upload'>('ask');
  const [made, setMade] = useState<Identity | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [paste, setPaste] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  if (key.status !== 'offer') return null;

  async function begin() {
    setMade(await createIdentity());
    setSaved(false);
    setConfirmed(false);
    setProblem(null);
    setStep('create');
  }

  async function finish(secret: string) {
    setWorking(true);
    setProblem(null);
    const result = await key.setUp(secret);
    if (result === 'conflict')
      setProblem('This Desk already has a key, set up from another device. Use that key.');
    else if (result === 'failed') setProblem('That needs a connection. Nothing was changed.');
    setWorking(false);
  }

  async function upload() {
    const parsed = await parseIdentity(paste);
    if (!parsed.ok) return setProblem(KEY_PROBLEMS[parsed.reason] ?? KEY_PROBLEMS.failed ?? '');
    await finish(parsed.identity);
  }

  return (
    <section className={styles.offer} aria-label="A key for your Desk">
      <h2>Keep your Desk to yourself?</h2>
      <p>
        Your Desk can be yours alone: sealed with a key that only your devices have, so that the
        server, and whoever runs it, cannot read your lists and cards. Boards are shared, and the
        server can read them.
      </p>
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      {step === 'ask' ? (
        <div className={styles.row}>
          <Button onClick={() => void begin()}>Create a key</Button>
          <Button variant="secondary" onClick={() => setStep('upload')}>
            Use a key I have
          </Button>
          <Button variant="secondary" onClick={() => void key.skip()}>
            Skip
          </Button>
        </div>
      ) : null}
      {step === 'create' && made ? (
        <div className={styles.stack}>
          <p>
            <strong>Nobody can recover this key.</strong> If you lose it and every device that has
            it, your Desk is lost. Save it somewhere safe, such as a password manager.
          </p>
          <code className={styles.key} aria-label="Your key">
            {made.identity}
          </code>
          <div className={styles.row}>
            <Button
              variant="secondary"
              onClick={() => {
                download(keyFile(made, new Date()));
                setSaved(true);
              }}
            >
              Download the key file
            </Button>
          </div>
          <Checkbox
            id="key-saved"
            label="I have saved my key somewhere safe"
            checked={confirmed}
            disabled={!saved}
            onChange={setConfirmed}
          />
          <div className={styles.row}>
            <Button disabled={!confirmed || working} onClick={() => void finish(made.identity)}>
              {working ? 'Turning it on…' : 'Turn it on'}
            </Button>
            <Button variant="secondary" onClick={() => setStep('ask')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
      {step === 'upload' ? (
        <div className={styles.stack}>
          <p>
            Use an age key you already have (the same format Fjord uses): choose its file, or paste
            it.
          </p>
          <input
            type="file"
            aria-label="Key file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void file.text().then(setPaste);
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
            <Button disabled={working || paste.trim() === ''} onClick={() => void upload()}>
              Turn it on
            </Button>
            <Button variant="secondary" onClick={() => setStep('ask')}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

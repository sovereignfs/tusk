'use client';

import { useCallback, useEffect, useState } from 'react';
import { useKey } from '../screens/KeyContext';
import { Alert, Button, FormField, Input, SegmentedControl, Select } from '../ui';
import styles from './Account.module.css';

interface Connection {
  repository: string;
  url: string;
  branch: string;
  lastBackup: { at: number; path: string; url: string } | null;
  keyConfirmedAt: number | null;
  failure: { code: string; message: string; failures: number; stoppedAt: number | null } | null;
  mode: 'manual' | 'auto';
  frequency: Frequency;
  nextBackupAt: number | null;
  lastCheckedAt: number | null;
}

type Frequency = 'hourly' | '6h' | 'daily' | 'weekly';
const FREQUENCY_LABELS: Record<Frequency, string> = {
  hourly: 'Every hour',
  '6h': 'Every 6 hours',
  daily: 'Every day',
  weekly: 'Every week',
};

interface Status {
  canConnect: boolean;
  connection: Connection | null;
}

/**
 * Settings, Data, Backup to git (DESIGN.md §21). **It says plainly what will be sent and where,** before it asks for anything: the file is plain text on
 * GitHub's servers (unless the Desk has a personal key), so only a private repository is accepted. The token is typed into a field that is cleared the moment
 * it has been sent, is in one request, and is never shown again; every refusal is a sentence of the server's saying what to do. Without an instance key it says
 * why connecting is not offered. Disconnecting deletes the connection and the saved token and does not touch the repository.
 */
export function BackupSection() {
  const key = useKey();
  const [status, setStatus] = useState<Status | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const reply = await fetch('/api/backup/connection', { cache: 'no-store' });
      if (!reply.ok) return setUnreachable(true);
      setStatus((await reply.json()) as Status);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  async function connect() {
    setWorking(true);
    setProblem(null);
    setWarning(null);
    try {
      const reply = await fetch('/api/backup/connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repository, token }),
      });
      const body = (await reply.json().catch(() => ({}))) as {
        message?: string;
        warning?: { message: string };
      };
      if (reply.ok) {
        // The token is not kept in the page once it has been sent.
        setToken('');
        setRepository('');
        setWarning(body.warning?.message ?? null);
        await read();
      } else if (reply.status === 429) {
        setProblem('That was tried too many times. Wait a minute and try again.');
      } else {
        setProblem(body.message ?? 'That could not be connected.');
      }
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  async function backUpNow() {
    setWorking(true);
    setProblem(null);
    setWarning(null);
    try {
      const reply = await fetch('/api/backup/run', { method: 'POST' });
      if (reply.ok) await read();
      else if (reply.status === 429)
        setProblem('A backup was made a moment ago. Wait a minute and try again.');
      else {
        const body = (await reply.json().catch(() => ({}))) as { message?: string };
        setProblem(body.message ?? 'That could not be backed up.');
      }
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  async function schedule(patch: { mode?: 'manual' | 'auto'; frequency?: Frequency }) {
    setWorking(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/backup/connection', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!reply.ok) setProblem('That could not be changed.');
      await read();
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  async function confirmKey() {
    setWorking(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/backup/confirm-key', { method: 'POST' });
      if (!reply.ok) setProblem('That could not be confirmed.');
      await read();
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    setWorking(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/backup/connection', { method: 'DELETE' });
      if (!reply.ok && reply.status !== 404) setProblem('That could not be disconnected.');
      setWarning(null);
      await read();
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Backup to git</h2>
      <p>
        Tusk can save a copy of your Desk and the workspaces you own to a repository of yours, as a
        new file each time, under <code>tusk/</code>. The file is plain text: unless your Desk has a
        key of its own, anyone who can read the repository can read it, and GitHub&rsquo;s servers
        hold it. So only a <strong>private</strong> repository can be connected, and it is checked
        again each time. Disconnecting deletes the saved token and leaves the repository alone.
      </p>
      {unreachable ? <p className={styles.muted}>This needs a connection.</p> : null}
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      {warning ? <Alert variant="warning">{warning}</Alert> : null}
      {status?.connection ? (
        <>
          <p role="status">
            Connected to{' '}
            <a href={status.connection.url} target="_blank" rel="noreferrer noopener">
              {status.connection.repository}
            </a>
            , on <code>{status.connection.branch}</code>.
          </p>
          <p>
            {status.connection.lastBackup ? (
              <>
                Last backup: {new Date(status.connection.lastBackup.at).toLocaleString()},{' '}
                <a
                  href={status.connection.lastBackup.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {status.connection.lastBackup.path}
                </a>
                .
              </>
            ) : (
              'No backup has been made yet.'
            )}
          </p>
          <div className={styles.row}>
            <SegmentedControl<'manual' | 'auto'>
              aria-label="How backups are made"
              size="sm"
              value={status.connection.mode}
              onChange={(mode) => void schedule({ mode })}
              options={[
                { label: 'Only when I ask', value: 'manual' },
                { label: 'Automatically', value: 'auto' },
              ]}
            />
            {status.connection.mode === 'auto' ? (
              <FormField label="How often">
                {(field) => (
                  <Select
                    {...field}
                    value={status.connection?.frequency ?? 'daily'}
                    disabled={working}
                    onChange={(event) =>
                      void schedule({ frequency: event.target.value as Frequency })
                    }
                  >
                    {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((each) => (
                      <option key={each} value={each}>
                        {FREQUENCY_LABELS[each]}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : null}
          </div>
          {status.connection.mode === 'auto' ? (
            <p className={styles.hint}>
              Automatic backups only write a new file when something has changed since the last.
              {status.connection.lastCheckedAt !== null
                ? ` Last checked: ${new Date(status.connection.lastCheckedAt).toLocaleString()}.`
                : ''}
              {status.connection.nextBackupAt !== null
                ? ` Next check: ${new Date(status.connection.nextBackupAt).toLocaleString()}.`
                : ''}
            </p>
          ) : null}
          {status.connection.failure ? (
            <Alert variant={status.connection.failure.stoppedAt === null ? 'warning' : 'error'}>
              {status.connection.failure.stoppedAt === null
                ? 'The last backup could not be made. It will try again at the next time. '
                : 'Automatic backups have stopped. '}
              {status.connection.failure.message}
              {status.connection.failure.stoppedAt !== null
                ? ' Back up now, or connecting again, starts them again once it is mended.'
                : ''}
            </Alert>
          ) : null}
          {key.moving ? (
            <p className={styles.hint}>
              Your Desk is being sealed with your key. Backups wait until that is finished, so that
              no file has some of it in the clear.
            </p>
          ) : null}
          {key.sealed && !key.moving && status.connection.keyConfirmedAt === null ? (
            <Alert variant="warning">
              Your Desk now has a key of its own. Backups carry on with the Desk sealed (the file
              holds it as ciphertext, and restoring it needs your key), but the files already in
              your repository are plain text and stay readable there.
              <div className={styles.row}>
                <Button size="sm" disabled={working} onClick={() => void confirmKey()}>
                  I know, carry on
                </Button>
              </div>
            </Alert>
          ) : null}
          <div className={styles.row}>
            <Button disabled={working} onClick={() => void backUpNow()}>
              {working ? 'Working…' : 'Back up now'}
            </Button>
            <Button variant="secondary" disabled={working} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        </>
      ) : status && !status.canConnect ? (
        <p className={styles.muted}>
          This server has no encryption key, so it cannot keep a token safely and connecting a
          repository is not offered. Whoever runs it can turn it on by setting{' '}
          <code>TUSK_ENCRYPTION_KEY</code>.
        </p>
      ) : status ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <p className={styles.hint}>
            On GitHub, make a fine-grained token (Settings, Developer settings, Fine-grained tokens)
            for this one repository alone, with the permission <em>Contents: Read and write</em>.
            Tusk uses nothing else.
          </p>
          <FormField label="Repository" hint="owner/name, or its address on GitHub" required>
            {(field) => (
              <Input
                {...field}
                value={repository}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setRepository(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Token" required>
            {(field) => (
              <Input
                {...field}
                type="password"
                value={token}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setToken(event.target.value)}
              />
            )}
          </FormField>
          <div className={styles.row}>
            <Button type="submit" disabled={working || repository.trim() === '' || token === ''}>
              {working ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

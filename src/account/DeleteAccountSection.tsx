'use client';

import { useEffect, useState } from 'react';
import { messageFor } from '../auth/messages';
import { forgetKey } from '../cipher/vault';
import { forgetIdentity } from '../identity';
import { deleteLocal } from '../local/db';
import { useAccountId, useSync } from '../sync/react';
import { Alert, Button, FormField, Input } from '../ui';
import styles from './Account.module.css';

interface Preview {
  /** Whether it asks for the password; an account that came in through Sovereign has none, and a session made just now stands in. */
  password: boolean;
  workspaces: { name: string; to: string | null }[];
  backup: string | null;
}

/**
 * Settings, Data, Delete account (DESIGN.md §22). **It says what goes before it asks:** the Desk and the account, which workspaces pass to whom (the member who
 * has been in one longest, who is told) or are deleted because nobody else is in them, that comments and cards on boards that carry on stay as "Deleted
 * account", and that a backup repository is left alone. It asks for the password. This device's copy and key go with it; other devices find out at their next
 * sync, when their session has ended.
 */
export function DeleteAccountSection() {
  const client = useSync();
  const accountId = useAccountId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const reply = await fetch('/api/account/delete', { cache: 'no-store' });
        if (reply.ok) setPreview((await reply.json()) as Preview);
        else setProblem('This needs a connection.');
      } catch {
        setProblem('This needs a connection.');
      }
    })();
  }, [open]);

  async function remove() {
    setWorking(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (reply.status === 403) {
        const { code } = (await reply.json().catch(() => ({}))) as { code?: string };
        return setProblem(
          code === 'SESSION_NOT_FRESH'
            ? messageFor({ code }, 'Sign in again, and then try this once more.')
            : 'That is not your password.',
        );
      }
      if (reply.status === 429)
        return setProblem('That was tried too many times. Wait a few minutes.');
      if (!reply.ok)
        return setProblem(
          'That could not be done. Nothing was deleted, or it was only partly: try again.',
        );
      // The account is gone: this device's copy and key go too, and the page starts again from the front.
      setPassword('');
      client.close();
      client.db.close();
      await deleteLocal(accountId);
      forgetIdentity();
      await forgetKey(accountId).catch(() => undefined);
      window.location.assign('/');
    } catch {
      setProblem('That needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Delete account</h2>
      {!open ? (
        <>
          <p className={styles.muted}>
            Deletes your account and everything of yours. It cannot be undone: export first if you
            want a copy.
          </p>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Delete my account…
            </Button>
          </div>
        </>
      ) : (
        <form
          className={styles.form}
          aria-label="Delete account"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <p>This deletes your account, your Desk, and the token saved for your backups.</p>
          {preview ? (
            <>
              {preview.workspaces.length > 0 ? (
                <ul aria-label="Workspaces you own alone">
                  {preview.workspaces.map((each) => (
                    <li key={each.name}>
                      <strong>{each.name}</strong>:{' '}
                      {each.to === null
                        ? 'nobody else is in it, so it is deleted with its boards'
                        : `passes to ${each.to}, who has been in it longest, and is told`}
                      .
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.hint}>
                You are taken out of every other workspace and board. Your comments and the cards
                you made stay on boards that carry on, shown as “Deleted account”.
                {preview.backup
                  ? ` Your backup repository, ${preview.backup}, is not touched: delete its files there yourself if you want them gone.`
                  : ''}
              </p>
            </>
          ) : null}
          {problem ? <Alert variant="error">{problem}</Alert> : null}
          {preview && !preview.password ? (
            <p className={styles.hint}>
              You sign in through Sovereign, so there is no password to ask for. This asks that you
              signed in within the last ten minutes: if you did not, sign out, sign in again, and
              come back.
            </p>
          ) : (
            <FormField label="Your password" required>
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </FormField>
          )}
          <div className={styles.row}>
            <Button
              type="submit"
              disabled={working || preview === null || (preview.password && password === '')}
            >
              {working ? 'Deleting…' : 'Delete my account for good'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

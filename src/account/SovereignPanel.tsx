'use client';

import { type FormEvent, useState } from 'react';
import { linkToSovereign } from '@sovereignfs/auth/client';
import { authClient, deriveForSignIn, signInValue } from '../auth/client';
import { oauthErrorMessage } from '../auth/messages';
import { Alert, Button, FormField, Input } from '@sovereignfs/ui';
import styles from './Account.module.css';

/** Where linking comes back to: this section, with `link=done`, `taken` or `address` added by the package (auth.md §8.2). */
const BACK = '/account?section=security';

/**
 * Settings, Security, Sovereign (DESIGN.md §13.1): whether this account can also be signed into through Sovereign. **Linking and unlinking
 * each ask for the password**, sent as the sign-in value made from it (auth.md §4, rule 1). Linking then sends the person to Sovereign and
 * back; a Sovereign account already linked to another account here, or whose address is another account's here, is refused, and nothing is
 * linked. Unlinking is refused for an account with no other way to sign in.
 */
export function SovereignPanel({
  linked,
  canUnlink,
  email,
  result,
}: {
  /** Sovereign is linked to this account. */
  linked: boolean;
  /** The account has another way in, so that Sovereign can go. */
  canUnlink: boolean;
  email: string;
  /** What the way back from Sovereign (or from unlinking) left in the address. */
  result: { linked: boolean; unlinked: boolean; error: string | null };
}) {
  const { data } = authClient.useSession();
  const twoFactorOn = Boolean(
    (data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(oauthErrorMessage(result.error ?? undefined));

  async function link() {
    setBusy(true);
    setError(null);
    // On success the browser is sent to Sovereign and brought back to this section, with the result.
    const outcome = await linkToSovereign(deriveForSignIn, { password, email, returnTo: BACK });
    if (!outcome.ok) {
      setBusy(false);
      setError(outcome.message);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/account/unlink-sovereign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: await signInValue(password, email) }),
      });
      if (response.ok) {
        window.location.assign(`${BACK}&unlinked=1`);
        return;
      }
      const { code } = (await response.json().catch(() => ({}))) as { code?: string };
      setError(
        code === 'WRONG_PASSWORD'
          ? 'That password is not right.'
          : code === 'PASSWORD_LIMITED'
            ? 'Too many wrong passwords. Wait ten minutes, then try again.'
            : 'Sovereign was not unlinked. Try again.',
      );
    } catch {
      setError('This needs a connection. Try again when you are back online.');
    }
    setBusy(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password === '') return;
    void (linked ? unlink() : link());
  }

  return (
    <div className={styles.group} role="group" aria-labelledby="sovereign-title">
      <h2 id="sovereign-title">Sovereign</h2>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {result.linked && linked && !error ? (
        <Alert variant="success">Sovereign is linked.</Alert>
      ) : null}
      {result.unlinked && !linked && !error ? (
        <Alert variant="success">Sovereign is unlinked.</Alert>
      ) : null}
      {linked ? (
        <p className={styles.muted}>You can sign in with Sovereign as well as the other way.</p>
      ) : (
        <p className={styles.muted}>
          Link a Sovereign account to sign in with it as well. Its address must not be another
          account’s here.
        </p>
      )}
      {twoFactorOn && linked ? (
        <p className={styles.hint}>
          Signing in with Sovereign does not ask for an authenticator code here: Sovereign asks for
          its own.
        </p>
      ) : null}
      {asking ? (
        <form
          className={styles.form}
          onSubmit={onSubmit}
          aria-label={linked ? 'Unlink Sovereign' : 'Link Sovereign'}
        >
          <FormField label="Your password">
            {(field) => (
              <Input
                {...field}
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </FormField>
          <div className={styles.row}>
            <Button type="submit" loading={busy}>
              {linked ? 'Unlink' : 'Continue to Sovereign'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(false);
                setPassword('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.row}>
          <Button
            variant={linked ? 'secondary' : 'primary'}
            onClick={() => setAsking(true)}
            disabled={linked && !canUnlink}
          >
            {linked ? 'Unlink Sovereign' : 'Link Sovereign'}
          </Button>
        </div>
      )}
      {linked && !canUnlink ? (
        <p className={styles.hint}>It is the only way you can sign in, so it cannot be unlinked.</p>
      ) : null}
    </div>
  );
}

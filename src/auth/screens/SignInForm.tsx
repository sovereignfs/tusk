'use client';

import { type FormEvent, useState } from 'react';
import { authClient } from '../client';
import { messageFor } from '../messages';
import { AuthButton, AuthError, AuthField, AuthFooter, AuthForm, AuthLink, Input } from '../../ui';

/** Email and password. No message says whether an address has an account: a wrong address and a wrong password read the same. */
export function SignInForm({ canSignUp }: { canSignUp: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.signIn.email({ email, password });
    if (failure) {
      setBusy(false);
      setError(messageFor(failure));
      return;
    }
    // A full navigation, not a client-side one: `/` is a different page now that there is a session, and the server decides which.
    window.location.assign('/');
  }

  return (
    <>
      <AuthForm onSubmit={(event) => void onSubmit(event)}>
        <AuthField label="Email">
          {(field) => (
            <Input
              {...field}
              type="email"
              name="email"
              autoComplete="username"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </AuthField>
        <AuthField label="Password">
          {(field) => (
            <Input
              {...field}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </AuthField>
        {error ? <AuthError>{error}</AuthError> : null}
        <AuthButton type="submit" loading={busy}>
          Sign in
        </AuthButton>
      </AuthForm>
      {canSignUp ? (
        <AuthFooter>
          New here? <AuthLink href="/sign-up">Create account</AuthLink>
        </AuthFooter>
      ) : null}
    </>
  );
}

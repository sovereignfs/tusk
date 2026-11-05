'use client';

import { type FormEvent, useState } from 'react';
import { authClient } from '../client';
import { messageFor } from '../messages';
import { AuthButton, AuthError, AuthField, AuthForm, Input } from '../../ui';

/** Name, email and password. Without email there is nothing to confirm, so the account is made and the person is signed in. */
export function SignUpForm({ minLength }: { minLength: number }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.signUp.email({ name, email, password });
    if (failure) {
      setBusy(false);
      setError(messageFor(failure));
      return;
    }
    window.location.assign('/');
  }

  return (
    <AuthForm onSubmit={(event) => void onSubmit(event)}>
      <AuthField label="Name">
        {(field) => (
          <Input
            {...field}
            name="name"
            autoComplete="name"
            required
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </AuthField>
      <AuthField label="Email">
        {(field) => (
          <Input
            {...field}
            type="email"
            name="email"
            autoComplete="email"
            required
            disabled={busy}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </AuthField>
      <AuthField
        label="Password"
        hint={`At least ${minLength} characters. A few random words is a good one.`}
      >
        {(field) => (
          <Input
            {...field}
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={minLength}
            disabled={busy}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </AuthField>
      {error ? <AuthError>{error}</AuthError> : null}
      <AuthButton type="submit" loading={busy}>
        Create account
      </AuthButton>
    </AuthForm>
  );
}

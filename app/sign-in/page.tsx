import { notFound, redirect } from 'next/navigation';
import { AuthShell } from '@/src/auth/screens/AuthShell';
import { SignInForm } from '@/src/auth/screens/SignInForm';
import { authSettings, mailAvailable, signUpAvailable } from '@/src/auth/server';
import { getSession } from '@/src/auth/session';

// Decided per request from the settings and the visitor's cookies. Left to Next it would be prerendered at build time, with no settings, as the
// "off" 404 it would then keep.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage() {
  if (!authSettings()) notFound();
  if (await getSession()) redirect('/');
  return (
    <AuthShell title="Sign in to Tusk">
      <SignInForm canSignUp={await signUpAvailable()} canReset={mailAvailable()} />
    </AuthShell>
  );
}

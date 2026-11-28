import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { needsCoreCheck } from '@sovereignfs/auth/core';
import { readSession } from '@sovereignfs/auth/server';
import { getAuthStore } from '../db/boot';
import { authSettings, getAuth } from './server';
import type { Auth } from './auth';

export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

/**
 * The signed-in person's session, or null: nobody is signed in, or sign-in is off. Read through the package (auth.md §6), which refuses a
 * deactivated account's session whatever the table says.
 */
export async function getSession(): Promise<Session | null> {
  const auth = await getAuth();
  if (!auth) return null;
  return (await readSession(auth, await headers())) as Session | null;
}

/**
 * For a page or action that is only for someone signed in: **the account id** (better-auth's user id), which is what everything of a person is
 * owned by (AGENTS.md). Sends a visitor to sign in, and answers 404 where there is no sign-in at all.
 */
export async function requireAccount(): Promise<string> {
  return (await requireSession()).user.id;
}

/** As `requireAccount`, for a layout that also shows who the person is. */
export async function requireSession(): Promise<Session> {
  const settings = authSettings();
  if (!settings) notFound();
  const session = await getSession();
  if (!session) redirect('/sign-in');
  // A session that came from core follows core's: an hour after its last check it goes through core with `prompt=none`, which renews it
  // in place while the person is still signed in there and ends it when they are not (sdk §9.7, auth.md §8).
  if (settings.sovereign && (await needsCoreCheck(await getAuthStore(), session.session.id)))
    redirect('/api/auth/sign-in/sovereign?prompt=none');
  return session;
}

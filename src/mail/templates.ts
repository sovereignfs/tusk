import type { Message } from './mailer';

/**
 * The messages the app sends (DESIGN.md §6), plain text, each with one link and nothing of the account but the address it goes to. What the link does is the
 * sign-in library's: a verification link signs the person in, and a reset link is good once.
 */
export function verificationMessage(app: string, to: string, link: string): Message {
  return {
    to,
    subject: `Confirm your address for ${app}`,
    text: `Confirm this address for ${app} and sign in:\n\n${link}\n\nIf you did not ask for this, ignore it: nothing happens until the link is used.\n`,
  };
}

export function resetMessage(app: string, to: string, link: string): Message {
  return {
    to,
    subject: `Reset your ${app} password`,
    text: `Choose a new password for ${app}:\n\n${link}\n\nThe link can be used once and ends soon. Using it signs you out everywhere else. If you did not ask for this, ignore it: your password is not changed.\n`,
  };
}

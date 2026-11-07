/**
 * What can be wrong with connecting a repository, and what to tell a person for each (DESIGN.md §21.2). Pure, with no server code in it, so that Settings can
 * show the words when GitHub sends the person back with a code. **Our words, never GitHub's, never a token.**
 */
export type ConnectProblem =
  | 'address'
  | 'host'
  | 'password'
  | 'no_key'
  | 'token'
  | 'token_rejected'
  | 'not_visible'
  | 'public'
  | 'empty'
  | 'read_only'
  | 'rate_limited'
  | 'unreachable'
  // Through the GitHub App (§21.2):
  | 'app_authorize'
  | 'app_not_yours'
  | 'app_no_repository'
  | 'app_choose_one'
  | 'app_state';

export const PROBLEM_MESSAGES: Record<ConnectProblem, string> = {
  address:
    'That is not the address of a repository. Paste its address (https://github.com/owner/name), or write it as owner/name.',
  host: 'Only repositories on GitHub can be connected, and that address is on another host.',
  password:
    'That address has a user name or password in it. Paste the address without it: the token goes in the next box.',
  no_key:
    'This server has no encryption key, so it cannot keep a token safely. Ask whoever runs it to set TUSK_ENCRYPTION_KEY.',
  token: 'Paste the token you made on GitHub.',
  token_rejected:
    'GitHub did not accept that token. It may have a typo, have expired or have been revoked. Make a new one and paste it.',
  not_visible:
    'The token cannot see that repository. Check the address, and that the token was made for this repository.',
  public:
    'That repository is public, and a backup is plain text that anyone could read. Only a private repository can be connected: make it private, or connect another.',
  empty:
    'That repository has nothing in it yet. Add a file (a README will do) on GitHub, then connect it again.',
  read_only:
    'The token can read that repository but not write to it. Make a token for it with “Contents: Read and write”.',
  rate_limited: 'GitHub asks to be left alone for a while. Try again in a few minutes.',
  unreachable: 'GitHub could not be reached. Try again in a little while.',
  app_authorize:
    'GitHub did not say who you are, so nothing was connected. Install the App again, and allow it to identify you when GitHub asks.',
  app_not_yours:
    'That installation is not one you can reach, so nothing was connected. Install the App on your own account or organisation.',
  app_no_repository:
    'The App is installed but can reach no repository. Choose one repository for it on GitHub, then connect again.',
  app_choose_one:
    'The App can reach more than one repository. Tusk backs up to one: change the installation on GitHub to “Only select repositories” and choose that one, then connect again.',
  app_state:
    'That sign-in did not start here, or took too long, so nothing was connected. Start again from Settings.',
};

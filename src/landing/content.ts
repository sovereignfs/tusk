/**
 * What the landing page says (DESIGN.md §14.1), as typed content so that it is read in one place and cannot be half-edited. It says what is so
 * today and nothing that is only planned: a page that promises what the app does not do is worse than a short one.
 */
export interface Feature {
  title: string;
  body: string;
}

export const landing = {
  heading: 'Your tasks, kept to yourself',
  lead: 'A private task manager that you run yourself, or that your Sovereign instance runs for you. A cleaner Google Tasks, not a project management tool.',
  features: [
    {
      title: 'It never makes you wait',
      body: 'Tasks works from what is on your device, online or not. Adding, ticking and reordering show at once, and it syncs in the background.',
    },
    {
      title: 'Yours alone',
      body: 'Your lists are visible to you and no one else, on a server you choose. No telemetry, no third-party service, nothing loaded from another site.',
    },
    {
      title: 'Simple on purpose',
      body: 'Lists and the tasks in them. Features stay out of the way until you reach for them.',
    },
  ] satisfies Feature[],
  signIn: 'Sign in',
  signUp: 'Create an account',
  noSignIn: 'Signing in is not set up on this server.',
} as const;

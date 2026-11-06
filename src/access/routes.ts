/**
 * Every page and route of the app, and who may use it (DESIGN.md §7). A route that is not here, or is here with a method it does not have, fails
 * `routes.test.ts`, so that a new endpoint cannot be added without saying who may call it, and a decision in this table cannot outlive the route.
 *
 *  - `public`: anyone, signed in or not. It shows nothing that belongs to an account. A public route that changes something says what stands in
 *    for a session in `because`, and the test refuses one that does not.
 *  - `account`: a signed-in account, and only its own data. A page asks `requireAccount()`; a route is wrapped in `accountRoute` (`route.ts`),
 *    which finds the session, checks `Origin` on a write and hands over the account id. The test holds both to it.
 *
 * The rest of the rules (what a role may do to a shared list) arrive with sharing, in phase 2.
 */
export type RouteAccess = { kind: 'public'; because?: string } | { kind: 'account' };

export interface RouteRule {
  /** The route as the app router spells it: `/api/lists/[id]`. */
  route: string;
  /** For an API route, each method it answers. A page has none. */
  methods?: Record<string, RouteAccess>;
  /** For a page. */
  page?: RouteAccess;
}

export const ROUTES: RouteRule[] = [
  // Pages
  { route: '/', page: { kind: 'public' } },
  { route: '/sign-in', page: { kind: 'public' } },
  { route: '/sign-up', page: { kind: 'public' } },
  // The page the service worker keeps (DESIGN.md §17.9): the same for everyone, with nothing of an account in it. Who is signed in is read on the device.
  { route: '/shell', page: { kind: 'public' } },
  // The app, for someone signed in: the layout around it (`app/(app)/layout.tsx`) finds who, and each page asks for itself as well.
  // Settings (DESIGN.md §19): a page of its own, and a dialog over another page by an intercepting route at the same address.
  { route: '/account', page: { kind: 'account' } },
  { route: '/desk', page: { kind: 'account' } },
  { route: '/w/[id]', page: { kind: 'account' } },
  { route: '/boards', page: { kind: 'account' } },
  { route: '/inbox', page: { kind: 'account' } },
  { route: '/b/[id]', page: { kind: 'account' } },
  { route: '/b/[id]/c/[cardId]', page: { kind: 'account' } },
  { route: '/desk/[id]', page: { kind: 'account' } },

  // APIs
  // The one door nearly every write comes through (DESIGN.md §8.3): the account is the session's, and the server applies what a device sends only to it.
  { route: '/api/sync', methods: { POST: { kind: 'account' } } },
  // The one door every write to a workspace comes through (DESIGN.md §7.3): the account is the session's, and the permission is in the statement.
  { route: '/api/ops', methods: { POST: { kind: 'account' } } },
  { route: '/api/workspaces', methods: { GET: { kind: 'account' } } },
  { route: '/api/workspaces/[id]/members', methods: { GET: { kind: 'account' } } },
  { route: '/api/workspaces/[id]/boards', methods: { GET: { kind: 'account' } } },
  { route: '/api/cards/[id]/comments', methods: { GET: { kind: 'account' } } },
  { route: '/api/cards/[id]', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards', methods: { GET: { kind: 'account' } } },
  { route: '/api/settings', methods: { GET: { kind: 'account' }, PATCH: { kind: 'account' } } },
  // The repository an account backs up to (DESIGN.md §21.2): the account is the session's, and the token is in one request and no response.
  {
    route: '/api/backup/connection',
    methods: { GET: { kind: 'account' }, POST: { kind: 'account' }, DELETE: { kind: 'account' } },
  },
  { route: '/api/inbox', methods: { GET: { kind: 'account' } } },
  { route: '/api/inbox/seen', methods: { POST: { kind: 'account' } } },
  { route: '/api/inbox/unread', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]/activity', methods: { GET: { kind: 'account' } } },
  { route: '/api/cards/[id]/activity', methods: { GET: { kind: 'account' } } },
  { route: '/api/activity', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]/publication', methods: { GET: { kind: 'account' } } },
  { route: '/api/publications', methods: { GET: { kind: 'account' } } },
  // The server's part of an export (DESIGN.md §20.1): a board for anyone who may see it, a workspace for its owners, and the workspaces the person owns.
  { route: '/api/export', methods: { GET: { kind: 'account' } } },
  // The server's part of an import (DESIGN.md §20.2): into a workspace the person is in, or as workspaces of their own; one transaction, checked again here.
  { route: '/api/import', methods: { POST: { kind: 'account' } } },
  // A published board (DESIGN.md §14.6): anyone with the address. It changes nothing, shows the work and no people, and is limited per address.
  { route: '/p/[token]', methods: { GET: { kind: 'public' } } },
  { route: '/api/boards/[id]/destinations', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]/people', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]/archived', methods: { GET: { kind: 'account' } } },
  { route: '/api/boards/[id]/version', methods: { GET: { kind: 'account' } } },
  { route: '/api/health', methods: { GET: { kind: 'public' } } },
  // The service worker's text (DESIGN.md §17.9): the same for everyone, the build's version and the names of its files, and nothing of an account.
  { route: '/sw.js', methods: { GET: { kind: 'public' } } },
  // better-auth's own: it checks `Origin` and the session cookie itself, and rate-limits sign-in (src/auth/auth.ts). Absent, with a 404, when sign-in is off.
  {
    route: '/api/auth/[...all]',
    methods: {
      GET: { kind: 'public' },
      POST: {
        kind: 'public',
        because: 'better-auth checks Origin, the session cookie and the rate limit',
      },
    },
  },
];

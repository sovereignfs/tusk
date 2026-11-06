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
  // The app, for someone signed in: the layout around it (`app/(app)/layout.tsx`) finds who, and each page asks for itself as well.
  { route: '/desk', page: { kind: 'account' } },
  { route: '/desk/[id]', page: { kind: 'account' } },

  // APIs
  // The one door nearly every write comes through (DESIGN.md §8.3): the account is the session's, and the server applies what a device sends only to it.
  { route: '/api/sync', methods: { POST: { kind: 'account' } } },
  { route: '/api/health', methods: { GET: { kind: 'public' } } },
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

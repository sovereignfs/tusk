'use client';

import { createAuthClient } from 'better-auth/react';

/** better-auth in the browser, talking to `/api/auth` on the same origin. */
export const authClient = createAuthClient();

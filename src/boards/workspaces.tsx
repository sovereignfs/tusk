'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Op, OpReason, OpRefusal, OpResult, WorkspaceRow } from '../workspaces/format';
import { showing, sorted } from './optimistic';

/**
 * The person's workspaces in the browser (DESIGN.md §14.7, §17.2): read from the server and held in memory, **not on the device** (boards are online in
 * phase 1). A change shows at once and is sent through the one door (`POST /api/ops`); the server's answer replaces what the screen guessed, and a
 * refusal or a lost connection puts it back. Offline, the list that was held stays on the screen, and a change says it needs a connection.
 */
export type Failure = OpRefusal | 'offline' | 'rate';
export type Performed =
  | { ok: true; rows: Extract<OpResult, { status: 'applied' }>['rows'] }
  | { ok: false; reason: Failure; detail?: OpReason };

interface Workspaces {
  /** Not read yet, or read. */
  ready: boolean;
  workspaces: readonly WorkspaceRow[];
  perform(request: Op): Promise<Performed>;
  /** Reads the workspaces again, for a change that was not made through `perform` (an import). */
  reload(): Promise<boolean>;
}

const Context = createContext<Workspaces | null>(null);

export function WorkspacesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceRow[]>([]);
  const held = useRef<readonly WorkspaceRow[]>([]);
  const set = useCallback((next: readonly WorkspaceRow[]) => {
    held.current = next;
    setWorkspaces(next);
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const reply = await fetch('/api/workspaces', { cache: 'no-store' });
      if (!reply.ok) return false;
      const body = (await reply.json()) as { workspaces: WorkspaceRow[] };
      set(sorted(body.workspaces));
      setReady(true);
      return true;
    } catch {
      return false;
    }
  }, [set]);

  // Read when the page opens, and again when the person comes back to it: another person may have added them to a workspace in the meantime.
  useEffect(() => {
    void refresh();
    const again = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [refresh]);

  const perform = useCallback(
    async (request: Op): Promise<Performed> => {
      const before = held.current;
      set(showing(before, request, Date.now()));
      const undo = async () => {
        // The truth if it can be had; the list as it was if not.
        if (!(await refresh())) set(before);
      };
      let result: OpResult;
      try {
        const reply = await fetch('/api/ops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opId: crypto.randomUUID(), ...request }),
        });
        if (!reply.ok) {
          await undo();
          return {
            ok: false,
            reason: reply.status === 400 ? 'invalid' : reply.status === 429 ? 'rate' : 'offline',
          };
        }
        result = (await reply.json()) as OpResult;
      } catch {
        set(before);
        return { ok: false, reason: 'offline' };
      }
      if (result.status === 'refused') {
        await undo();
        return result.reason
          ? { ok: false, reason: result.code, detail: result.reason }
          : { ok: false, reason: result.code };
      }
      const row = result.rows.workspace;
      if (row) set(sorted([...held.current.filter((each) => each.id !== row.id), row]));
      // A change to someone's role may have been one's own, and who was removed may have been oneself: the truth is cheap to read.
      if (request.op === 'member.leave') {
        const left = request.workspaceId;
        set(held.current.filter((each) => each.id !== left));
      }
      if (request.op.startsWith('member.')) void refresh();
      return { ok: true, rows: result.rows };
    },
    [refresh, set],
  );

  const value = useMemo(
    () => ({ ready, workspaces, perform, reload: refresh }),
    [ready, workspaces, perform, refresh],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspaces(): Workspaces {
  const value = useContext(Context);
  if (!value) throw new Error('useWorkspaces needs WorkspacesProvider');
  return value;
}

/** What to tell a person when an operation did not happen. */
export function failureMessage(reason: Failure, detail?: OpReason): string {
  if (detail === 'no_account') return 'No account with that address here.';
  if (detail === 'already_in') return 'They are in this workspace already.';
  if (detail === 'last_owner')
    return 'A workspace keeps at least one owner. Make someone else an owner first, or delete the workspace.';
  switch (reason) {
    case 'rate':
      return 'That was tried too many times. Try again in a while.';
    case 'offline':
      return 'This needs a connection. Try again when you are back online.';
    case 'limit':
      return 'An account can make 50 workspaces, and a workspace can hold 100 people.';
    case 'invalid':
      return 'That is not allowed.';
    case 'stale':
      return 'That has changed since you looked. Reload and try again.';
    case 'not_found':
      return 'That is not here any more, or it is not yours to change.';
  }
}

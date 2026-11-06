'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardView, Op, OpRefusal, OpResult } from '../workspaces/format';
import { settled, showingBoard } from './board-optimistic';

/**
 * A board held in memory (DESIGN.md §14.7): **read from the server and not kept on the device.** A change shows at once and is sent through the one door
 * (`POST /api/ops`), **in order and one at a time**, so that a drag followed by an edit reach the server as they were made. The server's answer is
 * kept; a refusal, or a lost connection, puts the board back as the server last said it was and says why.
 *
 * It has no live updates (phase 2). Every operation moves the board's `version` on; while the board is open and visible the browser asks for the
 * version every twenty seconds and when the person comes back, and reads the board again if it moved, once nothing of its own is waiting to be sent.
 * Offline, the board stays on the screen as it was, read-only, and says it needs a connection.
 */
export const POLL_MS = 20_000;

const CHANGES_WHAT_I_MAY: ReadonlySet<Op['op']> = new Set([
  'board.archive',
  'board.restore',
  'board.setVisibility',
  'boardMember.add',
  'boardMember.setRole',
  'boardMember.remove',
  'board.join',
  'board.leave',
]);

export type BoardFailure = OpRefusal | 'offline' | 'rate';

export interface BoardStore {
  view: BoardView;
  /** The connection was lost: what is shown is what was last read, and nothing can be changed. */
  offline: boolean;
  /** The board is no longer there for this person (deleted, made private, or they left the workspace). */
  gone: boolean;
  /** Whether this board can be changed now: the person may, and the connection is there. */
  editable: boolean;
  /** Shows the change at once and sends it. Resolves to whether the server kept it. */
  perform(op: Op): Promise<boolean>;
}

export function useBoard(
  initial: BoardView,
  onFailure: (reason: BoardFailure) => void,
): BoardStore {
  const [view, setView] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  /** The board as the server last said it was, with the answers to what has been sent since: where a refusal puts the screen back. */
  const confirmed = useRef(initial);
  /** Operations shown and not yet answered. */
  const pending = useRef(0);
  /** Raised by a refusal, so that what was queued behind it (made on top of what was refused) is dropped and not sent. */
  const epoch = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const id = initial.board.id;
  const failed = useRef(onFailure);
  useEffect(() => {
    failed.current = onFailure;
  });

  const adopt = useCallback((next: BoardView) => {
    confirmed.current = next;
    setView(next);
  }, []);

  /** The board as the server holds it now. False if it could not be asked. */
  const reload = useCallback(async (): Promise<boolean> => {
    try {
      const reply = await fetch(`/api/boards/${id}`, { cache: 'no-store' });
      if (reply.status === 404) {
        setGone(true);
        setOffline(false);
        return true;
      }
      if (!reply.ok) return false;
      adopt((await reply.json()) as BoardView);
      setOffline(false);
      return true;
    } catch {
      setOffline(true);
      return false;
    }
  }, [adopt, id]);

  const send = useCallback(
    async (op: Op, mine: number): Promise<boolean> => {
      // Dropped: something before it was refused, and the board has been put back already.
      if (mine !== epoch.current) {
        pending.current -= 1;
        return false;
      }
      let failure: BoardFailure;
      try {
        const reply = await fetch('/api/ops', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opId: crypto.randomUUID(), ...op }),
        });
        if (!reply.ok) {
          failure = reply.status === 400 ? 'invalid' : reply.status === 429 ? 'rate' : 'offline';
        } else {
          const result = (await reply.json()) as OpResult;
          if (result.status === 'applied') {
            confirmed.current = settled(showingBoard(confirmed.current, op), op, result.rows);
            pending.current -= 1;
            // These change what the person may do here (archiving, joining, leaving, being given a role, a board made private), which only the server
            // knows: the board is read again.
            if (CHANGES_WHAT_I_MAY.has(op.op)) await reload();
            // Nothing else waits: the screen is the server's, with the row it sent in place of the guess.
            if (pending.current === 0) setView(confirmed.current);
            else setView((now) => settled(now, op, result.rows));
            return true;
          }
          failure = result.code;
        }
      } catch {
        failure = 'offline';
      }
      pending.current -= 1;
      epoch.current += 1;
      setView(confirmed.current);
      failed.current(failure);
      // The truth if it can be had; a lost connection says so, and leaves what was last read.
      if (failure === 'offline') setOffline(true);
      else await reload();
      return false;
    },
    [reload],
  );

  const perform = useCallback(
    (op: Op): Promise<boolean> => {
      // An administrator who is not on the board (and a board that is archived) changes nothing in it, but archives, restores, edits and deletes it.
      if (offline || gone || !(view.can.edit || view.can.admin)) {
        if (offline) failed.current('offline');
        return Promise.resolve(false);
      }
      pending.current += 1;
      setView((now) => showingBoard(now, op));
      const mine = epoch.current;
      const run = queue.current.then(() => send(op, mine));
      queue.current = run;
      return run;
    },
    [gone, offline, send, view.can.edit, view.can.admin],
  );

  // Freshness: the version, every twenty seconds while the board is open and visible, and when the person comes back to it.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const reply = await fetch(`/api/boards/${id}/version`, { cache: 'no-store' });
        if (reply.status === 404) {
          setGone(true);
          return;
        }
        if (!reply.ok) return;
        const { version } = (await reply.json()) as { version: number };
        // Back from being offline, or someone else changed it. Not while something of ours is on its way: its answer will bring the version with it.
        if (pending.current === 0 && (version !== confirmed.current.board.version || offline))
          await reload();
        else setOffline(false);
      } catch {
        setOffline(true);
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    const again = () => void check();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
    };
  }, [id, offline, reload]);

  return useMemo(
    () => ({ view, offline, gone, editable: view.can.edit && !offline && !gone, perform }),
    [view, offline, gone, perform],
  );
}

/** What to tell a person when a change to a board did not happen. */
export function boardFailureMessage(reason: BoardFailure): string {
  switch (reason) {
    case 'offline':
      return 'This needs a connection. The board is as it was when it was last read.';
    case 'rate':
      return 'That was tried too many times. Try again in a while.';
    case 'limit':
      return 'A board can hold 100 lists.';
    case 'invalid':
      return 'That is not allowed.';
    case 'stale':
      return 'That has changed since you looked. The board has been read again.';
    case 'not_found':
      return 'That is not here any more, or it is not yours to change. The board has been read again.';
  }
}

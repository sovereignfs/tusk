'use client';

import { createContext, useContext } from 'react';
import type { BoardPeople } from '../workspaces/format';
import type { BoardStore } from './store';

/**
 * The board held in memory (`useBoard`), offered to whatever is shown over it: the card's dialog is a page of its own, rendered by the board's layout inside
 * the board, so that it shares this store and a change made in it shows on the tile at once.
 */
export const BoardContext = createContext<BoardStore | null>(null);

export function useBoardStore(): BoardStore {
  const store = useContext(BoardContext);
  if (!store) throw new Error('useBoardStore needs a board around it');
  return store;
}

/**
 * The board's people (its members, by name), for the avatars on a tile and the assignees picker in a card's dialog. Read by the board and offered with its
 * store; `null` until it has been read, when a tile shows no avatars.
 */
export const BoardPeopleContext = createContext<BoardPeople | null>(null);

export function useBoardPeople(): BoardPeople | null {
  return useContext(BoardPeopleContext);
}

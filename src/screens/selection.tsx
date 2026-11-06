'use client';

import { type ReactNode, createContext, useContext } from 'react';

/**
 * Which cards of a list are chosen, to be acted on together (DESIGN.md §10.6). It lives in the list's screen and is given to its rows, so that a row can
 * say whether it is chosen and choose itself; a row outside a list (a search result) has none, and a click there is only a click.
 */
export interface Selection {
  readonly selected: ReadonlySet<string>;
  /** Whether anything is chosen: while it is, a click on a row chooses it and does not open it. */
  readonly active: boolean;
  toggle(id: string): void;
  clear(): void;
}

const Context = createContext<Selection | null>(null);

export function SelectionProvider({ value, children }: { value: Selection; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useSelection = (): Selection | null => useContext(Context);

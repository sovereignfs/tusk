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
import { Button } from '../ui';
import styles from './Undo.module.css';

/**
 * **Every delete offers Undo** (DESIGN.md §11.5), for about ten seconds. The design system's toast has no action to press, so this is the small bar
 * that has one. One at a time: a second delete takes the place of the first, whose Undo is gone, which is what a person who has just deleted
 * something else expects, and what keeps the bar from becoming a stack.
 */
interface Offer {
  message: string;
  undo: () => void | Promise<void>;
}

const Context = createContext<((message: string, undo: Offer['undo']) => void) | null>(null);

export const UNDO_MS = 10_000;

export function useUndo(): (message: string, undo: Offer['undo']) => void {
  const offer = useContext(Context);
  if (!offer) throw new Error('useUndo is used inside an UndoProvider');
  return offer;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Offer & { id: number }) | null>(null);
  const counter = useRef(0);

  const offer = useCallback((message: string, undo: Offer['undo']) => {
    setCurrent({ message, undo, id: ++counter.current });
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const value = useMemo(() => offer, [offer]);
  return (
    <Context.Provider value={value}>
      {children}
      {current ? (
        <div className={styles.bar} role="status" aria-live="polite">
          <span>{current.message}</span>
          <Button
            variant="secondary"
            onClick={() => {
              const { undo } = current;
              setCurrent(null);
              void undo();
            }}
          >
            Undo
          </Button>
        </div>
      ) : null}
    </Context.Provider>
  );
}

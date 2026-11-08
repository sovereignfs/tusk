'use client';

import { type FormEvent, useEffect, useRef } from 'react';
import { createCard } from '../actions/cards';
import type { LocalRow } from '../local/rows';
import { cardCount } from '../local/store';
import { useLocal, useSync } from '../sync/react';
import { Input, useIsMobile, useToast } from '../ui';
import styles from './ListScreen.module.css';

const ids = { newId: () => crypto.randomUUID() };

/**
 * "Add a card…" (DESIGN.md §3, journey 3): they type a title and press Enter, and it is at the top at once, online or not, and **the cursor is still
 * there** for the next one, so a person can add several without touching the mouse. The field is focused when a list opens, except on a phone, where
 * that would raise the keyboard over the list.
 */
export function AddCard({ listId, cards }: { listId: string; cards: readonly LocalRow[] }) {
  const client = useSync();
  const toast = useToast();
  const mobile = useIsMobile();
  const field = useRef<HTMLInputElement>(null);
  // Where the last card made here went, for the next to go above, while the screen is still catching up with it.
  const last = useRef<{ list: string; position: string } | null>(null);
  // Every card row there is, deleted ones too, which count against the limit until they are removed for good.
  const count = useLocal(cardCount);

  useEffect(() => {
    // Without scrolling to it: in a carousel of lists (a phone, DESIGN.md §18) the field may be in a slide that is not the one on screen, and the browser would
    // scroll the carousel to reveal it.
    if (!mobile) field.current?.focus({ preventScroll: true });
  }, [listId, mobile]);

  function submit(event: FormEvent) {
    event.preventDefault();
    // What is in the field now, read from the field: a title typed and sent in the same breath (a paste and Enter, a fast typist) has reached the
    // field before React has handed it back through state, and state would be one keystroke behind.
    const title = field.current?.value ?? '';
    const above = last.current?.list === listId ? last.current.position : undefined;
    const result = createCard(listId, cards, { title }, ids, count ?? cards.length, above);
    if (!result.ok) {
      if (result.reason === 'limit') {
        toast.show({
          title: 'You have as many cards as an account can hold.',
          category: 'warning',
        });
      }
      return;
    }
    // Cleared before the write finishes, so that the next title can be typed at once and the focus never leaves.
    if (field.current) field.current.value = '';
    const made = result.mutation.changes[0];
    if (made && 'position' in made && made.position)
      last.current = { list: listId, position: made.position };
    void client.commit(result.mutation);
  }

  return (
    <form onSubmit={submit} className={styles.add}>
      <Input
        ref={field}
        aria-label="Add a card"
        data-shortcut="new-card"
        placeholder="Add a card…"
        maxLength={500}
        autoComplete="off"
      />
    </form>
  );
}

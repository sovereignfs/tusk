'use client';

import { type ReactNode, useState } from 'react';
import type { LocalRow } from '../local/rows';
import { type IconName, SwipeStack, SwipeStackCard } from '@sovereignfs/ui';
import { text } from '../screens/fields';
import styles from './SwipeCards.module.css';

/**
 * Cards to go through one at a time (DESIGN.md §25.3): the design system's `SwipeStack` over Desk cards, **with a button for each direction always shown**, since a
 * gesture is never the only way (a keyboard reaches the buttons, and the stack says what each does). It decides nothing about what a direction means: `onSwipe`
 * is told which and for what card, and Today and Review each give it their own. A card that has been swiped is not shown again in this pass, whether or not the
 * working copy has caught up with what the swipe did, and **tapping its title opens it** (`onOpen`).
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface DirectionLabel {
  readonly label: string;
  readonly icon?: IconName;
}

export function SwipeCards({
  cards,
  directions,
  ariaLabel,
  onSwipe,
  onOpen,
  detail,
  empty,
}: {
  cards: readonly LocalRow[];
  directions: Partial<Record<Direction, DirectionLabel>>;
  ariaLabel: string;
  onSwipe(direction: Direction, card: LocalRow): void;
  onOpen(card: LocalRow): void;
  /** What a card shows under its title: why it is here, when it is due. */
  detail?(card: LocalRow): ReactNode;
  /** What there is when every card has been gone through. */
  empty: ReactNode;
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const left = cards.filter((card) => !gone.has(card.id));
  if (left.length === 0) return <>{empty}</>;
  return (
    <div className={styles.wrap}>
      <p className={styles.count} role="status" aria-live="polite">
        {left.length} left
      </p>
      <SwipeStack
        aria-label={ariaLabel}
        directions={directions}
        onSwipe={(direction, id) => {
          const card = left.find((each) => each.id === id);
          if (!card) return;
          setGone((was) => new Set(was).add(id));
          onSwipe(direction, card);
        }}
      >
        {left.slice(0, 2).map((card) => (
          <SwipeStackCard key={card.id} cardId={card.id}>
            <div className={styles.card}>
              <button
                type="button"
                className={styles.title}
                data-card-title=""
                onClick={() => onOpen(card)}
              >
                {text(card, 'title', 'Untitled card')}
              </button>
              {detail ? <div className={styles.detail}>{detail(card)}</div> : null}
              {text(card, 'description') !== '' ? (
                <p className={styles.description}>{text(card, 'description')}</p>
              ) : null}
            </div>
          </SwipeStackCard>
        ))}
      </SwipeStack>
    </div>
  );
}

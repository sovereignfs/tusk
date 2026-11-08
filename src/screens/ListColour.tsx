'use client';

import { useEffect, useRef, useState } from 'react';
import { setColor } from '../actions/lists';
import { SWATCHES } from '../lists/colors';
import type { LocalRow } from '../local/rows';
import { useSync } from '../sync/react';
import { ColorPicker, Popover } from '@sovereignfs/ui';
import { colourOf, text } from './fields';
import styles from './ListScreen.module.css';

const ids = { newId: () => crypto.randomUUID() };

/** How long a colour chosen with the native picker, which fires as the person drags, is held before it is written: one change, and not one for every pixel. */
const SETTLE_MS = 400;

/**
 * The colour of the list, beside its name (DESIGN.md §10.1, §17.7): the dot, which opens the design system's colour picker with suggestions and a free
 * choice. **Any colour**, written `#rrggbb`. A suggestion is written at once; a colour dragged for in the native picker is written when it settles. It
 * is a field of the list, so it reaches the person's other devices.
 */
export function ListColour({ list }: { list: LocalRow }) {
  const client = useSync();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const color = draft ?? colourOf(list);

  useEffect(() => () => clearTimeout(timer.current), []);
  // What the working copy says now is what is shown again, once it has caught up with the choice.
  useEffect(() => {
    if (draft !== null && colourOf(list) === draft) setDraft(null);
  }, [list, draft]);

  function write(value: string) {
    clearTimeout(timer.current);
    const result = setColor(list, value, ids);
    if (result.ok) void client.commit(result.mutation);
    else setDraft(null);
  }

  return (
    <Popover
      aria-label="Colour of the list"
      open={open}
      onClose={() => setOpen(false)}
      align="left"
      width={264}
      trigger={
        <button
          type="button"
          className={styles.colour}
          aria-label={`Colour of ${text(list, 'title', 'the list')}`}
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <span className={styles.swatch} style={{ background: color }} aria-hidden />
        </button>
      }
    >
      <ColorPicker
        aria-label="Colour"
        customLabel="Pick any colour"
        swatches={SWATCHES}
        value={color}
        onChange={(value) => {
          if (value === null) return;
          const next = value.toLowerCase();
          setDraft(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => write(next), SETTLE_MS);
        }}
        onSelectionComplete={() => {
          if (draft !== null) write(draft);
          setOpen(false);
        }}
      />
    </Popover>
  );
}

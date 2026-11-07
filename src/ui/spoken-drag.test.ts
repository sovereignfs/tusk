import type { Active, Over } from '@dnd-kit/core';
import { describe, expect, it } from 'vitest';
import { type Spoken, spokenDrag } from './dnd';

/**
 * What a drag says aloud (task 7.7, DESIGN.md §17.8): a thing by its name and where it is, **never by its id**, which is what dnd-kit's own words read out.
 */
const ID = 'f0ed12b5-bad0-4169-ba8f-f969b0c467d4';
const OTHER = '9d8a7c66-2c1e-4a8e-8d52-5a0c2f4f9a11';
const things = new Map<string, Spoken>([
  [ID, { noun: 'list', name: 'Backlog', position: 1, total: 3 }],
  [OTHER, { noun: 'list', name: 'Done', position: 3, total: 3 }],
  ['card', { noun: 'card', name: 'Ship it', position: 2, total: 5, inside: 'Doing' }],
]);
const say = spokenDrag((id) => things.get(id));
const active = (id: string) => ({ id }) as unknown as Active;
const over = (id: string) => ({ id }) as unknown as Over;

describe('what a drag says', () => {
  it('names what it picked up and where it is, and how to move it', () => {
    const said = say.announcements.onDragStart?.({ active: active(ID) });
    expect(said).toContain('Picked up list Backlog, position 1 of 3');
    expect(said).toMatch(/arrow keys/);
    expect(said).toMatch(/Space/);
    expect(said).toMatch(/Escape/);
    expect(say.announcements.onDragStart?.({ active: active('card') })).toContain(
      'Picked up card Ship it, position 2 of 5 in Doing',
    );
  });

  it('says where it is over as it moves, and where it was dropped', () => {
    expect(say.announcements.onDragOver?.({ active: active(ID), over: over(OTHER) })).toBe(
      'Backlog is over position 3 of 3.',
    );
    expect(say.announcements.onDragEnd?.({ active: active(ID), over: over(OTHER) })).toBe(
      'Dropped list Backlog at position 3 of 3.',
    );
    // A card over a list (the empty part of one) is over that list.
    expect(say.announcements.onDragOver?.({ active: active('card'), over: over(ID) })).toBe(
      'Ship it is over list Backlog.',
    );
    expect(say.announcements.onDragEnd?.({ active: active(ID), over: null })).toBe(
      'Dropped list Backlog.',
    );
  });

  it('says the pick-up when the first thing it is over is itself, which is how the same render would replace it unheard', () => {
    expect(say.announcements.onDragOver?.({ active: active(ID), over: over(ID) })).toContain(
      'Picked up list Backlog, position 1 of 3',
    );
  });

  it('says what a cancel did', () => {
    expect(say.announcements.onDragCancel?.({ active: active(ID), over: null })).toBe(
      'Cancelled. Backlog stays where it was.',
    );
  });

  it('never says an id, for a thing it knows or one it does not', () => {
    const everything = [
      say.announcements.onDragStart?.({ active: active(ID) }),
      say.announcements.onDragOver?.({ active: active(ID), over: over(OTHER) }),
      say.announcements.onDragEnd?.({ active: active(ID), over: over(OTHER) }),
      say.announcements.onDragCancel?.({ active: active(ID), over: null }),
      say.announcements.onDragStart?.({ active: active('unknown-id-1234') }),
      say.announcements.onDragEnd?.({ active: active('unknown-id-1234'), over: over('x-9') }),
    ].join(' ');
    expect(everything).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(everything).not.toContain('unknown-id');
  });
});

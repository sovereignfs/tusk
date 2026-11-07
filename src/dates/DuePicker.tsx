'use client';

import { useState } from 'react';
import { formatDue } from '../format-due';
import { addDays, nowHere } from '../time';
import { Button, DatePicker, Icon, Input, Popover } from '../ui';
import styles from './DuePicker.module.css';

/**
 * The one picker for a due date and time (DESIGN.md §11), used on the Desk's cards and on boards' alike. Today, Tomorrow and Next week; the design
 * system's calendar for any other day; and a time, once there is a date. **A date and a time are floating** (written as on a calendar, in no zone), so
 * this never turns one into a `Date` that a zone could move: the calendar's local day is read as the year, month and day it shows. It says only what was
 * chosen, with the date and the time together, and what to do with it is the caller's (`actions/due.ts` on the Desk, `card.setDue` on a board).
 */
export interface DueValue {
  readonly date: string | null;
  readonly time: string | null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const toIso = (date: Date): string =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function DuePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: DueValue;
  onChange: (next: DueValue) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Today as the person's own clock has it, read when the picker is shown, so that a screen left open overnight is not a day behind.
  const now = nowHere();
  const today = now.date;
  const due = value.date ? formatDue(value.date, value.time, now) : null;
  const choose = (date: string | null) =>
    onChange({ date, time: date === null ? null : value.time });

  return (
    <Popover
      aria-label="Due date"
      open={open}
      onClose={() => setOpen(false)}
      align="left"
      width={300}
      trigger={
        <button
          type="button"
          className={`${styles.trigger} ${due?.overdue ? styles.overdue : ''}`}
          disabled={disabled}
          aria-expanded={open}
          // The name begins with what is drawn on the button (WCAG 2.5.3) and then says what it does.
          aria-label={due ? `${due.text}, change the due date` : 'No due date, set a due date'}
          onClick={() => setOpen((was) => !was)}
        >
          <Icon name="calendar" aria-hidden />
          <span>{due ? due.text : 'No due date'}</span>
        </button>
      }
    >
      <div className={styles.panel}>
        <div className={styles.quick}>
          <Button variant="secondary" size="sm" onClick={() => choose(today)}>
            Today
          </Button>
          <Button variant="secondary" size="sm" onClick={() => choose(addDays(today, 1))}>
            Tomorrow
          </Button>
          <Button variant="secondary" size="sm" onClick={() => choose(addDays(today, 7))}>
            Next week
          </Button>
        </div>
        <DatePicker
          aria-label="Pick a date"
          value={value.date ? toDate(value.date) : null}
          onChange={(date) => choose(toIso(date))}
          placeholder="Pick a date"
        />
        {value.date ? (
          <div className={styles.time}>
            <span>Time</span>
            <Input
              type="time"
              aria-label="Time"
              value={value.time ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '') onChange({ date: value.date, time: null });
                else if (TIME.test(next)) onChange({ date: value.date, time: next });
              }}
            />
          </div>
        ) : null}
        {value.date ? (
          <Button variant="secondary" size="sm" onClick={() => choose(null)}>
            Clear
          </Button>
        ) : null}
      </div>
    </Popover>
  );
}

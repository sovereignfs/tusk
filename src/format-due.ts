import { isOverdue } from './dates/overdue';
import { type LocalNow, addDays } from './time';

/**
 * How a due date is shown (DESIGN.md §11): "Today", "Tomorrow", "Mar 5", and the time in the locale's 12- or 24-hour form. Pure: today is given. A date is
 * floating, so it is formatted in UTC from its own year, month and day, and the browser's zone cannot move it. A date before today is overdue, and the
 * screen shows it in the danger colour.
 */
export interface DueText {
  /** "Today", "Tomorrow", "Mar 5" or "Mar 5, 2025", with the time after a comma when there is one. */
  readonly text: string;
  readonly overdue: boolean;
}

const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
};

/** `HH:MM` in the locale's own form: "9:00 AM" or "09:00". */
export function formatTime(time: string, locale?: string): string {
  const [h, m] = time.split(':').map(Number);
  // A 24-hour locale writes 09:05 and a 12-hour one 9:05 AM.
  const twentyFour = ['h23', 'h24'].includes(
    new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle ?? '',
  );
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: twentyFour ? '2-digit' : 'numeric',
    minute: '2-digit',
  }).format(new Date(Date.UTC(1970, 0, 1, h ?? 0, m ?? 0)));
}

/**
 * `now` is today's date, or the date and time both. With the time, a card due today at a time that has gone is overdue; with the date alone, a card is
 * overdue from the day after (it is due all day).
 */
export function formatDue(
  date: string,
  time: string | null,
  now: string | LocalNow,
  locale?: string,
): DueText {
  const today = typeof now === 'string' ? now : now.date;
  let day: string;
  if (date === today) day = 'Today';
  else if (date === addDays(today, 1)) day = 'Tomorrow';
  else {
    const [y, m, d] = parts(date);
    const sameYear = date.slice(0, 4) === today.slice(0, 4);
    day = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  return {
    text: time ? `${day}, ${formatTime(time, locale)}` : day,
    overdue: isOverdue(
      { date, time },
      typeof now === 'string' ? { date: now, time: '00:00' } : now,
    ),
  };
}

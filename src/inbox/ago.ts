/**
 * How long ago a notice was written, for the bell (DESIGN.md §16): "just now", "5m ago", "3h ago", "2d ago", and the date from a week on. **Pure, with the time given:** no
 * clock is read and no zone matters, since it is a length of time. A time in the future (a clock that is a little behind) is "just now".
 */
export function ago(createdAt: number, now: number, locale?: string): string {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(createdAt),
  );
}

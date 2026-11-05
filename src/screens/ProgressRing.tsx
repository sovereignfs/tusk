/**
 * How far through its subtasks a task is, as a small ring beside its title (DESIGN.md §11.2). It is a picture of two numbers that are also said in
 * words, for a screen reader, so that the ring is never the only way to know.
 */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const fraction = total === 0 ? 0 : Math.min(1, done / total);
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      role="img"
      aria-label={`${done} of ${total} subtasks done`}
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="var(--sv-color-border-strong)"
        strokeWidth="2"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="var(--sv-color-text-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

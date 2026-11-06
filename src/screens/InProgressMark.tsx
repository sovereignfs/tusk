/**
 * The mark of a card that is in progress (DESIGN.md §10.2): a small circle with a gap, turning slowly, beside its title. It says "someone started this"
 * and nothing louder: no column, no colour. It is Lucide's `loader-circle`, drawn here because `@sovereignfs/ui`'s icons do not include it yet (the icon
 * belongs there, and this goes when a release that has it is pinned). It is a picture with a name for a screen reader, and it holds still for anyone who
 * has asked for less motion.
 */
export function InProgressMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      role="img"
      aria-label="In progress"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Three icons the design system's curated set does not have (`IconName` in `@sovereignfs/ui`), drawn from [Lucide](https://lucide.dev) (ISC licence), which is
 * where the set comes from: `panel-left-close` and `panel-left-open` for the sidebar's button, and `folder-kanban`, the default icon of a workspace.
 * **Worth offering to `@sovereignfs/ui`** (as the shell's header is); until it has them they are here, drawn the way its `Icon` is (20px, a stroke in the
 * text's colour, hidden from a screen reader unless labelled).
 */
type Name = 'panel-left-close' | 'panel-left-open' | 'folder-kanban';

const PATHS: Record<Name, React.ReactNode> = {
  'panel-left-close': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </>
  ),
  'panel-left-open': (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </>
  ),
  'folder-kanban': (
    <>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M8 10v4" />
      <path d="M12 10v2" />
      <path d="M16 10v6" />
    </>
  ),
};

export function LucideIcon({ name, className }: { name: Name; className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

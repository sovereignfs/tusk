/**
 * How the app's sidebar is shown (DESIGN.md §17.2): **full**, a **rail** of icons, or **hidden**. It is a decision about this screen and not about the
 * person's data, so it is kept on the device and not with the account (§19), and it is kept **per kind of page**: the index pages (Boards, a workspace,
 * the Inbox) have room and open it full; the Desk and a board need the width and open it as a rail. A person's choice changes the default for that kind
 * of page, on this device, and nothing else.
 *
 * Pure: the page, and what was stored, go in and a state comes out, so that the rules are tested with no browser.
 */
export type SidebarState = 'full' | 'rail' | 'hidden';
export type PageKind = 'index' | 'canvas';

/**
 * The kind of page an address is: the Desk and a board are canvases, which need the width; everything else is an index. **`/` is the Desk** for someone
 * signed in, which is the only one who sees this: the proxy shows them the Desk at the front address, and the address stays `/` (DESIGN.md §17.11).
 */
export function pageKind(pathname: string): PageKind {
  const first = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
  return ['/', '/desk', '/b'].includes(first) ? 'canvas' : 'index';
}

export const DEFAULTS: Record<PageKind, SidebarState> = { index: 'full', canvas: 'rail' };

/** What is kept for a kind of page: how it is shown, and how it was shown last when it was not hidden, so that showing it again is what it was. */
export interface Remembered {
  state: SidebarState;
  shown: Exclude<SidebarState, 'hidden'>;
}
export type Stored = Partial<Record<PageKind, Remembered>>;

const STATES: readonly SidebarState[] = ['full', 'rail', 'hidden'];
const isState = (value: unknown): value is SidebarState =>
  typeof value === 'string' && (STATES as readonly string[]).includes(value);

/** What was stored, read defensively: anything that is not what was written is ignored, and the default stands. */
export function parseStored(raw: string | null | undefined): Stored {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: Stored = {};
  for (const kind of ['index', 'canvas'] as const) {
    const entry = (parsed as Record<string, unknown>)[kind];
    if (typeof entry !== 'object' || entry === null) continue;
    const { state, shown } = entry as Record<string, unknown>;
    if (!isState(state)) continue;
    out[kind] = {
      state,
      shown: shown === 'full' || shown === 'rail' ? shown : state === 'hidden' ? 'rail' : state,
    };
  }
  return out;
}

export const stateFor = (kind: PageKind, stored: Stored): SidebarState =>
  stored[kind]?.state ?? DEFAULTS[kind];

const current = (kind: PageKind, stored: Stored): Remembered => {
  const state = stateFor(kind, stored);
  return stored[kind] ?? { state, shown: state === 'hidden' ? 'rail' : state };
};

/** The header's button: hides the sidebar, or shows it again as it was. */
export function toggleHidden(kind: PageKind, stored: Stored): Stored {
  const have = current(kind, stored);
  return {
    ...stored,
    [kind]:
      have.state === 'hidden'
        ? { state: have.shown, shown: have.shown }
        : { state: 'hidden', shown: have.state },
  };
}

/** The sidebar's own button: a full sidebar becomes a rail and a rail becomes full. A hidden one has no such button. */
export function toggleRail(kind: PageKind, stored: Stored): Stored {
  const have = current(kind, stored);
  if (have.state === 'hidden') return stored;
  const next = have.state === 'full' ? 'rail' : 'full';
  return { ...stored, [kind]: { state: next, shown: next } };
}

export const STORAGE_KEY = 'tusk.sidebar';

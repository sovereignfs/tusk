/**
 * The six colours a list can be (DESIGN.md §10): the one splash of colour in a monochrome interface, which appears only as the small dot. Each is
 * a design-system token and never a colour of its own, so that dark mode and theming keep working. **This is the one definition**: the validator
 * for a list's `color` field (`src/sync/validate.ts`) and the screens read it from here.
 */
export const LIST_COLORS = ['black', 'grey', 'green', 'blue', 'amber', 'red'] as const;
export type ListColor = (typeof LIST_COLORS)[number];

/** The colour a new list is. */
export const DEFAULT_COLOR: ListColor = 'black';

const TOKENS: Record<ListColor, string> = {
  black: 'var(--sv-color-text-primary)',
  grey: 'var(--sv-color-text-subtle)',
  green: 'var(--sv-color-success-text)',
  blue: 'var(--sv-color-info-text)',
  amber: 'var(--sv-color-warning-text)',
  red: 'var(--sv-color-error-solid)',
};

export function isListColor(value: unknown): value is ListColor {
  return typeof value === 'string' && (LIST_COLORS as readonly string[]).includes(value);
}

/** The token for a colour, black for anything that is not one: a list of a colour this version does not know is still a list. */
export function colorToken(value: unknown): string {
  return isListColor(value) ? TOKENS[value] : TOKENS[DEFAULT_COLOR];
}

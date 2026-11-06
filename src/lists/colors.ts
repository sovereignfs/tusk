/**
 * The colour of a list (DESIGN.md §10.1, §17.7): **any colour**, written `#rrggbb`, shown as the small dot in front of its name. A person picks one with
 * `ColorPicker`, which offers these as suggestions and a free choice beside them. This is the one definition: the validator for a list's `color` field
 * (`src/sync/validate.ts`) and the screens read it from here.
 *
 * It is data a person chose and not a token of the design system, so it is drawn as a dot or a band and never as a page's background or as the colour of
 * text, which keeps light and dark mode readable whatever was picked.
 */
export const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** The suggestions `ColorPicker` offers, in order. A list may be any colour at all, not only these. */
export const SWATCHES: readonly { label: string; value: string }[] = [
  { label: 'Grey', value: '#6b7280' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Amber', value: '#d97706' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Teal', value: '#0d9488' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Pink', value: '#db2777' },
];

/** The colour a new list is: a neutral one. */
export const DEFAULT_COLOR = '#6b7280';

export function isListColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** The colour to draw, `#rrggbb` as it was written, or the neutral one for anything that is not a colour: a list of a colour this version cannot read is still a list. */
export function colorOf(value: unknown): string {
  return isListColor(value) ? value : DEFAULT_COLOR;
}

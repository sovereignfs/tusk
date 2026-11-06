import { DEFAULT_COLOR, colorOf } from '../lists/colors';
import type { LocalRow } from '../local/rows';

/**
 * Reading a row's fields for a screen. A plain field is its value; a field that is ciphertext is not readable here until the keys are (task 14.3), and
 * reads as nothing, so that a screen shows a placeholder and never the ciphertext.
 */
export function plain(
  row: LocalRow | undefined,
  name: string,
): string | number | boolean | null | undefined {
  const field = row?.fields[name];
  return field !== undefined && 'v' in field ? field.v : undefined;
}

/** A row's text field, or `fallback` when it is not there or not readable. */
export function text(row: LocalRow | undefined, name: string, fallback = ''): string {
  const value = plain(row, name);
  return typeof value === 'string' ? value : fallback;
}

/** The colour of a list's dot: `#rrggbb`, the one the person picked. */
export function colourOf(row: LocalRow | undefined): string {
  return colorOf(text(row, 'color', DEFAULT_COLOR));
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reduced motion is honoured (task 7.7, DESIGN.md §17.8): **a stylesheet of ours that animates, transitions or scrolls smoothly says what it does when a person
 * has asked for less motion.** The design system's own components follow the preference themselves; this is for what the app draws.
 */
const ROOT = path.resolve(__dirname, '..', '..');

function walk(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, folder))) {
    const relative = path.join(folder, name);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else if (name.endsWith('.css')) out.push(relative);
  }
  return out;
}

describe('motion in the app’s own stylesheets', () => {
  const sheets = [...walk('src'), ...walk('app')].map((file) => ({
    file,
    css: readFileSync(path.join(ROOT, file), 'utf8'),
  }));
  const moves = /(^|[;{\s])(animation|transition|scroll-behavior)\s*:\s*(?!none\b)/m;

  it('has some, so that this test is looking at something', () => {
    expect(sheets.some((sheet) => moves.test(sheet.css.replace(/\/\*[\s\S]*?\*\//g, '')))).toBe(
      true,
    );
  });

  it('is turned off for a person who asked for less, in every stylesheet that has it', () => {
    const unguarded = sheets
      .filter((sheet) => moves.test(sheet.css.replace(/\/\*[\s\S]*?\*\//g, '')))
      .filter((sheet) => !/prefers-reduced-motion\s*:\s*reduce/.test(sheet.css))
      .map((sheet) => sheet.file);
    expect(unguarded).toEqual([]);
  });
});

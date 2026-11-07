import { describe, expect, it } from 'vitest';
import { addressOf, queryOf } from './search-query';

/** What a search puts in an address, and what is read back (DESIGN.md §10.7): a fragment, which the browser never sends. */
describe('the search in the address', () => {
  it('is a fragment and never a query string, so that it is not sent to the server', () => {
    const address = addressOf('my secret plan');
    expect(address).toBe('/desk#q=my%20secret%20plan');
    expect(address).not.toContain('?');
    // What a request carries is the address without its fragment: nothing of the text.
    expect(address.split('#')[0]).toBe('/desk');
  });

  it('reads back what was written, whatever it is made of, and nothing for what is not a search', () => {
    for (const text of ['milk', 'É % [a-z]+ (.*) & = # ?', 'a/b\\c', '  spaced  ', '日本語'])
      expect(queryOf(addressOf(text).slice('/desk'.length))).toBe(text);
    expect(queryOf('')).toBe('');
    expect(queryOf('#card')).toBe('');
    expect(queryOf('#q=%E0%A4%A')).toBe('');
    expect(addressOf('   ')).toBe('/desk');
  });
});

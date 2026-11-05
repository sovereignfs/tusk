import { describe, expect, it } from 'vitest';
import manifest from '../sovereign.manifest.json';

// A runner that finds no tests passes silently, so there is always one that cannot: the manifest an instance reads names this app.
describe('the test runner', () => {
  it('runs, and the manifest names the app', () => {
    expect(manifest.prefix).toBe('tasks');
  });
});

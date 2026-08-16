import { describe, it, expect } from 'vitest';

/**
 * Toolchain canary. Proves vitest actually executes in this environment.
 * Keep this file permanently — if it ever stops running, the test runner
 * is misconfigured and every other green result is meaningless.
 */
describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('has native fetch available (providers depend on it)', () => {
    expect(typeof globalThis.fetch).toBe('function');
  });

  it('has AbortController available (cancellation depends on it)', () => {
    expect(typeof globalThis.AbortController).toBe('function');
  });
});

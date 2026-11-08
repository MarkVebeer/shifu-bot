import { describe, expect, test } from 'bun:test';
import { forwardedClientIp } from './middleware';

describe('forwardedClientIp', () => {
  test('ignores addresses the client made up', () => {
    expect(forwardedClientIp('1.1.1.1, 2.2.2.2, 203.0.113.7', 1)).toBe('203.0.113.7');
  });

  test('a new fake address on every request still gives the same client', () => {
    expect(forwardedClientIp('9.9.9.1, 203.0.113.7', 1)).toBe(forwardedClientIp('9.9.9.2, 203.0.113.7', 1));
  });

  test('counts from the right with several proxies', () => {
    expect(forwardedClientIp('1.1.1.1, 203.0.113.7, 198.51.100.2', 2)).toBe('203.0.113.7');
  });

  test('uses the leftmost entry when there are fewer entries than hops', () => {
    expect(forwardedClientIp('203.0.113.7', 3)).toBe('203.0.113.7');
  });

  test('copes with spaces, empty entries and no header', () => {
    expect(forwardedClientIp(' 203.0.113.7 ,', 1)).toBe('203.0.113.7');
    expect(forwardedClientIp('', 1)).toBeUndefined();
    expect(forwardedClientIp(undefined, 1)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { PICKS_BUCKET_MS, PICKS_TTL_MS, PicksCache, picksKey } from './picks-cache';

describe('picksKey', () => {
  it('depends on the absolute observation time, not on an offset', () => {
    const t = Date.UTC(2026, 9, 21, 14, 3);
    expect(picksKey(31.23, 121.47, new Date(t))).toBe(picksKey(31.23, 121.47, new Date(t + 60000)));
    expect(picksKey(31.23, 121.47, new Date(t))).not.toBe(picksKey(31.23, 121.47, new Date(t + PICKS_BUCKET_MS)));
    expect(picksKey(31.23, 121.47, new Date(t))).not.toBe(picksKey(39.9, 116.4, new Date(t)));
  });
});

describe('PicksCache', () => {
  it('allows a retry after the request is cancelled', () => {
    const cache = new PicksCache<string>();
    cache.begin('a');
    expect(cache.isPending('a')).toBe(true);
    cache.cancel(); // view closed and aborted the request
    expect(cache.isPending('a')).toBe(false);
    expect(cache.get('a')).toBeNull();
  });

  it('a late release from an old request does not clear a newer one', () => {
    const cache = new PicksCache<string>();
    const old = cache.begin('a');
    cache.cancel();
    cache.begin('a'); // reopened before the aborted request finished
    cache.release(old);
    expect(cache.isPending('a')).toBe(true);
  });

  it('allows a retry after a failure', () => {
    const cache = new PicksCache<string>();
    const token = cache.begin('a');
    cache.release(token);
    expect(cache.isPending('a')).toBe(false);
    expect(cache.get('a')).toBeNull();
  });

  it('reuses a success until it expires', () => {
    let now = 1_000_000;
    const cache = new PicksCache<string>(PICKS_TTL_MS, () => now);
    const token = cache.begin('a');
    cache.resolve(token, 'a', 'answer');
    expect(cache.isPending('a')).toBe(false);
    expect(cache.get('a')).toBe('answer');
    expect(cache.get('b')).toBeNull();
    now += PICKS_TTL_MS - 1;
    expect(cache.get('a')).toBe('answer');
    now += 1;
    expect(cache.get('a')).toBeNull();
  });
});

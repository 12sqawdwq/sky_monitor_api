/** Width of the observation-time bucket that shares one backend request. */
export const PICKS_BUCKET_MS = 10 * 60000;
/** How long a successful backend answer is reused. */
export const PICKS_TTL_MS = 10 * 60000;

/** Bucket start (UTC ms) for an observation time. */
export function picksBucket(date: Date): number {
  return Math.floor(date.getTime() / PICKS_BUCKET_MS) * PICKS_BUCKET_MS;
}

/** Request key: observer position plus the absolute observation-time bucket. */
export function picksKey(lat: number, lon: number, date: Date): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${picksBucket(date)}`;
}

/**
 * Tracks the request in flight separately from successful answers, so a cancelled or failed
 * request can be retried while a recent success is reused until it expires.
 */
export class PicksCache<T> {
  private pending: { key: string; token: number } | null = null;
  private stored: { key: string; at: number; value: T } | null = null;
  private nextToken = 0;

  constructor(private readonly ttlMs = PICKS_TTL_MS, private readonly now: () => number = Date.now) {}

  /** A fresh successful answer for `key`, if there is one. */
  get(key: string): T | null {
    const stored = this.stored;
    if (!stored || stored.key !== key || this.now() - stored.at >= this.ttlMs) return null;
    return stored.value;
  }

  /** True when a request for `key` is already in flight. */
  isPending(key: string): boolean {
    return this.pending?.key === key;
  }

  /** Mark a request for `key` as in flight; the token identifies it in `resolve` / `release`. */
  begin(key: string): number {
    this.nextToken += 1;
    this.pending = { key, token: this.nextToken };
    return this.nextToken;
  }

  /** Record a successful answer. */
  resolve(token: number, key: string, value: T): void {
    this.stored = { key, at: this.now(), value };
    this.release(token);
  }

  /** The request ended (answered, failed or cancelled). A later request is never affected. */
  release(token: number): void {
    if (this.pending?.token === token) this.pending = null;
  }

  /** Forget the request in flight, e.g. when the view closes and aborts it. */
  cancel(): void {
    this.pending = null;
  }
}

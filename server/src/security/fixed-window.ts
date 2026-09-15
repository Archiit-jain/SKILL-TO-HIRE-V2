import { createHmac, randomBytes } from "node:crypto";

/**
 * In-memory fixed-window counter (security remediation P1, D-8). Per instance, like the existing IP limiters (preview
 * decision D-1). Expired windows are swept at most once per window length, so old keys can't pile up.
 */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  private current(key: string, t: number) {
    const w = this.windows.get(key);
    if (!w) return undefined;
    if (t - w.start >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }

  private sweep(t: number) {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [key, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(key);
  }

  /** Seconds until the key's window ends when it has reached the limit; null when another event is allowed. */
  blockedFor(key: string): number | null {
    const t = this.now();
    const w = this.current(key, t);
    if (!w || w.count < this.limit) return null;
    return Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
  }

  record(key: string) {
    const t = this.now();
    this.sweep(t);
    const w = this.current(key, t);
    if (w) w.count++;
    else this.windows.set(key, { start: t, count: 1 });
  }

  /** Counts one event unless the key has reached the limit. Returns null when allowed, else the seconds to wait. */
  tryConsume(key: string): number | null {
    const blocked = this.blockedFor(key);
    if (blocked !== null) return blocked;
    this.record(key);
    return null;
  }

  /** Gives back one counted event (for attempts that ended for a reason other than the one being limited). */
  refund(key: string) {
    const w = this.current(key, this.now());
    if (w && w.count > 0) w.count--;
  }

  reset(key: string) {
    this.windows.delete(key);
  }

  get size() {
    return this.windows.size;
  }
}

/** Account keys are HMACs of the normalised email, so no plaintext email address is kept in memory. */
const KEY_SECRET = randomBytes(32);
export const emailKey = (email: string) => createHmac("sha256", KEY_SECRET).update(email.trim().toLowerCase()).digest("hex");

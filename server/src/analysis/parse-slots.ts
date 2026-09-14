import { config } from "../config.js";
import { HttpError } from "../http.js";

/**
 * Limits how many uploaded documents one server instance parses at the same time (security remediation P0, D-5).
 * The per-document caps bound one parse; this bounds how many of them can hold memory at once. Non-blocking: when
 * every slot is taken the request is refused straight away with 503 + Retry-After instead of queueing uploads.
 */
export class ParseSlots {
  private active = 0;

  constructor(readonly capacity: number = config.upload.maxConcurrentParses) {}

  get inUse() {
    return this.active;
  }

  tryAcquire(): boolean {
    if (this.active >= this.capacity) return false;
    this.active++;
    return true;
  }

  release() {
    if (this.active > 0) this.active--;
  }

  /** Runs `fn` inside a slot, or throws 503 server_busy if none is free. The slot is always released. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.tryAcquire()) throw serverBusy();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const SERVER_BUSY_MESSAGE = "The server is busy processing other documents. Please try again in a few seconds.";

export const serverBusy = () =>
  new HttpError(503, SERVER_BUSY_MESSAGE, "server_busy", { "Retry-After": String(config.upload.busyRetryAfterSeconds) });

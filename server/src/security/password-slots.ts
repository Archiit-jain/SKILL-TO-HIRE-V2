import { config } from "../config.js";
import { HttpError } from "../http.js";

export const PASSWORD_BUSY_MESSAGE = "The server is busy. Please try again in a few seconds.";

export const passwordBusy = () =>
  new HttpError(503, PASSWORD_BUSY_MESSAGE, "server_busy", { "Retry-After": String(config.security.passwordBusyRetryAfterSeconds) });

/**
 * Limits concurrent scrypt operations on one instance (security remediation P1, D-5). Each scrypt call uses ~134 MB
 * (128 * N * r), so a burst of logins could exhaust memory. Waiters are served in arrival order; a waiter that gets no
 * slot within `waitMs` is rejected with 503 server_busy.
 */
export class PasswordHashSlots {
  private active = 0;
  private readonly waiters: Array<{ grant: () => void }> = [];

  constructor(
    public capacity: number = config.security.maxConcurrentPasswordHashes,
    public waitMs: number = config.security.passwordHashWaitMs
  ) {}

  get inUse() {
    return this.active;
  }

  get waiting() {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.capacity) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(passwordBusy());
      }, this.waitMs);
      this.waiters.push(waiter);
    });
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next.grant(); // the slot passes straight to the next waiter, so `active` stays the same
    else if (this.active > 0) this.active--;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** The instance every password hash and verification goes through. */
export const passwordHashSlots = new PasswordHashSlots();

// P1 M-8: production (including the Vercel production deployment) refuses to start without JWT_SECRET.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MissingJwtSecretError, resolveJwtSecret } from "../src/config.js";

const SECRET = "a-configured-secret-that-is-at-least-32-chars";

describe("M-8 JWT_SECRET requirement", () => {
  it("refuses the Vercel production deployment without JWT_SECRET", () => {
    assert.throws(() => resolveJwtSecret({ nodeEnv: "production", onVercel: true, vercelEnv: "production" }), MissingJwtSecretError);
    assert.throws(() => resolveJwtSecret({ nodeEnv: "development", onVercel: true, vercelEnv: "production" }), /Vercel production/);
  });

  it("refuses NODE_ENV=production outside Vercel without JWT_SECRET (unchanged)", () => {
    assert.throws(() => resolveJwtSecret({ nodeEnv: "production", onVercel: false }), /required in production/);
  });

  it("uses the configured secret whenever it is set", () => {
    for (const ctx of [
      { nodeEnv: "production" as const, onVercel: true, vercelEnv: "production" },
      { nodeEnv: "production" as const, onVercel: false },
      { nodeEnv: "development" as const, onVercel: true, vercelEnv: "preview" },
    ]) {
      assert.equal(resolveJwtSecret({ ...ctx, jwtSecret: SECRET }), SECRET);
    }
  });

  it("keeps preview deployments and tests working with a random per-instance secret", () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const preview = resolveJwtSecret({ nodeEnv: "production", onVercel: true, vercelEnv: "preview" });
      assert.match(preview, /^[0-9a-f]{96}$/);
    } finally {
      console.warn = originalWarn;
    }
    const a = resolveJwtSecret({ nodeEnv: "test", onVercel: false });
    const b = resolveJwtSecret({ nodeEnv: "test", onVercel: false });
    assert.match(a, /^[0-9a-f]{96}$/);
    assert.notEqual(a, b);
  });
});

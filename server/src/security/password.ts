import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { passwordHashSlots } from "./password-slots.js";

// scrypt parameters (OWASP-listed minimum: N=2^17, r=8, p=1). Stored with the hash so they can be raised later.
const N = 2 ** 17;
const r = 8;
const p = 1;
const KEYLEN = 64;
const maxmem = 256 * 1024 * 1024;

/** Every scrypt operation (hashing and verification, including the dummy hash) runs inside a password-hash slot (D-5). */
function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return passwordHashSlots.run(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
      )
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** True when `stored` is a scrypt hash this module can verify (Google-only accounts store the "!" marker instead). */
export const isPasswordHash = (stored: string) => stored.startsWith("scrypt$") && stored.split("$").length === 6;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, rr, pp, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
    maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real hash of a random password, used to equalise timing when the email does not exist. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  // A failed creation (e.g. 503 server_busy) is not cached: the next login tries again.
  dummyHash ??= hashPassword(randomBytes(16).toString("hex")).catch((err) => {
    dummyHash = null;
    throw err;
  });
  return dummyHash;
}

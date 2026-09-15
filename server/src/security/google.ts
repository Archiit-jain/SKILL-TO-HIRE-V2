import { OAuth2Client } from "google-auth-library";
import { config } from "../config.js";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Verifies a Google Identity Services ID token and returns the identity, or null if invalid. */
export type GoogleVerifier = (credential: string) => Promise<GoogleIdentity | null>;

let client: OAuth2Client | null = null;

export const defaultGoogleVerifier: GoogleVerifier = async (credential) => {
  if (!config.googleClientId) return null;
  client ??= new OAuth2Client(config.googleClientId);
  try {
    // Checks signature (Google's rotating public keys), expiry, issuer, and that the token was issued for OUR client ID.
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.googleClientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) return null;
    return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: p.email_verified === true, name: p.name };
  } catch (err) {
    // P2 log hardening: the error class only; library messages can include token details.
    console.warn(`[google] ID token rejected: ${(err as Error)?.name ?? "error"}`);
    return null;
  }
};

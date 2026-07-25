import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** Marks a string as one of ours in logs, and lets secret scanners spot it. */
export const API_KEY_PREFIX = "to_live_";

/** Characters after the prefix kept in the clear, e.g. "to_live_a1b2c3". */
const VISIBLE_CHARS = 6;

/**
 * SHA-256 rather than a password KDF: the token is 256 bits of randomness we
 * generated, so there is no low-entropy secret to slow an attacker down on.
 * A fast hash also keeps per-request key lookup cheap.
 */
export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mints a token. The plaintext is returned to the caller exactly once — only
 * the hash and the display prefix are ever persisted.
 */
export function generateApiKey(): {
  token: string;
  hashedKey: string;
  prefix: string;
} {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hashedKey: hashApiKey(token),
    prefix: token.slice(0, API_KEY_PREFIX.length + VISIBLE_CHARS),
  };
}

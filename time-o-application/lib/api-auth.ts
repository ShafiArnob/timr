import "server-only";

import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-keys";
import { apiError } from "@/lib/api-response";

export type AuthenticatedKey = { userId: string; keyId: string };

export type ApiAuthResult =
  | { ok: true; auth: AuthenticatedKey }
  | { ok: false; response: Response };

/**
 * A device polling every few seconds shouldn't cost a write per request, so
 * the timestamp is only refreshed once it's this stale.
 */
const LAST_USED_REFRESH_MS = 60_000;

/**
 * Accepts `Authorization: Bearer <key>`, and `X-API-Key` for clients whose HTTP
 * stack makes the Authorization header awkward to set.
 */
function readToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const [scheme, ...rest] = header.trim().split(/\s+/);
    if (scheme.toLowerCase() === "bearer" && rest.length === 1) {
      return rest[0];
    }
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

/**
 * Resolves an API key to the account that owns it.
 *
 * The lookup is by hash, so a stolen database still can't be replayed against
 * the API. Every failure answers with the same message: telling a caller
 * whether a key exists, expired, or was revoked only helps someone probing.
 */
export async function authenticateRequest(
  request: Request,
): Promise<ApiAuthResult> {
  const token = readToken(request);
  if (!token) {
    return {
      ok: false,
      response: apiError(
        "unauthorized",
        "Missing API key. Send it as 'Authorization: Bearer <key>'.",
      ),
    };
  }

  const rejected = {
    ok: false as const,
    response: apiError("unauthorized", "That API key is not valid."),
  };

  try {
    const key = await prisma.apiKey.findUnique({
      where: { hashedKey: hashApiKey(token) },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    if (!key || key.revokedAt !== null) return rejected;
    if (key.expiresAt !== null && key.expiresAt.getTime() <= Date.now()) {
      return rejected;
    }

    const now = new Date();
    if (
      key.lastUsedAt === null ||
      now.getTime() - key.lastUsedAt.getTime() > LAST_USED_REFRESH_MS
    ) {
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: now },
      });
    }

    return { ok: true, auth: { userId: key.userId, keyId: key.id } };
  } catch (error) {
    console.error("Failed to authenticate API key:", error);
    return {
      ok: false,
      response: apiError(
        "server_error",
        "Something went wrong. Please try again.",
      ),
    };
  }
}

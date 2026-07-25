"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
import { generateApiKey } from "@/lib/api-keys";

/**
 * A freshly minted token travels back to the browser once, so it can be shown
 * and copied. It is never retrievable again after this response.
 */
export type ApiKeyTokenResult =
  | { status: "success"; token: string; name: string }
  | { status: "error"; message: string };

export type ApiKeyResult =
  | { status: "success" }
  | { status: "error"; message: string };

const MAX_NAME_LENGTH = 60;

/** Expiry choices offered on the create form, in days. Null never expires. */
const EXPIRY_DAYS: Record<string, number | null> = {
  never: null,
  "30": 30,
  "90": 90,
  "365": 365,
};

function expiryFromChoice(choice: string): Date | null | undefined {
  if (!(choice in EXPIRY_DAYS)) return undefined;
  const days = EXPIRY_DAYS[choice];
  return days === null ? null : new Date(Date.now() + days * 86_400_000);
}

export async function createApiKey(
  formData: FormData,
): Promise<ApiKeyTokenResult> {
  const { userId } = await verifySession();

  const name = String(formData.get("name") ?? "").trim();
  const expiryChoice = String(formData.get("expiry") ?? "never");

  if (!name) {
    return { status: "error", message: "Please name the key." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      status: "error",
      message: `Keep the name under ${MAX_NAME_LENGTH} characters.`,
    };
  }

  const expiresAt = expiryFromChoice(expiryChoice);
  if (expiresAt === undefined) {
    return { status: "error", message: "Please choose a valid expiry." };
  }

  const { token, hashedKey, prefix } = generateApiKey();

  try {
    await prisma.apiKey.create({
      data: { name, hashedKey, prefix, expiresAt, userId },
    });
  } catch (error) {
    console.error("Failed to create API key:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath("/api");
  return { status: "success", token, name };
}

/**
 * Issues a new secret for an existing key, keeping its name and expiry. The
 * previous token stops working the moment this succeeds.
 */
export async function regenerateApiKey(
  keyId: string,
): Promise<ApiKeyTokenResult> {
  const { userId } = await verifySession();

  if (typeof keyId !== "string" || !keyId) {
    return { status: "error", message: "That key could not be found." };
  }

  const { token, hashedKey, prefix } = generateApiKey();

  try {
    // updateMany keeps the ownership check on the write itself, so a guessed
    // id belonging to another account rotates nothing.
    const result = await prisma.apiKey.updateMany({
      where: { id: keyId, userId },
      // A rotated key starts fresh: the old "last used" describes a secret
      // that no longer exists, and rotating un-revokes.
      data: { hashedKey, prefix, lastUsedAt: null, revokedAt: null },
    });
    if (result.count === 0) {
      return { status: "error", message: "That key no longer exists." };
    }
  } catch (error) {
    console.error("Failed to regenerate API key:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
    select: { name: true },
  });

  revalidatePath("/api");
  return { status: "success", token, name: key?.name ?? "API key" };
}

export async function deleteApiKey(keyId: string): Promise<ApiKeyResult> {
  const { userId } = await verifySession();

  if (typeof keyId !== "string" || !keyId) {
    return { status: "error", message: "That key could not be found." };
  }

  try {
    const result = await prisma.apiKey.deleteMany({
      where: { id: keyId, userId },
    });
    if (result.count === 0) {
      return { status: "error", message: "That key no longer exists." };
    }
  } catch (error) {
    console.error("Failed to delete API key:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath("/api");
  return { status: "success" };
}

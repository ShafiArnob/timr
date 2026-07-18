import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * Verifies the session cookie and returns the authenticated user id.
 * Redirects to the login page when there is no valid session.
 */
export const verifySession = cache(async () => {
  const cookie = (await cookies()).get("session")?.value;
  const session = await decrypt(cookie);

  if (!session?.userId) {
    redirect("/login");
  }

  return { isAuth: true as const, userId: session.userId };
});

/**
 * Returns the current user's safe fields, or null if unavailable.
 */
export const getUser = cache(async () => {
  const session = await verifySession();

  try {
    return await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true },
    });
  } catch (error) {
    console.error("Failed to fetch user:", error);
    return null;
  }
});

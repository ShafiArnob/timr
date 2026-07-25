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
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        timezone: true,
      },
    });
  } catch (error) {
    console.error("Failed to fetch user:", error);
    return null;
  }
});

/**
 * Returns the user's active (in progress or paused) session, or null.
 */
export const getActiveTimeTracker = cache(async () => {
  const session = await verifySession();

  try {
    return await prisma.timeTracker.findFirst({
      where: {
        userId: session.userId,
        status: { in: ["IN_PROGRESS", "PAUSED"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        taskId: true,
        status: true,
        minutesSpent: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    console.error("Failed to fetch active time tracker:", error);
    return null;
  }
});

/**
 * Returns the current user's time tracking sessions, newest first.
 */
export const getTimeTrackers = cache(async () => {
  const session = await verifySession();

  try {
    return await prisma.timeTracker.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        minutesSpent: true,
        task: { select: { id: true, label: true, color: true } },
      },
    });
  } catch (error) {
    console.error("Failed to fetch time trackers:", error);
    return [];
  }
});

/**
 * Returns the current user's tasks in their manual order.
 * `createdAt` only breaks ties between equal positions.
 */
export const getTasks = cache(async () => {
  const session = await verifySession();

  try {
    return await prisma.task.findMany({
      where: { userId: session.userId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, value: true, label: true, color: true },
    });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return [];
  }
});

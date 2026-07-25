"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";

export type LogSessionResult =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/** A typo in the year turns into a decade-long session, so cap the span. */
const MAX_SESSION_HOURS = 24;
/** Tolerance for a clock that runs slightly ahead of the server's. */
const FUTURE_SKEW_MS = 60_000;

/**
 * Records work that happened away from the timer. The client sends absolute
 * ISO timestamps (it converts the local date/time inputs), so the session
 * lands at the same instant regardless of where the server runs.
 */
export async function logManualSession(
  formData: FormData,
): Promise<LogSessionResult> {
  const { userId } = await verifySession();

  const taskId = String(formData.get("taskId") ?? "");
  const startRaw = String(formData.get("startTime") ?? "");
  const endRaw = String(formData.get("endTime") ?? "");

  if (!taskId) {
    return { status: "error", message: "Please choose a task." };
  }

  const startTime = new Date(startRaw);
  const endTime = new Date(endRaw);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { status: "error", message: "Please enter a start and end time." };
  }

  const spanMs = endTime.getTime() - startTime.getTime();
  if (spanMs <= 0) {
    return { status: "error", message: "The end time must be after the start." };
  }
  if (spanMs > MAX_SESSION_HOURS * 60 * 60 * 1000) {
    return {
      status: "error",
      message: `A single session can't be longer than ${MAX_SESSION_HOURS} hours. Split it into two entries.`,
    };
  }
  if (endTime.getTime() > Date.now() + FUTURE_SKEW_MS) {
    return { status: "error", message: "You can't log work in the future." };
  }

  try {
    // Only allow logging against one of the user's own tasks.
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!task) {
      return { status: "error", message: "That task could not be found." };
    }

    // Already finished, so it never collides with the one-active-timer rule.
    await prisma.timeTracker.create({
      data: {
        userId,
        taskId,
        startTime,
        endTime,
        minutesSpent: Math.round(spanMs / 60_000),
        status: "COMPLETED",
      },
    });
  } catch (error) {
    console.error("Failed to log manual session:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath("/dashboard");
  return { status: "success", message: "Session logged." };
}

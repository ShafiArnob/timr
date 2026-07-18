"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";

export type StartTimerResult =
  | { status: "success"; trackerId: string }
  | { status: "error"; message: string };

export type TimerActionResult =
  | { status: "success" }
  | { status: "error"; message: string };

/**
 * Converts the client-reported active seconds into whole minutes for storage.
 */
function toMinutes(elapsedSeconds: number): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return 0;
  return Math.round(elapsedSeconds / 60);
}

export async function startTimer(taskId: string): Promise<StartTimerResult> {
  const { userId } = await verifySession();

  if (!taskId) {
    return { status: "error", message: "Please select a task first." };
  }

  try {
    // One active session at a time: refuse to start while another timer is
    // still in progress or paused.
    const active = await prisma.timeTracker.findFirst({
      where: { userId, status: { in: ["IN_PROGRESS", "PAUSED"] } },
      select: { id: true },
    });
    if (active) {
      return {
        status: "error",
        message: "Another timer is already active. Stop it before starting a new one.",
      };
    }

    // Only allow starting a timer against one of the user's own tasks.
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!task) {
      return { status: "error", message: "That task could not be found." };
    }

    const tracker = await prisma.timeTracker.create({
      data: {
        userId,
        taskId,
        startTime: new Date(),
        status: "IN_PROGRESS",
      },
      select: { id: true },
    });

    // The dashboard lists sessions and the timer page restores the active
    // one, so keep both fresh after every transition.
    revalidatePath("/dashboard");
    revalidatePath("/timer");
    return { status: "success", trackerId: tracker.id };
  } catch (error) {
    console.error("Failed to start timer:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

export async function pauseTimer(
  trackerId: string,
  elapsedSeconds: number,
): Promise<TimerActionResult> {
  const { userId } = await verifySession();

  try {
    // Scope by userId so only the owner can pause, and require IN_PROGRESS so
    // stale requests can't overwrite a completed session.
    const result = await prisma.timeTracker.updateMany({
      where: { id: trackerId, userId, status: "IN_PROGRESS" },
      data: { status: "PAUSED", minutesSpent: toMinutes(elapsedSeconds) },
    });
    if (result.count === 0) {
      return { status: "error", message: "That timer is not running." };
    }
    revalidatePath("/dashboard");
    revalidatePath("/timer");
    return { status: "success" };
  } catch (error) {
    console.error("Failed to pause timer:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

export async function resumeTimer(trackerId: string): Promise<TimerActionResult> {
  const { userId } = await verifySession();

  try {
    const result = await prisma.timeTracker.updateMany({
      where: { id: trackerId, userId, status: "PAUSED" },
      data: { status: "IN_PROGRESS" },
    });
    if (result.count === 0) {
      return { status: "error", message: "That timer is not paused." };
    }
    revalidatePath("/dashboard");
    revalidatePath("/timer");
    return { status: "success" };
  } catch (error) {
    console.error("Failed to resume timer:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

export async function stopTimer(
  trackerId: string,
  elapsedSeconds: number,
): Promise<TimerActionResult> {
  const { userId } = await verifySession();

  try {
    const result = await prisma.timeTracker.updateMany({
      where: {
        id: trackerId,
        userId,
        status: { in: ["IN_PROGRESS", "PAUSED"] },
      },
      data: {
        status: "COMPLETED",
        endTime: new Date(),
        minutesSpent: toMinutes(elapsedSeconds),
      },
    });
    if (result.count === 0) {
      return { status: "error", message: "That timer is already finished." };
    }
    revalidatePath("/dashboard");
    revalidatePath("/timer");
    return { status: "success" };
  } catch (error) {
    console.error("Failed to stop timer:", error);
    return { status: "error", message: "Something went wrong. Please try again." };
  }
}

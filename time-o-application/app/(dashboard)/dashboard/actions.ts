"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";
// The same window rules the public API enforces, so a session edited here
// can't end up in a shape the API would have refused to create.
import { resolveTimeWindow } from "@/lib/time-entries";

export type DeleteSessionResult =
  | { status: "success" }
  | { status: "error"; message: string };

export type UpdateSessionResult =
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/**
 * Permanently removes one tracked session. Active sessions can be deleted too:
 * that is how you throw away a timer started against the wrong task.
 */
export async function deleteTimeTracker(
  trackerId: string,
): Promise<DeleteSessionResult> {
  const { userId } = await verifySession();

  if (typeof trackerId !== "string" || !trackerId) {
    return { status: "error", message: "That session could not be found." };
  }

  try {
    // deleteMany keeps the ownership check on the write itself, so a guessed
    // id belonging to another account deletes nothing.
    const result = await prisma.timeTracker.deleteMany({
      where: { id: trackerId, userId },
    });
    if (result.count === 0) {
      return { status: "error", message: "That session no longer exists." };
    }
  } catch (error) {
    console.error("Failed to delete time tracker:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  // Deleting the active session also frees the timer page to start a new one.
  revalidatePath("/dashboard");
  revalidatePath("/timer");
  return { status: "success" };
}

/** A blank or unparseable value is null rather than an Invalid Date. */
function parseInstant(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Corrects an already-recorded session: the task it was filed under and, once
 * it has finished, the window it covers. The client sends absolute ISO
 * timestamps, so the instants survive whatever time zone the server runs in.
 */
export async function updateTimeTracker(
  formData: FormData,
): Promise<UpdateSessionResult> {
  const { userId } = await verifySession();

  const trackerId = String(formData.get("trackerId") ?? "");
  const taskId = String(formData.get("taskId") ?? "");

  if (!trackerId) {
    return { status: "error", message: "That session could not be found." };
  }
  if (!taskId) {
    return { status: "error", message: "Please choose a task." };
  }

  try {
    // Scoped by userId, so a guessed id belonging to another account reads as
    // missing rather than editable.
    const existing = await prisma.timeTracker.findFirst({
      where: { id: trackerId, userId },
      select: { status: true },
    });
    if (!existing) {
      return { status: "error", message: "That session no longer exists." };
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!task) {
      return { status: "error", message: "That task could not be found." };
    }

    // A running or paused session's window still belongs to the timer — its
    // end is open and minutesSpent is whatever the timer last reported.
    // Retiming it here would either fight the timer or quietly complete it, so
    // only the task moves until it is stopped.
    if (existing.status !== "COMPLETED") {
      await prisma.timeTracker.updateMany({
        where: { id: trackerId, userId },
        data: { taskId },
      });
      revalidatePath("/dashboard");
      revalidatePath("/timer");
      return { status: "success", message: "Session updated." };
    }

    const startTime = parseInstant(String(formData.get("startTime") ?? ""));
    const endTime = parseInstant(String(formData.get("endTime") ?? ""));
    if (!startTime || !endTime) {
      return { status: "error", message: "Please enter a start and end time." };
    }

    const resolved = resolveTimeWindow({ startTime, endTime });
    if (!resolved.ok) {
      return { status: "error", message: resolved.message };
    }

    // Requiring COMPLETED on the write itself closes the gap between the read
    // above and here: a session restarted meanwhile keeps the timer's window.
    const result = await prisma.timeTracker.updateMany({
      where: { id: trackerId, userId, status: "COMPLETED" },
      data: {
        taskId,
        startTime: resolved.window.startTime,
        endTime: resolved.window.endTime,
        minutesSpent: resolved.window.minutesSpent,
      },
    });
    if (result.count === 0) {
      return {
        status: "error",
        message: "That session changed while you were editing it. Close this and try again.",
      };
    }
  } catch (error) {
    console.error("Failed to update time tracker:", error);
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/timer");
  return { status: "success", message: "Session updated." };
}

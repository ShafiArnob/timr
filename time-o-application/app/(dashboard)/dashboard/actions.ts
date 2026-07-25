"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/dal";

export type DeleteSessionResult =
  | { status: "success" }
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

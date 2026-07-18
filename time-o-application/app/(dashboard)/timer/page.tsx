import { getActiveTimeTracker, getTasks } from "@/lib/dal";
import { Timer, type ActiveSession } from "./timer";

export default async function Page() {
  const [tasks, active] = await Promise.all([
    getTasks(),
    getActiveTimeTracker(),
  ]);

  // The row is only touched on start, pause, and resume, so for an
  // IN_PROGRESS session `updatedAt` marks the start of the current running
  // segment and `minutesSpent` holds the time banked before it.
  const initialSession: ActiveSession | null = active
    ? {
        trackerId: active.id,
        taskId: active.taskId,
        status: active.status === "PAUSED" ? "paused" : "running",
        bankedSeconds: active.minutesSpent * 60,
        runningSince:
          active.status === "IN_PROGRESS" ? active.updatedAt.getTime() : null,
      }
    : null;

  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center px-4 lg:px-6">
      <Timer tasks={tasks} initialSession={initialSession} />
    </div>
  );
}

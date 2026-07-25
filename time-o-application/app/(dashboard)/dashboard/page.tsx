import { ChartTaskTime, type TaskTimePoint } from "@/components/chart-task-time";
import { DataTable, type TimeTrackerRow } from "@/components/data-table";
import { getTimeTrackers, getUser } from "@/lib/dal";

export default async function Page() {
  const [user, trackers] = await Promise.all([getUser(), getTimeTrackers()]);

  // Dates are serialized to ISO strings so the client component receives
  // plain, deterministic values.
  const rows: TimeTrackerRow[] = trackers.map((tracker) => ({
    id: tracker.id,
    task: tracker.task.label,
    taskColor: tracker.task.color,
    status: tracker.status,
    startTime: tracker.startTime?.toISOString() ?? null,
    endTime: tracker.endTime?.toISOString() ?? null,
    minutesSpent: tracker.minutesSpent,
  }));

  // A session with no start time can't be placed on a week or month, so it
  // only shows in the table below.
  const chartPoints: TaskTimePoint[] = trackers
    .filter((tracker) => tracker.startTime !== null)
    .map((tracker) => ({
      taskId: tracker.task.id,
      task: tracker.task.label,
      color: tracker.task.color,
      minutesSpent: tracker.minutesSpent,
      date: tracker.startTime!.toISOString(),
    }));

  return (
    <>
      <div className="px-4 lg:px-6">
        <ChartTaskTime data={chartPoints} />
      </div>
      <DataTable data={rows} timezone={user?.timezone ?? null} />
    </>
  );
}

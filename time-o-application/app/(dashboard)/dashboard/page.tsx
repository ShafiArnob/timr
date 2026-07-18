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

  return (
    <>
      {/* <SectionCards /> */}
      <div className="px-4 lg:px-6">{/* <ChartAreaInteractive /> */}</div>
      <DataTable data={rows} timezone={user?.timezone ?? null} />
    </>
  );
}

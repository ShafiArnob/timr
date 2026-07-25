import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getTasks, getUser } from "@/lib/dal";
import { TaskForm } from "./task-form";
import { TaskList } from "./task-list";
import { TimezoneForm } from "./timezone-form";

export default async function Page() {
  const [user, tasks] = await Promise.all([getUser(), getTasks()]);

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Update your profile, notifications, and app preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Time zone</h3>
            <p className="text-sm text-muted-foreground">
              Choose your country to set the time zone used across the app.
            </p>
          </div>
          <TimezoneForm
            initialCountry={user?.country ?? null}
            initialTimezone={user?.timezone ?? null}
          />

          <Separator />

          <div className="space-y-1">
            <h3 className="text-sm font-medium">Tasks</h3>
            <p className="text-sm text-muted-foreground">
              Create tasks to track your time against. Pick a label and a
              color — the value is derived from the label. Drag the handle to
              reorder; the order is saved and used everywhere tasks are listed.
            </p>
          </div>
          <TaskForm />

          <TaskList tasks={tasks} />
        </CardContent>
      </Card>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getTasks, getUser } from "@/lib/dal";
import { deleteTask } from "./actions";
import { TaskForm } from "./task-form";
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
              color — the value is derived from the label.
            </p>
          </div>
          <TaskForm />

          {tasks.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <span
                    className="size-4 shrink-0 rounded-full border"
                    style={{ backgroundColor: task.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {task.value}
                    </p>
                  </div>
                  <form action={deleteTask}>
                    <input type="hidden" name="id" value={task.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                    >
                      Delete
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

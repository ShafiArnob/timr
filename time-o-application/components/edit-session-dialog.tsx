"use client";

import * as React from "react";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { updateTimeTracker } from "@/app/(dashboard)/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDuration,
  isoToLocalInputValue,
  parseLocal,
} from "@/lib/local-time";

export type EditSessionTask = { id: string; label: string; color: string };

/**
 * Structurally compatible with the table's row type. Declared here rather than
 * imported so the dialog and the table don't import each other.
 */
export type EditSessionSession = {
  id: string;
  taskId: string;
  task: string;
  status: "IN_PROGRESS" | "PAUSED" | "COMPLETED";
  startTime: string | null;
  endTime: string | null;
};

export function EditSessionDialog({
  session,
  tasks,
}: {
  session: EditSessionSession;
  tasks: EditSessionTask[];
}) {
  const [open, setOpen] = React.useState(false);
  const [taskId, setTaskId] = React.useState(session.taskId);
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // A running or paused session has no end yet and its minutes are still being
  // counted by the timer, so only the task is editable until it is stopped.
  const isActive = session.status !== "COMPLETED";

  const startDate = parseLocal(start);
  const endDate = parseLocal(end);
  const minutes =
    startDate && endDate
      ? Math.round((endDate.getTime() - startDate.getTime()) / 60_000)
      : null;
  const canSave =
    Boolean(taskId) && !pending && (isActive || (minutes !== null && minutes > 0));

  function handleOpenChange(next: boolean) {
    // Don't let a click-away discard a submit that is already in flight.
    if (pending) return;
    setError(null);
    if (next) {
      // Seeded on open rather than during render: converting a UTC instant to
      // a local input value while rendering would make the server and client
      // markup disagree.
      setTaskId(session.taskId);
      setStart(isoToLocalInputValue(session.startTime));
      setEnd(isoToLocalInputValue(session.endTime));
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateTimeTracker(formData);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      toast.success(result.message);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <PencilIcon />
        <span className="sr-only">Edit session</span>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit session</DialogTitle>
          <DialogDescription>
            {isActive
              ? "This session is still running, so only the task can be changed."
              : "Change the task or the window this session covers. The duration is recalculated from the times."}
          </DialogDescription>
        </DialogHeader>

        <form id={`edit-session-${session.id}`} onSubmit={handleSubmit} className="grid gap-4">
          {/* The select and datetime inputs are controlled, so the values the
              action reads are mirrored into hidden fields. Times are sent as
              absolute instants so the server never has to guess a time zone. */}
          <input type="hidden" name="trackerId" value={session.id} />
          <input type="hidden" name="taskId" value={taskId} />
          <input
            type="hidden"
            name="startTime"
            value={startDate ? startDate.toISOString() : ""}
          />
          <input
            type="hidden"
            name="endTime"
            value={endDate ? endDate.toISOString() : ""}
          />

          <div className="grid gap-2">
            <Label htmlFor={`edit-session-task-${session.id}`}>Task</Label>
            <Select
              value={taskId}
              onValueChange={(value) => setTaskId(String(value))}
              items={tasks.map((task) => ({
                label: task.label,
                value: task.id,
              }))}
            >
              <SelectTrigger
                id={`edit-session-task-${session.id}`}
                className="w-full"
              >
                <SelectValue placeholder="Choose a task" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      <span
                        className="size-3 shrink-0 rounded-full border"
                        style={{ backgroundColor: task.color }}
                        aria-hidden
                      />
                      {task.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {isActive ? (
            <p className="text-sm text-muted-foreground">
              The timer owns this session&apos;s start and end times. Stop it on
              the Timer page to edit them.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor={`edit-session-start-${session.id}`}>Started</Label>
                <Input
                  id={`edit-session-start-${session.id}`}
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`edit-session-end-${session.id}`}>Ended</Label>
                <Input
                  id={`edit-session-end-${session.id}`}
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>

              <p className="text-sm text-muted-foreground" aria-live="polite">
                {minutes === null
                  ? "Pick a start and end time."
                  : minutes > 0
                    ? `Duration: ${formatDuration(minutes)}`
                    : "The end time must be after the start."}
              </p>
            </>
          )}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            form={`edit-session-${session.id}`}
            disabled={!canSave}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

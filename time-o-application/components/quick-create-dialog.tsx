"use client";

import * as React from "react";
import Link from "next/link";
import { CirclePlusIcon } from "lucide-react";
import { toast } from "sonner";

import { logManualSession } from "@/app/(dashboard)/actions";
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
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { formatDuration, parseLocal, toLocalInputValue } from "@/lib/local-time";

export type QuickCreateTask = { id: string; label: string; color: string };

/** Most logged work just ended, so open on "the last hour" and let it be edited. */
function defaultRange(): { start: string; end: string } {
  const end = new Date();
  end.setSeconds(0, 0);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return { start: toLocalInputValue(start), end: toLocalInputValue(end) };
}

export function QuickCreateDialog({ tasks }: { tasks: QuickCreateTask[] }) {
  const [open, setOpen] = React.useState(false);
  const [taskId, setTaskId] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const startDate = parseLocal(start);
  const endDate = parseLocal(end);
  const minutes =
    startDate && endDate
      ? Math.round((endDate.getTime() - startDate.getTime()) / 60_000)
      : null;
  const canSave = Boolean(taskId) && minutes !== null && minutes > 0 && !pending;

  function handleOpenChange(next: boolean) {
    // Don't let a click-away discard a submit that is already in flight.
    if (pending) return;
    setError(null);
    if (next) {
      // Seeded here rather than during render: reading the clock while
      // rendering would make the server and client markup disagree.
      const range = defaultRange();
      setStart(range.start);
      setEnd(range.end);
      setTaskId("");
    }
    setOpen(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await logManualSession(formData);
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
      <SidebarMenuButton
        tooltip="Quick Create"
        className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
        render={<DialogTrigger />}
      >
        <CirclePlusIcon />
        <span>Quick Create</span>
      </SidebarMenuButton>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log time</DialogTitle>
          <DialogDescription>
            Record work you did away from the timer. The session is saved as
            already completed.
          </DialogDescription>
        </DialogHeader>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any tasks yet. Create one in{" "}
            <Link href="/settings" className="underline underline-offset-3">
              Settings
            </Link>{" "}
            first.
          </p>
        ) : (
          <form id="quick-create-form" onSubmit={handleSubmit} className="grid gap-4">
            {/* The selects and datetime inputs are controlled, so the values
                the action reads are mirrored into hidden fields. Times are
                sent as absolute instants so the server never has to guess a
                time zone. */}
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
              <Label htmlFor="quick-create-task">Task</Label>
              <Select
                value={taskId}
                onValueChange={(value) => setTaskId(String(value))}
                items={tasks.map((task) => ({
                  label: task.label,
                  value: task.id,
                }))}
              >
                <SelectTrigger id="quick-create-task" className="w-full">
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

            <div className="grid gap-2">
              <Label htmlFor="quick-create-start">Started</Label>
              <Input
                id="quick-create-start"
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="quick-create-end">Ended</Label>
              <Input
                id="quick-create-end"
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

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>
            Cancel
          </DialogClose>
          {tasks.length > 0 ? (
            <Button type="submit" form="quick-create-form" disabled={!canSave}>
              {pending ? "Saving…" : "Log time"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

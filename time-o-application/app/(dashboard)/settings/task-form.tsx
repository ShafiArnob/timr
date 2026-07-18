"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TASK_COLORS } from "@/lib/task-colors";
import { cn } from "@/lib/utils";
import { createTask, type SettingsState } from "./actions";

const DEFAULT_COLOR = (
  TASK_COLORS.find((color) => color.name === "Blue") ?? TASK_COLORS[0]
).hex;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function TaskForm() {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    createTask,
    undefined,
  );

  const [label, setLabel] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  // Clear the fields once a task is saved so the form is ready for the next
  // one. Adjusting state during render (instead of in an effect) is React's
  // recommended way to respond to a changed value, and the controlled inputs
  // pick up the reset without a form ref.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.status === "success") {
      setLabel("");
      setColor(DEFAULT_COLOR);
    }
  }

  const value = slugify(label);
  const canSave = value.length > 0 && !pending;

  return (
    <form action={action} className="space-y-4">
      <div className="flex space-x-12">
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="label">Label</Label>
          <Input
            id="label"
            name="label"
            placeholder="Design work"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          {value ? (
            <p className="text-xs text-muted-foreground">
              Saved as <span className="font-mono">{value}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label>Color</Label>
          <input type="hidden" name="color" value={color} />
          <div className="grid w-fit grid-cols-8 gap-2">
            {TASK_COLORS.map((entry) => (
              <button
                key={entry.hex}
                type="button"
                title={entry.name}
                aria-label={entry.name}
                aria-pressed={color === entry.hex}
                onClick={() => setColor(entry.hex)}
                className={cn(
                  "size-7 rounded-full border transition-transform hover:scale-110",
                  color === entry.hex &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: entry.hex }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSave}>
          {pending ? "Adding…" : "Add task"}
        </Button>
        {state ? (
          <p
            role="status"
            className={
              state.status === "success"
                ? "text-sm text-muted-foreground"
                : "text-sm text-destructive"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

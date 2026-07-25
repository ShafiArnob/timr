"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";

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
import { TASK_COLORS } from "@/lib/task-colors";
import { cn } from "@/lib/utils";
import { deleteTask, reorderTasks, updateTask } from "./actions";

export type SettingsTask = {
  id: string;
  value: string;
  label: string;
  color: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function EditTaskDialog({ task }: { task: SettingsTask }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(task.label);
  const [color, setColor] = useState(task.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-seed the fields from the current task each time the dialog opens, so
  // a cancelled edit doesn't leak into the next one.
  function handleOpenChange(next: boolean) {
    if (pending) return;
    setError(null);
    if (next) {
      setLabel(task.label);
      setColor(task.color);
    }
    setOpen(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateTask(formData);
      if (result?.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(false);
    });
  }

  const value = slugify(label);
  const canSave = value.length > 0 && !pending;
  const formId = `edit-task-${task.id}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          />
        }
      >
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>
            Update the label or color. The value is re-derived from the
            label.
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={handleSubmit} className="grid gap-4">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="color" value={color} />

          <div className="grid gap-2">
            <Label htmlFor={`${formId}-label`}>Label</Label>
            <Input
              id={`${formId}-label`}
              name="label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            {value ? (
              <p className="text-xs text-muted-foreground">
                Saved as <span className="font-mono">{value}</span>
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Color</Label>
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

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="outline" disabled={pending} />}
          >
            Cancel
          </DialogClose>
          <Button type="submit" form={formId} disabled={!canSave}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableTask({ task }: { task: SettingsTask }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <li
      ref={setNodeRef}
      data-dragging={isDragging}
      // The row is lifted out of the flow while dragging, so it needs its own
      // background to cover the rows it passes over.
      className="relative z-0 flex items-center gap-3 bg-background px-4 py-3 data-[dragging=true]:z-10 data-[dragging=true]:opacity-90 data-[dragging=true]:shadow-sm"
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="cursor-grab text-muted-foreground hover:bg-transparent active:cursor-grabbing"
      >
        <GripVerticalIcon />
        <span className="sr-only">Reorder {task.label}</span>
      </Button>

      <span
        className="size-4 shrink-0 rounded-full border"
        style={{ backgroundColor: task.color }}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.label}</p>
        <p className="truncate text-xs text-muted-foreground">{task.value}</p>
      </div>

      <EditTaskDialog task={task} />

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
  );
}

export function TaskList({ tasks }: { tasks: SettingsTask[] }) {
  const dndId = useId();
  const [items, setItems] = useState(tasks);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The server owns the order: whenever it sends a new list (a task was added,
  // deleted, or a reorder was saved), adopt it. Adjusting state during render
  // instead of in an effect is React's recommended way to react to new props.
  const [handledTasks, setHandledTasks] = useState(tasks);
  if (tasks !== handledTasks) {
    setHandledTasks(tasks);
    setItems(tasks);
  }

  const sensors = useSensors(
    // A small threshold keeps a click on the handle from registering as a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // A press delay leaves touch scrolling over the list working.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((task) => task.id === active.id);
    const newIndex = items.findIndex((task) => task.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = items;
    const next = arrayMove(items, oldIndex, newIndex);

    // Show the new order immediately; the save below either confirms it via
    // revalidation or we roll back to `previous`.
    setItems(next);
    setError(null);

    startTransition(async () => {
      const result = await reorderTasks(next.map((task) => task.id));
      if (result.status === "error") {
        setItems(previous);
        setError(result.message);
      }
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks yet.</p>;
  }

  return (
    <div className="space-y-2">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="divide-y overflow-hidden rounded-lg border">
            {items.map((task) => (
              <SortableTask key={task.id} task={task} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <p role="status" className="text-xs text-destructive">
        {error ?? " "}
      </p>
    </div>
  );
}

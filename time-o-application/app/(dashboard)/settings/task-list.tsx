"use client";

import { useId, useState, useTransition } from "react";
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
import { deleteTask, reorderTasks } from "./actions";

export type SettingsTask = {
  id: string;
  value: string;
  label: string;
  color: string;
};

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

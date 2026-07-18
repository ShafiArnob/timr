"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PauseIcon, PlayIcon, SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pauseTimer, resumeTimer, startTimer, stopTimer } from "./actions";

type TimerTask = {
  id: string;
  value: string;
  label: string;
  color: string;
};

type TimerStatus = "idle" | "running" | "paused";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function Timer({ tasks }: { tasks: TimerTask[] }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [trackerId, setTrackerId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { kind: "error" | "notice"; text: string } | null
  >(null);

  // Milliseconds banked from run segments before the last pause.
  const bankedMsRef = useRef(0);
  // Timestamp of the last start/resume; null while idle or paused.
  const runningSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      const since = runningSinceRef.current;
      if (since !== null) {
        setElapsedMs(bankedMsRef.current + Date.now() - since);
      }
    }, 250);
    return () => clearInterval(id);
  }, [status]);

  /** Active time so far, banked segments plus the current one. */
  function currentElapsedMs(): number {
    const since = runningSinceRef.current;
    return bankedMsRef.current + (since !== null ? Date.now() - since : 0);
  }

  async function handleStart() {
    if (!taskId || pending) return;
    setPending(true);
    setMessage(null);
    const result = await startTimer(taskId);
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    bankedMsRef.current = 0;
    runningSinceRef.current = Date.now();
    setTrackerId(result.trackerId);
    setElapsedMs(0);
    setStatus("running");
  }

  async function handlePause() {
    if (!trackerId || pending) return;
    // Snapshot at click time so time spent awaiting the server isn't counted.
    const elapsed = currentElapsedMs();
    setPending(true);
    setMessage(null);
    const result = await pauseTimer(trackerId, Math.round(elapsed / 1000));
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    bankedMsRef.current = elapsed;
    runningSinceRef.current = null;
    setElapsedMs(elapsed);
    setStatus("paused");
  }

  async function handleResume() {
    if (!trackerId || pending) return;
    setPending(true);
    setMessage(null);
    const result = await resumeTimer(trackerId);
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    runningSinceRef.current = Date.now();
    setStatus("running");
  }

  async function handleStop() {
    if (!trackerId || pending) return;
    const elapsed = currentElapsedMs();
    const elapsedSeconds = Math.round(elapsed / 1000);
    setPending(true);
    setMessage(null);
    const result = await stopTimer(trackerId, elapsedSeconds);
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    bankedMsRef.current = 0;
    runningSinceRef.current = null;
    setTrackerId(null);
    setElapsedMs(0);
    setStatus("idle");
    setMessage({
      kind: "notice",
      text: `Session saved — ${formatElapsed(elapsed)} on ${
        tasks.find((task) => task.id === taskId)?.label ?? "task"
      }.`,
    });
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-doto text-6xl font-bold tabular-nums">00:00:00</p>
        <p className="text-sm text-muted-foreground">
          You need a task before you can track time.{" "}
          <Link href="/settings" className="underline underline-offset-4">
            Create one in Settings
          </Link>
          .
        </p>
      </div>
    );
  }

  // Passing `items` lets the trigger render the selected task's label
  // (with its color dot) instead of the raw task id.
  const selectItems = tasks.map((task) => ({
    value: task.id,
    label: (
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 shrink-0 rounded-full border"
          style={{ backgroundColor: task.color }}
          aria-hidden
        />
        {task.label}
      </span>
    ),
  }));

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-8">
      <Select
        value={taskId}
        onValueChange={setTaskId}
        items={selectItems}
        // Changing the task mid-session would detach the tracker from what is
        // actually being timed, so lock the choice until the session stops.
        disabled={status !== "idle" || pending}
      >
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Select a task" />
        </SelectTrigger>
        <SelectContent>
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
        </SelectContent>
      </Select>

      <div className="flex flex-col items-center gap-2">
        <p className="font-doto text-7xl font-bold tabular-nums sm:text-8xl">
          {formatElapsed(elapsedMs)}
        </p>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          {status === "running"
            ? "In progress"
            : status === "paused"
              ? "Paused"
              : "Ready"}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {status === "idle" ? (
          <Button size="lg" onClick={handleStart} disabled={!taskId || pending}>
            <PlayIcon />
            {pending ? "Starting…" : "Start"}
          </Button>
        ) : (
          <>
            {status === "running" ? (
              <Button
                size="lg"
                variant="secondary"
                onClick={handlePause}
                disabled={pending}
              >
                <PauseIcon />
                Pause
              </Button>
            ) : (
              <Button size="lg" onClick={handleResume} disabled={pending}>
                <PlayIcon />
                Resume
              </Button>
            )}
            <Button
              size="lg"
              variant="destructive"
              onClick={handleStop}
              disabled={pending}
            >
              <SquareIcon />
              Stop
            </Button>
          </>
        )}
      </div>

      <p
        role="status"
        className={
          message?.kind === "error"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {message?.text ?? " "}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { pauseTimer, resumeTimer, startTimer, stopTimer } from "./actions";

type TimerTask = {
  id: string;
  label: string;
};

type TimerStatus = "idle" | "running" | "paused";

/** Countdown presets, in minutes. Selecting none leaves it a stopwatch. */
const PRESETS = [15, 30, 45, 60];

/** How many tasks fit in the console's 2×2 task grid. */
const TASK_SLOTS = 4;

/**
 * A countdown's length isn't stored on the tracker row, so remember it here.
 * Without this a reload would resume a countdown as a stopwatch that never
 * rings.
 */
const PRESET_STORAGE_KEY = "time-o:timer-preset";

export type ActiveSession = {
  trackerId: string;
  taskId: string;
  status: "running" | "paused";
  /** Seconds banked before the current running segment. */
  bankedSeconds: number;
  /** Epoch ms when the current running segment began; null while paused. */
  runningSince: number | null;
};

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function formatPreset(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

function readStoredPreset(trackerId: string): number | null {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { trackerId?: string; minutes?: number };
    if (stored.trackerId !== trackerId) return null;
    const minutes = stored.minutes;
    return typeof minutes === "number" && PRESETS.includes(minutes)
      ? minutes
      : null;
  } catch {
    return null;
  }
}

function writeStoredPreset(trackerId: string, minutes: number | null): void {
  try {
    if (minutes === null) {
      window.localStorage.removeItem(PRESET_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      PRESET_STORAGE_KEY,
      JSON.stringify({ trackerId, minutes }),
    );
  } catch {
    // Private-mode storage failures only cost us the reload restore.
  }
}

export function Timer({
  tasks,
  initialSession,
}: {
  tasks: TimerTask[];
  initialSession: ActiveSession | null;
}) {
  const [taskId, setTaskId] = useState<string | null>(
    initialSession?.taskId ?? null,
  );
  const [presetMinutes, setPresetMinutes] = useState<number | null>(null);
  const [status, setStatus] = useState<TimerStatus>(
    initialSession?.status ?? "idle",
  );
  const [trackerId, setTrackerId] = useState<string | null>(
    initialSession?.trackerId ?? null,
  );
  // Seeded with the banked time only (no Date.now() term) so server and
  // client render the same markup; the tick effect below catches the display
  // up right after hydration.
  const [elapsedMs, setElapsedMs] = useState(
    (initialSession?.bankedSeconds ?? 0) * 1000,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { kind: "error" | "notice"; text: string } | null
  >(null);

  // Milliseconds banked from run segments before the last pause.
  const bankedMsRef = useRef((initialSession?.bankedSeconds ?? 0) * 1000);
  // Timestamp of the last start/resume; null while idle or paused.
  const runningSinceRef = useRef<number | null>(
    initialSession?.runningSince ?? null,
  );
  // Guards the countdown from ringing twice on back-to-back ticks.
  const finishingRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  const targetMs = presetMinutes === null ? null : presetMinutes * 60_000;
  const presetLabel = presetMinutes === null ? null : formatPreset(presetMinutes);

  // Restore the countdown length for a session that outlived a page reload.
  const restoreTrackerId = initialSession?.trackerId ?? null;
  useEffect(() => {
    if (!restoreTrackerId) return;
    const stored = readStoredPreset(restoreTrackerId);
    if (stored === null) return;
    // localStorage isn't readable during SSR, so seeding this from a lazy
    // useState initializer would desync server and client markup. Reading it
    // after hydration is the point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresetMinutes(stored);
  }, [restoreTrackerId]);

  /** Lazily created so the context is unlocked by a real user gesture. */
  function ensureAudio(): AudioContext | null {
    if (!audioRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioRef.current = new Ctor();
    }
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  }

  /** Three short square-wave blips — the console's alarm. */
  function beep(): void {
    const ctx = ensureAudio();
    if (!ctx) return;

    for (const offset of [0, 0.26, 0.52]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + offset;

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, at);
      // Ramp instead of a hard switch so the blip doesn't click.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.2);
    }
  }

  useEffect(() => {
    return () => {
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  /** Active time so far: banked segments plus the current one. */
  function currentElapsedMs(): number {
    const since = runningSinceRef.current;
    return bankedMsRef.current + (since !== null ? Date.now() - since : 0);
  }

  async function handleFinish(): Promise<void> {
    if (!trackerId || targetMs === null || finishingRef.current) return;
    finishingRef.current = true;

    // Ring first — saving is a roundtrip and the alarm shouldn't wait on it.
    beep();
    runningSinceRef.current = null;
    bankedMsRef.current = 0;
    setElapsedMs(0);
    setStatus("idle");
    setTrackerId(null);
    writeStoredPreset(trackerId, null);
    setMessage({
      kind: "notice",
      text: `Time's up — ${presetLabel} on ${
        tasks.find((task) => task.id === taskId)?.label ?? "task"
      }.`,
    });

    const result = await stopTimer(trackerId, Math.round(targetMs / 1000));
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
    }
  }

  // The interval only needs a stable reference to the latest handler; putting
  // `handleFinish` in the effect's deps would rebuild the timer every render.
  const finishRef = useRef(handleFinish);
  useEffect(() => {
    finishRef.current = handleFinish;
  });

  useEffect(() => {
    if (status !== "running") return;

    const update = () => {
      const since = runningSinceRef.current;
      if (since === null) return;
      const elapsed = bankedMsRef.current + Date.now() - since;
      setElapsedMs(elapsed);
      if (targetMs !== null && elapsed >= targetMs) {
        void finishRef.current();
      }
    };

    // Update immediately so a restored running session shows its real
    // elapsed time without waiting for the first tick.
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [status, targetMs]);

  async function handleStart() {
    if (!taskId || pending) return;
    // Unlock audio here, inside the click, so the alarm can play later.
    ensureAudio();
    setPending(true);
    setMessage(null);
    const result = await startTimer(taskId);
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    finishingRef.current = false;
    bankedMsRef.current = 0;
    runningSinceRef.current = Date.now();
    writeStoredPreset(result.trackerId, presetMinutes);
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
    setPending(true);
    setMessage(null);
    const result = await stopTimer(trackerId, Math.round(elapsed / 1000));
    setPending(false);
    if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
      return;
    }
    finishingRef.current = false;
    bankedMsRef.current = 0;
    runningSinceRef.current = null;
    writeStoredPreset(trackerId, null);
    setTrackerId(null);
    setElapsedMs(0);
    setStatus("idle");
    setMessage({
      kind: "notice",
      text: `Session saved — ${formatClock(elapsed)} on ${
        tasks.find((task) => task.id === taskId)?.label ?? "task"
      }.`,
    });
  }

  const idle = status === "idle";
  // Countdown shows time left; stopwatch counts up.
  const displayMs = targetMs === null ? elapsedMs : targetMs - elapsedMs;

  // The grid shows the first four tasks by manual order. If the running
  // session belongs to a task further down the list, surface it anyway so the
  // console never runs with nothing lit up.
  const topTasks = tasks.slice(0, TASK_SLOTS);
  const activeTask = tasks.find((task) => task.id === taskId);
  const gridTasks =
    activeTask && !topTasks.some((task) => task.id === activeTask.id)
      ? [...topTasks.slice(0, TASK_SLOTS - 1), activeTask]
      : topTasks;

  if (tasks.length === 0) {
    return (
      <RetroFrame>
        <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
          <p className="font-bpdots text-6xl text-retro-glow">00:00:00</p>
          <p className="max-w-xs text-xs leading-relaxed text-retro-dim">
            You need a task before you can track time.{" "}
            <Link
              href="/settings"
              className="text-retro-amber underline underline-offset-4"
            >
              Create one in Settings
            </Link>
            .
          </p>
        </div>
      </RetroFrame>
    );
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      <RetroFrame>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
          {/* Display + transport controls */}
          <div className="flex flex-col">
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
              <p
                className="font-bpdots text-5xl leading-none text-retro-glow tabular-nums sm:text-7xl"
                style={{ textShadow: "0 0 24px color-mix(in oklch, var(--retro-glow) 45%, transparent)" }}
              >
                {formatClock(displayMs)}
              </p>
              <p className="text-[0.6rem] tracking-[0.35em] text-retro-dim uppercase">
                {status === "running"
                  ? presetLabel === null
                    ? "Recording"
                    : "Counting down"
                  : status === "paused"
                    ? "Paused"
                    : presetLabel === null
                      ? "Stopwatch"
                      : `Timer · ${presetLabel}`}
              </p>
            </div>

            <div className="grid h-20 grid-cols-3 border-t-2 border-retro-line">
              <ConsoleButton
                onClick={handleStart}
                disabled={!idle || !taskId || pending}
                label="Start"
              >
                <CircleIcon className="size-6 fill-current" />
              </ConsoleButton>
              <ConsoleButton
                onClick={status === "paused" ? handleResume : handlePause}
                disabled={idle || pending}
                label={status === "paused" ? "Resume" : "Pause"}
                className="border-x-2 border-retro-line"
              >
                {status === "paused" ? (
                  <PlayIcon className="size-6 fill-current" />
                ) : (
                  <PauseIcon className="size-6 fill-current" />
                )}
              </ConsoleButton>
              <ConsoleButton
                onClick={handleStop}
                disabled={idle || pending}
                label="Stop"
              >
                <SquareIcon className="size-6 fill-current" />
              </ConsoleButton>
            </div>
          </div>

          {/* Task and preset pads */}
          <div className="grid grid-cols-2 border-t-2 border-retro-line sm:w-64 sm:border-t-0 sm:border-l-2">
            {Array.from({ length: TASK_SLOTS }, (_, index) => {
              const task = gridTasks[index];
              // Left-hand cells carry the vertical rule.
              const leftColumn = index % 2 === 0;

              if (!task) {
                return (
                  <div
                    key={`empty-${index}`}
                    className={cn(
                      "flex h-20 items-center justify-center border-b-2 border-retro-line/60 text-retro-line",
                      leftColumn && "border-r-2",
                    )}
                  >
                    ·
                  </div>
                );
              }

              const selected = taskId === task.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  title={task.label}
                  aria-pressed={selected}
                  // Switching tasks mid-session would detach the tracker from
                  // what is actually being timed.
                  disabled={!idle || pending}
                  onClick={() => setTaskId(task.id)}
                  className={cn(
                    "flex h-20 items-center justify-center border-b-2 border-retro-line/60 px-2 text-center transition-colors",
                    "text-sm leading-tight font-bold tracking-wider uppercase",
                    leftColumn && "border-r-2",
                    selected
                      ? "bg-retro-amber text-retro-bg"
                      : "text-retro-dim enabled:hover:bg-retro-cell enabled:hover:text-retro-amber",
                    !idle && !selected && "opacity-40",
                  )}
                >
                  <span className="line-clamp-2 w-full break-words">
                    {task.label}
                  </span>
                </button>
              );
            })}

            {PRESETS.map((minutes, index) => {
              const selected = presetMinutes === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={selected}
                  // The length is baked in at start: changing it mid-run would
                  // move the finish line under a session already counting down.
                  disabled={!idle || pending}
                  // Tapping the lit preset again drops back to stopwatch mode.
                  onClick={() =>
                    setPresetMinutes((current) =>
                      current === minutes ? null : minutes,
                    )
                  }
                  className={cn(
                    "flex h-20 items-center justify-center border-retro-line/60 text-xl font-bold tracking-widest transition-colors",
                    index % 2 === 0 && "border-r-2",
                    // Every row but the last gets a horizontal rule.
                    index < PRESETS.length - 2 && "border-b-2",
                    selected ? "bg-retro-amber text-retro-bg" : "text-retro-dim",
                    !selected &&
                      "enabled:hover:bg-retro-cell enabled:hover:text-retro-amber",
                    !idle && !selected && "opacity-40",
                  )}
                >
                  {formatPreset(minutes)}
                </button>
              );
            })}
          </div>
        </div>
      </RetroFrame>

      <div className="flex items-baseline justify-between gap-4 px-1 text-xs">
        <p
          role="status"
          className={
            message?.kind === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {message?.text ?? " "}
        </p>
        <p className="shrink-0 text-muted-foreground">
          Top {TASK_SLOTS} tasks —{" "}
          <Link href="/settings" className="underline underline-offset-4">
            reorder in Settings
          </Link>
        </p>
      </div>
    </div>
  );
}

function RetroFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden border-2 border-retro-line bg-retro-bg font-bpdots-unicase text-retro-amber shadow-[0_0_40px_-12px_var(--retro-amber)] select-none">
      {children}
    </div>
  );
}

function ConsoleButton({
  onClick,
  disabled,
  label,
  className,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 text-retro-amber transition-colors",
        "enabled:hover:bg-retro-cell enabled:hover:text-retro-glow",
        "disabled:text-retro-line",
        className,
      )}
    >
      {children}
      <span className="text-sm font-bold tracking-[0.2em] uppercase">
        {label}
      </span>
    </button>
  );
}

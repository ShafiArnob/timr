import { cn } from "@/lib/utils";
import { RetroFrame } from "./timer";

/** How many tasks fit in the console's 2×2 task grid. */
const TASK_SLOTS = 4;
/** Countdown presets, in minutes — only the count matters here. */
const PRESET_SLOTS = 4;

function Pulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-retro-line/40", className)} />;
}

export default function Loading() {
  return (
    <div className="flex min-h-[calc(100svh-10rem)] items-center justify-center px-4 lg:px-6">
      <div className="flex w-full max-w-3xl flex-col gap-3">
        <RetroFrame>
          <div className="grid sm:grid-cols-[minmax(0,1fr)_auto]">
            {/* Display + transport controls */}
            <div className="flex flex-col">
              <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
                <Pulse className="h-12 w-64 sm:h-16 sm:w-80" />
                <Pulse className="h-2.5 w-28" />
              </div>

              <div className="grid h-20 grid-cols-3 border-t-2 border-retro-line">
                <div className="flex items-center justify-center">
                  <Pulse className="size-6 rounded-full" />
                </div>
                <div className="flex items-center justify-center border-x-2 border-retro-line">
                  <Pulse className="size-6 rounded-full" />
                </div>
                <div className="flex items-center justify-center">
                  <Pulse className="size-6 rounded-full" />
                </div>
              </div>
            </div>

            {/* Task and preset pads */}
            <div className="grid grid-cols-2 border-t-2 border-retro-line sm:w-64 sm:border-t-0 sm:border-l-2">
              {Array.from({ length: TASK_SLOTS }, (_, index) => (
                <div
                  key={`task-${index}`}
                  className={cn(
                    "flex h-20 items-center justify-center border-b-2 border-retro-line/60 px-4",
                    index % 2 === 0 && "border-r-2",
                  )}
                >
                  <Pulse className="h-4 w-full" />
                </div>
              ))}
              {Array.from({ length: PRESET_SLOTS }, (_, index) => (
                <div
                  key={`preset-${index}`}
                  className={cn(
                    "flex h-20 items-center justify-center border-retro-line/60",
                    index % 2 === 0 && "border-r-2",
                    index < PRESET_SLOTS - 2 && "border-b-2",
                  )}
                >
                  <Pulse className="h-5 w-10" />
                </div>
              ))}
            </div>
          </div>
        </RetroFrame>

        <div className="flex items-baseline justify-between gap-4 px-1">
          <Pulse className="h-3 w-32" />
          <Pulse className="h-3 w-44" />
        </div>
      </div>
    </div>
  );
}

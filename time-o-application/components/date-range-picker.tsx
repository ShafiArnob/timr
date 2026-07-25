"use client";

import * as React from "react";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { CalendarIcon } from "lucide-react";
import { type DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Monday, to match how the chart buckets weeks. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

type Preset = {
  label: string;
  range: (today: Date) => DateRange;
};

const PRESETS: Preset[] = [
  {
    label: "This week",
    range: (today) => ({
      from: startOfWeek(today, WEEK_OPTIONS),
      to: endOfWeek(today, WEEK_OPTIONS),
    }),
  },
  {
    label: "Last week",
    range: (today) => {
      const lastWeek = subWeeks(today, 1);
      return {
        from: startOfWeek(lastWeek, WEEK_OPTIONS),
        to: endOfWeek(lastWeek, WEEK_OPTIONS),
      };
    },
  },
  {
    label: "This month",
    range: (today) => ({
      from: startOfMonth(today),
      to: endOfMonth(today),
    }),
  },
  {
    label: "Last month",
    range: (today) => {
      const lastMonth = subMonths(today, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
  {
    label: "Last 7 days",
    range: (today) => ({ from: subDays(today, 6), to: today }),
  },
  {
    label: "Last 30 days",
    range: (today) => ({ from: subDays(today, 29), to: today }),
  },
  {
    label: "Last 3 months",
    range: (today) => ({ from: subMonths(today, 3), to: today }),
  },
  {
    label: "This year",
    range: (today) => ({ from: startOfYear(today), to: today }),
  },
];

/** Presets are cheap to recompute, so a preset is "active" purely by value. */
export function isSameRange(
  a: DateRange | undefined,
  b: DateRange | undefined,
): boolean {
  if (!b) return false;
  if (!a?.from || !b.from) return false;
  const sameDay = (x?: Date, y?: Date) =>
    x && y ? x.toDateString() === y.toDateString() : x === y;
  return sameDay(a.from, b.from) && sameDay(a.to, b.to);
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Pinned per open so every preset in one session measures from the same
  // "now" — and so the button list doesn't shift if the day rolls over.
  const today = React.useMemo(() => new Date(), []);

  const label = value?.from ? (
    value.to ? (
      <>
        {format(value.from, "LLL dd, y")} - {format(value.to, "LLL dd, y")}
      </>
    ) : (
      format(value.from, "LLL dd, y")
    )
  ) : (
    <span>Pick a date</span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            id="date-picker-range"
            className={cn("justify-start px-2.5 font-normal", className)}
          >
            <CalendarIcon data-icon="inline-start" />
            {label}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row gap-1 overflow-x-auto border-b p-2 sm:flex-col sm:border-r sm:border-b-0">
            {PRESETS.map((preset) => {
              const range = preset.range(today);
              return (
                <Button
                  key={preset.label}
                  variant={isSameRange(value, range) ? "secondary" : "ghost"}
                  size="sm"
                  className="shrink-0 justify-start font-normal"
                  onClick={() => {
                    onChange(range);
                    setOpen(false);
                  }}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
          <Calendar
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={onChange}
            numberOfMonths={2}
            className="p-2"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

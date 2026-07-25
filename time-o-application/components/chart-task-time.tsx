"use client";

import * as React from "react";
import {
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronDownIcon, ListFilterIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type DateRange } from "react-day-picker";

import { DateRangePicker, isSameRange } from "@/components/date-range-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TaskTimePoint = {
  taskId: string;
  task: string;
  color: string;
  minutesSpent: number;
  /** ISO string of when the session started. */
  date: string;
};

export type ChartTaskOption = {
  id: string;
  label: string;
  color: string;
};

/** Monday, to match the date picker's week presets. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/**
 * Grouped bars stop being readable past a handful of series, so the long tail
 * is folded into one visible "Other" bar rather than dropped.
 */
const MAX_SERIES = 6;
const OTHER_KEY = "__other";

function thisWeek(today: Date): DateRange {
  return {
    from: startOfWeek(today, WEEK_OPTIONS),
    to: endOfWeek(today, WEEK_OPTIONS),
  };
}

function thisMonth(today: Date): DateRange {
  return { from: startOfMonth(today), to: endOfMonth(today) };
}

function formatHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function ChartTaskTime({
  data,
  tasks,
}: {
  data: TaskTimePoint[];
  tasks: ChartTaskOption[];
}) {
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    thisWeek(new Date()),
  );
  // Empty means "no task hidden" — every task shows until the user hides one.
  const [hiddenTaskIds, setHiddenTaskIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Shared by the dropdown checkboxes and the clickable legend below the
  // chart — both are just different entry points to the same hidden set.
  // The "Other" bucket has no single task id behind it, so clicks on it
  // are ignored rather than toggling nothing.
  function toggleHiddenTask(taskId: string) {
    if (taskId === OTHER_KEY) return;
    setHiddenTaskIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  // The toggle is a shortcut into the range, not separate state — so picking
  // an equivalent range by hand lights the matching button, and picking
  // anything else clears both.
  const period = isSameRange(range, thisWeek(new Date()))
    ? "week"
    : isSameRange(range, thisMonth(new Date()))
      ? "month"
      : null;

  const { rows, config, seriesKeys, totalMinutes } = React.useMemo(() => {
    const today = new Date();
    const selectedFrom = range?.from;
    // A range with only a start still reads as "that day onward".
    const selectedTo = range?.to
      ? endOfDay(range.to)
      : selectedFrom
        ? endOfDay(today)
        : undefined;
    // Picking a start date in the future leaves the implied end behind it, and
    // isWithinInterval expects a forward interval.
    const reversed =
      selectedFrom && selectedTo ? selectedTo < selectedFrom : false;
    const from = reversed ? selectedTo : selectedFrom;
    const to = reversed ? selectedFrom : selectedTo;

    const dateFiltered = data.filter((point) => {
      if (point.minutesSpent <= 0) return false;
      if (!from || !to) return true;
      const at = new Date(point.date);
      return (
        !Number.isNaN(at.getTime()) &&
        isWithinInterval(at, { start: from, end: to })
      );
    });

    // Rank tasks by total time within the date range, independent of which
    // ones are currently hidden — so hiding a task dims its legend entry and
    // zeroes its bars without reshuffling everyone else's slot, and it stays
    // there to be clicked back on.
    const totals = new Map<
      string,
      { label: string; color: string; minutes: number }
    >();
    for (const point of dateFiltered) {
      const entry = totals.get(point.taskId) ?? {
        label: point.task,
        color: point.color,
        minutes: 0,
      };
      entry.minutes += point.minutesSpent;
      totals.set(point.taskId, entry);
    }

    const ranked = [...totals.entries()].sort(
      (a, b) => b[1].minutes - a[1].minutes,
    );
    const kept = ranked.slice(0, MAX_SERIES);
    const keptIds = new Set(kept.map(([taskId]) => taskId));
    const hasOther = ranked.length > kept.length;

    // One bucket per calendar day, holding a minute total per series. A
    // hidden task's day still gets a bucket (so the axis doesn't shift) but
    // contributes no value to it.
    const buckets = new Map<number, Map<string, number>>();
    for (const point of dateFiltered) {
      const day = startOfDay(new Date(point.date)).getTime();
      const bucket = buckets.get(day) ?? new Map<string, number>();
      buckets.set(day, bucket);
      if (hiddenTaskIds.has(point.taskId)) continue;
      const seriesKey = keptIds.has(point.taskId) ? point.taskId : OTHER_KEY;
      bucket.set(seriesKey, (bucket.get(seriesKey) ?? 0) + point.minutesSpent);
    }

    // Every day in the window gets a slot so the axis stays continuous and
    // untracked days read as gaps rather than being skipped over. The window
    // stops at today: a mid-month view shouldn't trail empty future days.
    const dayKeys = [...buckets.keys()];
    const fillFrom = from ? startOfDay(from) : undefined;
    const lastDataDay = dayKeys.length > 0 ? Math.max(...dayKeys) : undefined;
    const cappedTo =
      to && to > endOfDay(today) ? endOfDay(today) : (to ?? undefined);
    const fillTo =
      cappedTo && lastDataDay && lastDataDay > cappedTo.getTime()
        ? new Date(lastDataDay)
        : cappedTo;

    const days =
      fillFrom && fillTo && fillFrom <= fillTo
        ? eachDayOfInterval({ start: fillFrom, end: fillTo })
        : dayKeys.sort((a, b) => a - b).map((key) => new Date(key));

    const chartConfig: ChartConfig = Object.fromEntries(
      kept.map(([taskId, entry]) => [
        taskId,
        { label: entry.label, color: entry.color },
      ]),
    );
    if (hasOther) {
      chartConfig[OTHER_KEY] = {
        label: "Other",
        color: "var(--muted-foreground)",
      };
    }

    return {
      rows: days.map((day): Record<string, string | number> => ({
        date: day.toISOString(),
        ...Object.fromEntries(buckets.get(startOfDay(day).getTime()) ?? []),
      })),
      config: chartConfig,
      seriesKeys: [
        ...kept.map(([taskId]) => taskId),
        ...(hasOther ? [OTHER_KEY] : []),
      ],
      totalMinutes: dateFiltered.reduce(
        (sum, point) =>
          hiddenTaskIds.has(point.taskId) ? sum : sum + point.minutesSpent,
        0,
      ),
    };
  }, [data, range, hiddenTaskIds]);

  return (
    <Card className="@container/chart">
      <CardHeader>
        <CardTitle>Time per task</CardTitle>
        <CardDescription>
          {totalMinutes > 0
            ? `${formatHours(totalMinutes)} tracked across ${rows.length} day${
                rows.length === 1 ? "" : "s"
              }`
            : "No tracked time in this range"}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            multiple={false}
            value={period ? [period] : []}
            onValueChange={(value) => {
              const next = value[0];
              const today = new Date();
              if (next === "week") setRange(thisWeek(today));
              else if (next === "month") setRange(thisMonth(today));
            }}
            variant="outline"
          >
            <ToggleGroupItem value="week">This Week</ToggleGroupItem>
            <ToggleGroupItem value="month">This Month</ToggleGroupItem>
          </ToggleGroup>
          <DateRangePicker value={range} onChange={setRange} />
          {tasks.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <ListFilterIcon data-icon="inline-start" />
                Tasks
                {hiddenTaskIds.size > 0 ? (
                  <Badge variant="secondary" className="ml-1">
                    {tasks.length - hiddenTaskIds.size}
                  </Badge>
                ) : null}
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  disabled={hiddenTaskIds.size === 0}
                  onClick={() => setHiddenTaskIds(new Set())}
                >
                  Show all
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {tasks.map((task) => (
                  <DropdownMenuCheckboxItem
                    key={task.id}
                    checked={!hiddenTaskIds.has(task.id)}
                    onCheckedChange={() => toggleHiddenTask(task.id)}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: task.color }}
                      aria-hidden
                    />
                    {task.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Nothing tracked in the selected range.
          </div>
        ) : (
          <ChartContainer config={config} className="h-[250px] w-full">
            <BarChart accessibilityLayer data={rows}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                // Long ranges have more days than fit; let recharts thin the
                // labels rather than overlapping them.
                minTickGap={16}
                tickFormatter={(value: string) => format(new Date(value), "MMM d")}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                // Stored in minutes; hours read better on the axis.
                tickFormatter={(value: number) =>
                  value >= 60 ? `${Math.round(value / 60)}h` : `${value}m`
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      format(new Date(value as string), "EEE, MMM d, yyyy")
                    }
                    formatter={(value, name) => (
                      <div className="flex w-full justify-between gap-3">
                        <span className="text-muted-foreground">
                          {config[name as string]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium tabular-nums">
                          {formatHours(Number(value))}
                        </span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend
                content={
                  <ChartLegendContent
                    onItemClick={toggleHiddenTask}
                    inactiveKeys={hiddenTaskIds}
                  />
                }
              />
              {seriesKeys.map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={`var(--color-${key})`}
                  radius={4}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

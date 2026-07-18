"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COUNTRIES,
  flagEmoji,
  getCountry,
  timezoneLabel,
} from "@/lib/countries";
import { updateTimezone, type SettingsState } from "./actions";

function offsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function formatCurrentTime(timeZone: string, date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

export function TimezoneForm({
  initialCountry,
  initialTimezone,
}: {
  initialCountry: string | null;
  initialTimezone: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateTimezone,
    undefined,
  );

  const [country, setCountry] = useState<string | null>(initialCountry);
  const [timezone, setTimezone] = useState<string | null>(initialTimezone);
  const [now, setNow] = useState<Date | null>(null);

  // Client-only mount work: a live clock for the selected zone, plus a one-time
  // suggestion of the browser's country/zone when nothing is saved yet. Both
  // run on the client to avoid server/client mismatch during hydration, and the
  // state writes are deferred into timer callbacks so they don't fire
  // synchronously inside the effect body.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    const init = setTimeout(() => {
      setNow(new Date());
      if (initialCountry || initialTimezone) return;
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const match = COUNTRIES.find((entry) =>
        entry.timezones.includes(detected),
      );
      if (match) {
        setCountry(match.code);
        setTimezone(detected);
      }
    }, 0);
    return () => {
      clearInterval(id);
      clearTimeout(init);
    };
  }, [initialCountry, initialTimezone]);

  const zones = useMemo(() => getCountry(country)?.timezones ?? [], [country]);

  function handleCountryChange(value: string | null) {
    setCountry(value);
    const next = getCountry(value)?.timezones ?? [];
    setTimezone(next[0] ?? null);
  }

  const canSave = Boolean(country && timezone) && !pending;

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="country">Country</Label>
          <Select
            name="country"
            value={country}
            onValueChange={handleCountryChange}
          >
            <SelectTrigger id="country" className="w-full">
              <SelectValue placeholder="Select a country" />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  <span className="mr-1">{flagEmoji(entry.code)}</span>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">Time zone</Label>
          <Select
            name="timezone"
            value={timezone}
            onValueChange={setTimezone}
            disabled={zones.length === 0}
          >
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue placeholder="Select a time zone" />
            </SelectTrigger>
            <SelectContent>
              {zones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  <span className="flex-1">{timezoneLabel(zone)}</span>
                  <span className="text-muted-foreground">
                    {offsetLabel(zone)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {timezone && now ? (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Current time in </span>
          <span className="font-medium">{timezoneLabel(timezone)}</span>
          <span className="text-muted-foreground"> — </span>
          <span className="font-medium">{formatCurrentTime(timezone, now)}</span>{" "}
          <span className="text-muted-foreground">({offsetLabel(timezone)})</span>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSave}>
          {pending ? "Saving…" : "Save changes"}
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

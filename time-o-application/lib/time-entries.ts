import "server-only";

/** A typo in the year turns into a decade-long session, so cap the span. */
export const MAX_SESSION_HOURS = 24;
/** Tolerance for a client clock that runs slightly ahead of the server's. */
export const FUTURE_SKEW_MS = 60_000;

export type TimeWindow = {
  startTime: Date;
  endTime: Date;
  minutesSpent: number;
};

export type TimeWindowResult =
  | { ok: true; window: TimeWindow }
  | { ok: false; message: string };

/**
 * Turns whatever subset of `startTime` / `endTime` / `minutes` a caller sent
 * into a complete, validated session window.
 *
 * A device that never synced its clock can send a duration alone and let the
 * server stamp the instants, so the API stays usable without NTP. Supplying a
 * duration *and* both endpoints is rejected rather than silently reconciled —
 * the two would disagree eventually, and guessing which one the caller meant
 * writes bad data quietly.
 */
export function resolveTimeWindow(input: {
  startTime?: Date | null;
  endTime?: Date | null;
  minutes?: number | null;
  /** Injectable so the whole window is judged against a single instant. */
  now?: number;
}): TimeWindowResult {
  const now = input.now ?? Date.now();
  const start = input.startTime ?? null;
  const end = input.endTime ?? null;
  const minutes = input.minutes ?? null;

  if (start && Number.isNaN(start.getTime())) {
    return { ok: false, message: "startTime is not a valid date." };
  }
  if (end && Number.isNaN(end.getTime())) {
    return { ok: false, message: "endTime is not a valid date." };
  }

  let startTime: Date;
  let endTime: Date;

  if (start && end) {
    if (minutes !== null) {
      return {
        ok: false,
        message:
          "Send startTime and endTime, or a duration — not both, since they can disagree.",
      };
    }
    startTime = start;
    endTime = end;
  } else if (minutes !== null) {
    const spanMs = minutes * 60_000;
    if (start) {
      startTime = start;
      endTime = new Date(start.getTime() + spanMs);
    } else if (end) {
      startTime = new Date(end.getTime() - spanMs);
      endTime = end;
    } else {
      // The common case for a device: it knows how long it worked, not when.
      endTime = new Date(now);
      startTime = new Date(now - spanMs);
    }
  } else if (start) {
    return { ok: false, message: "Send endTime or a duration alongside startTime." };
  } else if (end) {
    return { ok: false, message: "Send startTime or a duration alongside endTime." };
  } else {
    return {
      ok: false,
      message: "Send a duration, or both startTime and endTime.",
    };
  }

  const spanMs = endTime.getTime() - startTime.getTime();
  if (spanMs <= 0) {
    return { ok: false, message: "The end time must be after the start." };
  }

  const minutesSpent = Math.round(spanMs / 60_000);
  if (minutesSpent <= 0) {
    return { ok: false, message: "A session has to be at least 30 seconds long." };
  }
  if (spanMs > MAX_SESSION_HOURS * 60 * 60 * 1000) {
    return {
      ok: false,
      message: `A single session can't be longer than ${MAX_SESSION_HOURS} hours. Split it into two entries.`,
    };
  }
  if (endTime.getTime() > now + FUTURE_SKEW_MS) {
    return { ok: false, message: "You can't log work in the future." };
  }

  return { ok: true, window: { startTime, endTime, minutesSpent } };
}

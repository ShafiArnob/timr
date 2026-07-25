/**
 * Conversions between `datetime-local` inputs and absolute instants.
 *
 * Shared by every dialog that edits a session window, so a session logged in
 * one and reopened in another round-trips to the same instant instead of
 * drifting by whatever each dialog assumed about time zones.
 */

/**
 * `datetime-local` speaks naive local time ("YYYY-MM-DDTHH:mm"), while
 * toISOString() is UTC — so the value has to be built by hand from the
 * local parts.
 */
export function toLocalInputValue(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A naive local string parses back to an instant; blanks and typos give null. */
export function parseLocal(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An ISO instant from the server, as the local value an input can show. */
export function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : toLocalInputValue(date);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

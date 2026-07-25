import * as z from "zod";

import { authenticateRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { MAX_SESSION_HOURS, resolveTimeWindow } from "@/lib/time-entries";

/**
 * Without an offset, "2026-07-25T14:00" would be read in whatever zone the
 * server happens to run in — so an absolute instant is required.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

const instant = z
  .string()
  .trim()
  .regex(INSTANT, {
    error: "Use ISO 8601 with a UTC offset, e.g. 2026-07-25T14:00:00Z.",
  });

/**
 * Durations are capped at the same span the app allows anywhere else, and
 * accept strings too — hand-built JSON on a microcontroller often quotes them.
 */
const MAX_MINUTES = MAX_SESSION_HOURS * 60;

const CreateTimeEntrySchema = z.strictObject({
  taskId: z.string().trim().min(1, { error: "taskId can't be empty." }).optional(),
  task: z.string().trim().min(1, { error: "task can't be empty." }).optional(),
  startTime: instant.optional(),
  endTime: instant.optional(),
  minutes: z.coerce
    .number({ error: "minutes must be a number." })
    .int({ error: "minutes must be a whole number." })
    .positive({ error: "minutes must be greater than zero." })
    .max(MAX_MINUTES, { error: `minutes can't exceed ${MAX_MINUTES}.` })
    .optional(),
  seconds: z.coerce
    .number({ error: "seconds must be a number." })
    .int({ error: "seconds must be a whole number." })
    .positive({ error: "seconds must be greater than zero." })
    .max(MAX_MINUTES * 60, { error: `seconds can't exceed ${MAX_MINUTES * 60}.` })
    .optional(),
});

/**
 * Creates one completed time entry.
 *
 * Entries land as COMPLETED, so they never collide with the app's
 * one-active-timer rule — a device can post while a timer runs in the browser.
 */
export async function POST(request: Request) {
  const result = await authenticateRequest(request);
  if (!result.ok) return result.response;
  const { userId } = result.auth;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("invalid_request", "The request body must be JSON.");
  }

  const parsed = CreateTimeEntrySchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A misspelled field would otherwise be reported as a bare "Invalid input",
    // which is no help at all when the JSON was assembled by hand on a device.
    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys.join(", ");
      return apiError(
        "invalid_request",
        `Unknown field${issue.keys.length > 1 ? "s" : ""}: ${keys}.`,
      );
    }
    const field = issue.path.join(".");
    return apiError(
      "invalid_request",
      field ? `${field}: ${issue.message}` : issue.message,
    );
  }

  const body = parsed.data;

  if ((body.taskId ? 1 : 0) + (body.task ? 1 : 0) !== 1) {
    return apiError(
      "invalid_request",
      "Send exactly one of 'taskId' or 'task'.",
    );
  }
  if (body.minutes !== undefined && body.seconds !== undefined) {
    return apiError("invalid_request", "Send 'minutes' or 'seconds', not both.");
  }

  // Storage is whole minutes, so seconds are folded in here and the window
  // logic only ever deals with one unit.
  let minutes = body.minutes ?? null;
  if (body.seconds !== undefined) {
    minutes = Math.round(body.seconds / 60);
    if (minutes <= 0) {
      return apiError(
        "invalid_request",
        "A session has to be at least 30 seconds long.",
      );
    }
  }

  const window = resolveTimeWindow({
    startTime: body.startTime ? new Date(body.startTime) : null,
    endTime: body.endTime ? new Date(body.endTime) : null,
    minutes,
  });
  if (!window.ok) {
    return apiError("invalid_request", window.message);
  }

  try {
    // Scoped to the key's owner, so a task id guessed from another account
    // resolves to nothing.
    const task = await prisma.task.findFirst({
      where: body.taskId
        ? { id: body.taskId, userId }
        : {
            userId,
            OR: [
              { value: { equals: body.task, mode: "insensitive" } },
              { label: { equals: body.task, mode: "insensitive" } },
            ],
          },
      // Ties go to the task that sits highest in the user's own list.
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, value: true, label: true, color: true },
    });

    if (!task) {
      return apiError(
        "not_found",
        body.taskId
          ? `No task with id '${body.taskId}'.`
          : `No task matching '${body.task}'. List them with GET /api/v1/tasks.`,
      );
    }

    const entry = await prisma.timeTracker.create({
      data: {
        userId,
        taskId: task.id,
        startTime: window.window.startTime,
        endTime: window.window.endTime,
        minutesSpent: window.window.minutesSpent,
        status: "COMPLETED",
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        minutesSpent: true,
        status: true,
        createdAt: true,
      },
    });

    return apiJson(
      {
        id: entry.id,
        task: {
          id: task.id,
          value: task.value,
          label: task.label,
          color: task.color,
        },
        startTime: entry.startTime?.toISOString() ?? null,
        endTime: entry.endTime?.toISOString() ?? null,
        minutesSpent: entry.minutesSpent,
        status: entry.status,
        createdAt: entry.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    console.error("Failed to create time entry via API:", error);
    return apiError("server_error", "Something went wrong. Please try again.");
  }
}

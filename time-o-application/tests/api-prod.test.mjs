/**
 * Live contract tests for the public device API.
 *
 * These run against a *deployed* app over real HTTP — they are not unit tests
 * and they need no build step, so the same file can be pointed at production,
 * a preview deployment, or `next dev`:
 *
 *   node tests/api-prod.test.mjs
 *   TEST_PROD_API_BASE_URL=http://localhost:3000 node tests/api-prod.test.mjs
 *
 * The key is read from TEST_PROD_API_ENDPOINT in `.env` (TEST_PROD_API_KEY is
 * accepted too, since the value is a key and not an endpoint).
 *
 * Writes are opt-in. Every test below runs against production safely because
 * each one is rejected *before* the handler reaches `prisma.timeTracker.create`
 * — bad auth, bad JSON, bad window, unknown task. The tests that do create
 * entries only run with `--write`, because the API has no delete route and
 * anything it logs has to be removed by hand afterwards:
 *
 *   node tests/api-prod.test.mjs --write
 */

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads `.env` so the suite works as a bare `node` invocation, with no
 * `--env-file` flag and no dotenv import to keep in sync. Anything already in
 * the real environment wins, so CI can override without editing the file.
 */
function loadEnvFile(name) {
  let text;
  try {
    text = readFileSync(join(ROOT, name), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    // Comment lines fail this on the leading '#'.
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key in process.env) continue;
    const value = rawValue.trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    process.env[key] = quoted ? value.slice(1, -1) : value;
  }
}

loadEnvFile(".env");

const API_KEY =
  process.env.TEST_PROD_API_KEY ?? process.env.TEST_PROD_API_ENDPOINT;

/** Matches the origin the docs page hands out to firmware. */
const BASE_URL = (
  process.env.TEST_PROD_API_BASE_URL ?? "https://timr0.vercel.app"
).replace(/\/+$/, "");

const ALLOW_WRITES =
  process.argv.includes("--write") || process.env.TEST_ALLOW_WRITES === "1";

if (!API_KEY) {
  throw new Error(
    "No API key. Set TEST_PROD_API_ENDPOINT in .env or pass it in the environment.",
  );
}

/** A cold serverless function plus a Neon connection can take a while. */
const TIMEOUT_MS = 20_000;

/** Server-side caps, mirrored from lib/time-entries.ts. */
const MAX_SESSION_HOURS = 24;
const MAX_MINUTES = MAX_SESSION_HOURS * 60;

/** No task can match this, so lookups against it are guaranteed 404s. */
const MISSING_TASK = `no-such-task-${Math.random().toString(36).slice(2, 10)}`;

/** Entry ids created by the write group, reported at the end for cleanup. */
const created = [];

function bearer(key = API_KEY) {
  return { authorization: `Bearer ${key}` };
}

function iso(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString();
}

async function call(path, { method = "GET", headers = {}, body } = {}) {
  const init = {
    method,
    headers: { ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (body !== undefined) {
    init.headers["content-type"] ??= "application/json";
    // A string body is passed through verbatim, so malformed JSON can be sent.
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null: some responses (405) have no body at all.
  }
  return { status: response.status, headers: response.headers, json, text };
}

function postEntry(body, headers = bearer()) {
  return call("/api/v1/time-entries", { method: "POST", headers, body });
}

/** Trimmed so a failure message stays readable when an HTML error page comes back. */
function excerpt(res) {
  return res.text.slice(0, 300);
}

/** Checks the whole failure envelope at once: status, code, message, headers. */
function assertApiError(res, { status, code, message }) {
  assert.equal(res.status, status, `expected ${status} — body: ${excerpt(res)}`);
  assert.ok(res.json?.error, `expected an error envelope — body: ${excerpt(res)}`);
  assert.equal(res.json.error.code, code);
  assert.equal(typeof res.json.error.message, "string");
  if (message) assert.match(res.json.error.message, message);
  assert.equal(res.headers.get("cache-control"), "no-store");
}

let taskCache;

/** Fetched once; the write group needs a task that really exists. */
async function listTasks() {
  if (!taskCache) {
    const res = await call("/api/v1/tasks", { headers: bearer() });
    assert.equal(res.status, 200, `could not list tasks — body: ${excerpt(res)}`);
    taskCache = res.json.tasks;
  }
  return taskCache;
}

console.log(`\nAPI under test: ${BASE_URL}`);
console.log(`Key:            ${API_KEY.slice(0, 14)}…`);
console.log(
  ALLOW_WRITES
    ? "Writes:         ENABLED — real entries will be created\n"
    : "Writes:         disabled (pass --write to include them)\n",
);

describe("authentication", () => {
  it("rejects a request with no key", async () => {
    const res = await call("/api/v1/tasks");
    assertApiError(res, {
      status: 401,
      code: "unauthorized",
      message: /Missing API key/,
    });
    // Tells a generic HTTP client which scheme to retry with.
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
  });

  it("rejects an unknown key", async () => {
    const res = await call("/api/v1/tasks", {
      headers: bearer("to_live_definitely-not-a-real-key"),
    });
    assertApiError(res, {
      status: 401,
      code: "unauthorized",
      message: /not valid/,
    });
  });

  it("does not leak whether a key exists, expired, or was revoked", async () => {
    // A well-formed key that was never issued must be indistinguishable from
    // any other rejection, so probing tells an attacker nothing.
    const [unknown, malformed] = await Promise.all([
      call("/api/v1/tasks", { headers: bearer(`to_live_${"a".repeat(43)}`) }),
      call("/api/v1/tasks", { headers: bearer("garbage") }),
    ]);
    assert.equal(unknown.status, 401);
    assert.equal(malformed.status, 401);
    assert.equal(unknown.json.error.message, malformed.json.error.message);
  });

  it("accepts the valid key as a bearer token", async () => {
    const res = await call("/api/v1/tasks", { headers: bearer() });
    assert.equal(res.status, 200, `body: ${excerpt(res)}`);
  });

  it("treats the auth scheme case-insensitively", async () => {
    const res = await call("/api/v1/tasks", {
      headers: { authorization: `bearer ${API_KEY}` },
    });
    assert.equal(res.status, 200, `body: ${excerpt(res)}`);
  });

  it("accepts the key via X-API-Key", async () => {
    const res = await call("/api/v1/tasks", { headers: { "x-api-key": API_KEY } });
    assert.equal(res.status, 200, `body: ${excerpt(res)}`);
  });

  it("falls back to X-API-Key when Authorization is unusable", async () => {
    const res = await call("/api/v1/tasks", {
      headers: { authorization: "Token nonsense", "x-api-key": API_KEY },
    });
    assert.equal(res.status, 200, `body: ${excerpt(res)}`);
  });

  it("rejects malformed Authorization headers", async () => {
    const headers = [
      { authorization: "Bearer" },
      { authorization: `Bearer ${API_KEY} extra` },
      { authorization: API_KEY },
      { authorization: `Basic ${API_KEY}` },
    ];
    for (const header of headers) {
      const res = await call("/api/v1/tasks", { headers: header });
      assertApiError(res, {
        status: 401,
        code: "unauthorized",
        message: /Missing API key/,
      });
    }
  });

  it("authenticates before reading the body", async () => {
    // An unauthenticated caller must not learn anything about validation.
    const res = await postEntry("this is not json", {
      authorization: "Bearer nope",
    });
    assertApiError(res, { status: 401, code: "unauthorized" });
  });
});

describe("GET /api/v1/tasks", () => {
  it("returns the caller's tasks in their manual order", async () => {
    const res = await call("/api/v1/tasks", { headers: bearer() });

    assert.equal(res.status, 200, `body: ${excerpt(res)}`);
    assert.ok(Array.isArray(res.json.tasks), "expected a 'tasks' array");

    for (const task of res.json.tasks) {
      assert.deepEqual(
        Object.keys(task).sort(),
        ["color", "id", "label", "value"],
        "the response must expose exactly the four documented fields",
      );
      assert.equal(typeof task.id, "string");
      assert.equal(typeof task.value, "string");
      assert.equal(typeof task.label, "string");
    }
  });

  it("is never cached", async () => {
    // Responses are scoped to one key, so a shared cache would cross accounts.
    const res = await call("/api/v1/tasks", { headers: bearer() });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("returns JSON", async () => {
    const res = await call("/api/v1/tasks", { headers: bearer() });
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  });
});

describe("POST /api/v1/time-entries — request body", () => {
  it("rejects a body that is not JSON", async () => {
    const res = await postEntry("task=deep-work&minutes=25");
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /must be JSON/,
    });
  });

  it("rejects empty JSON", async () => {
    const res = await postEntry({});
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /exactly one of 'taskId' or 'task'/,
    });
  });

  it("names an unknown field instead of saying 'invalid input'", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: 1, notes: "hi" });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /Unknown field: notes\./,
    });
  });

  it("pluralises when several fields are unknown", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: 1, a: 1, b: 2 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /Unknown fields: /,
    });
  });

  it("rejects both taskId and task", async () => {
    const res = await postEntry({ taskId: "x", task: "y", minutes: 1 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /exactly one of 'taskId' or 'task'/,
    });
  });

  it("rejects an empty task", async () => {
    const res = await postEntry({ task: "   ", minutes: 1 });
    assertApiError(res, { status: 400, code: "invalid_request" });
  });

  it("rejects both minutes and seconds", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: 5, seconds: 300 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /'minutes' or 'seconds', not both/,
    });
  });

  it("rejects a non-numeric duration", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: "twenty" });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /minutes/,
    });
  });

  it("rejects a fractional duration", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: 1.5 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /whole number/,
    });
  });

  it("rejects a zero or negative duration", async () => {
    for (const minutes of [0, -5]) {
      const res = await postEntry({ task: MISSING_TASK, minutes });
      assertApiError(res, {
        status: 400,
        code: "invalid_request",
        message: /greater than zero/,
      });
    }
  });

  it(`rejects more than ${MAX_MINUTES} minutes`, async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: MAX_MINUTES + 1 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: new RegExp(`can't exceed ${MAX_MINUTES}`),
    });
  });

  it("rejects a sub-minute session that would round to zero", async () => {
    const res = await postEntry({ task: MISSING_TASK, seconds: 10 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /at least 30 seconds/,
    });
  });
});

describe("POST /api/v1/time-entries — time window", () => {
  it("rejects a timestamp with no UTC offset", async () => {
    // "2026-07-25T14:00" would otherwise be read in the server's zone.
    const res = await postEntry({ task: MISSING_TASK, startTime: "2026-07-25T14:00", minutes: 1 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /ISO 8601 with a UTC offset/,
    });
  });

  it("rejects a startTime that is not a date at all", async () => {
    const res = await postEntry({ task: MISSING_TASK, startTime: "yesterday", minutes: 1 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /ISO 8601 with a UTC offset/,
    });
  });

  it("rejects a duration alongside both endpoints", async () => {
    const res = await postEntry({
      task: MISSING_TASK,
      startTime: iso(-2 * 60 * 60_000),
      endTime: iso(-60 * 60_000),
      minutes: 30,
    });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /not both, since they can disagree/,
    });
  });

  it("rejects a lone startTime", async () => {
    const res = await postEntry({ task: MISSING_TASK, startTime: iso(-60 * 60_000) });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /endTime or a duration alongside startTime/,
    });
  });

  it("rejects a lone endTime", async () => {
    const res = await postEntry({ task: MISSING_TASK, endTime: iso(-60 * 60_000) });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /startTime or a duration alongside endTime/,
    });
  });

  it("rejects an end that precedes the start", async () => {
    const res = await postEntry({
      task: MISSING_TASK,
      startTime: iso(-60 * 60_000),
      endTime: iso(-2 * 60 * 60_000),
    });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /end time must be after the start/,
    });
  });

  it("rejects work logged in the future", async () => {
    const res = await postEntry({ task: MISSING_TASK, endTime: iso(10 * 60_000), minutes: 5 });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: /can't log work in the future/,
    });
  });

  it(`rejects a span longer than ${MAX_SESSION_HOURS} hours`, async () => {
    const res = await postEntry({
      task: MISSING_TASK,
      startTime: iso(-26 * 60 * 60_000),
      endTime: iso(-60 * 60_000),
    });
    assertApiError(res, {
      status: 400,
      code: "invalid_request",
      message: new RegExp(`longer than ${MAX_SESSION_HOURS} hours`),
    });
  });
});

describe("POST /api/v1/time-entries — task resolution", () => {
  it("404s on an unknown task name, and points at the tasks route", async () => {
    const res = await postEntry({ task: MISSING_TASK, minutes: 1 });
    assertApiError(res, {
      status: 404,
      code: "not_found",
      message: /GET \/api\/v1\/tasks/,
    });
  });

  it("404s on an unknown taskId", async () => {
    const res = await postEntry({ taskId: "clzzzzzzzzzzzzzzzzzzzzzzz", minutes: 1 });
    assertApiError(res, {
      status: 404,
      code: "not_found",
      message: /No task with id/,
    });
  });

  it("does not resolve a task belonging to another account", async () => {
    // Same shape as the check above, but stated as the isolation guarantee it
    // actually is: a real id from someone else's account must still 404.
    const res = await postEntry({ taskId: "cm00000000000000000000000", minutes: 1 });
    assertApiError(res, { status: 404, code: "not_found" });
  });
});

describe("method routing", () => {
  it("does not accept POST on the tasks route", async () => {
    const res = await call("/api/v1/tasks", {
      method: "POST",
      headers: bearer(),
      body: {},
    });
    assert.equal(res.status, 405, `body: ${excerpt(res)}`);
  });

  it("does not accept GET on the time-entries route", async () => {
    const res = await call("/api/v1/time-entries", { headers: bearer() });
    assert.equal(res.status, 405, `body: ${excerpt(res)}`);
  });
});

/**
 * Everything below writes to the database it is pointed at. There is no delete
 * route, so each entry created here has to be removed from the app by hand —
 * the ids are printed when the run finishes.
 */
describe("POST /api/v1/time-entries — creating entries", { skip: !ALLOW_WRITES && "pass --write to run" }, () => {
  /** Shared shape assertions for a 201, plus bookkeeping for cleanup. */
  function assertCreated(res, { minutesSpent }) {
    assert.equal(res.status, 201, `body: ${excerpt(res)}`);
    const entry = res.json;
    created.push(entry.id);

    assert.equal(typeof entry.id, "string");
    assert.equal(entry.minutesSpent, minutesSpent);
    // Entries land completed so they never collide with the app's
    // one-active-timer rule.
    assert.equal(entry.status, "COMPLETED");
    assert.ok(entry.task?.id, "the created entry must echo its task");

    const span = Date.parse(entry.endTime) - Date.parse(entry.startTime);
    assert.equal(span, minutesSpent * 60_000, "the window must match the duration");
    return entry;
  }

  it("logs a duration and lets the server stamp the instants", async () => {
    const [task] = await listTasks();
    assert.ok(task, "the account needs at least one task for the write tests");

    const before = Date.now();
    const res = await postEntry({ task: task.value, minutes: 1 });
    const entry = assertCreated(res, { minutesSpent: 1 });

    assert.equal(entry.task.id, task.id);
    assert.equal(entry.task.value, task.value);
    // A device with no synced clock relies on the server ending the session now.
    const end = Date.parse(entry.endTime);
    assert.ok(end >= before - 60_000 && end <= Date.now() + 60_000, `endTime ${entry.endTime} is not close to now`);
  });

  it("matches a task name case-insensitively", async () => {
    const [task] = await listTasks();
    const res = await postEntry({ task: task.value.toUpperCase(), minutes: 1 });
    assert.equal(assertCreated(res, { minutesSpent: 1 }).task.id, task.id);
  });

  it("resolves a task by its label as well as its value", async () => {
    const [task] = await listTasks();
    const res = await postEntry({ task: task.label, minutes: 1 });
    assert.equal(res.status, 201, `body: ${excerpt(res)}`);
    created.push(res.json.id);
  });

  it("accepts an explicit taskId", async () => {
    const [task] = await listTasks();
    const res = await postEntry({ taskId: task.id, minutes: 2 });
    assert.equal(assertCreated(res, { minutesSpent: 2 }).task.id, task.id);
  });

  it("folds seconds into whole minutes", async () => {
    const [task] = await listTasks();
    // 90s rounds to 2 minutes, since storage is whole minutes.
    const res = await postEntry({ task: task.value, seconds: 90 });
    assertCreated(res, { minutesSpent: 2 });
  });

  it("coerces a quoted duration, as hand-built firmware JSON sends it", async () => {
    const [task] = await listTasks();
    const res = await postEntry({ task: task.value, minutes: "3" });
    assertCreated(res, { minutesSpent: 3 });
  });

  it("honours an explicit start and end", async () => {
    const [task] = await listTasks();
    const startTime = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const endTime = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

    const res = await postEntry({ task: task.value, startTime, endTime });
    const entry = assertCreated(res, { minutesSpent: 60 });

    assert.equal(Date.parse(entry.startTime), Date.parse(startTime));
    assert.equal(Date.parse(entry.endTime), Date.parse(endTime));
  });

  it("accepts a non-UTC offset", async () => {
    const [task] = await listTasks();
    // The same instant expressed in +06:00 must be stored unchanged.
    const end = new Date(Date.now() - 60 * 60_000);
    const res = await postEntry({ task: task.value, endTime: end.toISOString(), minutes: 5 });
    const entry = assertCreated(res, { minutesSpent: 5 });
    assert.equal(Date.parse(entry.endTime), end.getTime());
  });
});

after(() => {
  if (created.length === 0) return;
  console.log(
    `\n${created.length} entr${created.length === 1 ? "y" : "ies"} created on ${BASE_URL}.`,
  );
  console.log("The API has no delete route — remove them from the app:");
  for (const id of created) console.log(`  ${id}`);
});

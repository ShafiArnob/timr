import type { Metadata } from "next";
import Link from "next/link";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_SESSION_HOURS } from "@/lib/time-entries";
import { CodeBlock, CodeTabs, CopyValue } from "./code-block";
import {
  arduinoSketch,
  curlSnippet,
  cydSketch,
  micropythonSnippet,
} from "./snippets";

export const metadata: Metadata = {
  title: "API docs",
  description: "Log time from a device or script with an API key.",
};

/** Where the API actually answers, when nothing else says otherwise. */
const PRODUCTION_ORIGIN = "https://timr0.vercel.app";

/**
 * These snippets get pasted into firmware, so they must quote an origin the
 * device can reach — deliberately *not* the host serving the page. Reading the
 * docs from `next dev` would otherwise hand an ESP32 a localhost URL that
 * resolves to the board itself.
 *
 * An explicit NEXT_PUBLIC_APP_URL wins, so a custom domain needs no code
 * change. Otherwise Vercel's production domain, which stays stable on preview
 * deployments rather than drifting to a per-deploy URL.
 */
function resolveOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;

  return PRODUCTION_ORIGIN;
}

type Param = {
  name: string;
  type: string;
  required: string;
  description: string;
};

function ParamTable({ params }: { params: Param[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="w-40">Field</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-28">Required</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {params.map((param) => (
            <TableRow key={param.name}>
              <TableCell className="font-mono text-xs">{param.name}</TableCell>
              <TableCell className="text-muted-foreground">{param.type}</TableCell>
              <TableCell className="text-muted-foreground">
                {param.required}
              </TableCell>
              <TableCell>{param.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Sits inside the accordion trigger, which renders a `<button>` — so every
 * element here has to be phrasing content, no divs.
 */
function Endpoint({
  method,
  path,
  summary,
}: {
  method: string;
  path: string;
  summary: string;
}) {
  return (
    <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-4">
      <Badge variant={method === "GET" ? "secondary" : "default"}>{method}</Badge>
      <code className="font-mono text-sm">{path}</code>
      <span className="font-normal text-muted-foreground">{summary}</span>
    </span>
  );
}

const CREATE_PARAMS: Param[] = [
  {
    name: "taskId",
    type: "string",
    required: "One of",
    description: "Task id, as returned by GET /api/v1/tasks.",
  },
  {
    name: "task",
    type: "string",
    required: "One of",
    description:
      "Task value or label instead of an id, matched without case sensitivity. Easier to hardcode in firmware than a generated id.",
  },
  {
    name: "minutes",
    type: "integer",
    required: "Conditional",
    description: "How long the session lasted, 1 to 1440.",
  },
  {
    name: "seconds",
    type: "integer",
    required: "Conditional",
    description:
      "Same as minutes, but in the unit a millis() delta gives you. Rounded to the nearest minute, so anything under 30 seconds is rejected.",
  },
  {
    name: "startTime",
    type: "string",
    required: "Conditional",
    description: "ISO 8601 instant with a UTC offset, e.g. 2026-07-25T09:00:00Z.",
  },
  {
    name: "endTime",
    type: "string",
    required: "Conditional",
    description: "ISO 8601 instant with a UTC offset.",
  },
];

const ERRORS = [
  {
    status: "400",
    code: "invalid_request",
    when: "The body isn't JSON, a field is the wrong shape, or the times don't make a valid session.",
  },
  {
    status: "401",
    code: "unauthorized",
    when: "No key was sent, or the key is unknown, revoked, or expired.",
  },
  {
    status: "404",
    code: "not_found",
    when: "No task on your account matches the taskId or task you sent.",
  },
  {
    status: "405",
    code: "—",
    when: "Wrong HTTP method for the route. Answered by the framework, with an empty body.",
  },
  {
    status: "500",
    code: "server_error",
    when: "Something failed on our side. The request was not saved — retry.",
  },
];

const CREATE_REQUEST = `POST /api/v1/time-entries
Authorization: Bearer to_live_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "task": "deep-work",
  "minutes": 25
}`;

const CREATE_RESPONSE = `201 Created

{
  "id": "clx8f2k1a0001qz9r3m4n5p6q",
  "task": {
    "id": "clx8f0a2b0000qz9r1c2d3e4f",
    "value": "deep-work",
    "label": "Deep work",
    "color": "#6366f1"
  },
  "startTime": "2026-07-25T09:35:00.000Z",
  "endTime": "2026-07-25T10:00:00.000Z",
  "minutesSpent": 25,
  "status": "COMPLETED",
  "createdAt": "2026-07-25T10:00:00.123Z"
}`;

const TASKS_RESPONSE = `200 OK

{
  "tasks": [
    {
      "id": "clx8f0a2b0000qz9r1c2d3e4f",
      "value": "deep-work",
      "label": "Deep work",
      "color": "#6366f1"
    },
    {
      "id": "clx8f0a2b0002qz9r7g8h9i0j",
      "value": "meetings",
      "label": "Meetings",
      "color": "#f59e0b"
    }
  ]
}`;

/** What the sketch paints, so the screen is legible before anything is flashed. */
const CYD_LAYOUT = `320 x 240, landscape

┌──────────────────────────────────────────────┐
│ o deep-work                           ONLINE │  selected task · link state
├──────────────────────────────────────────────┤
│                                              │
│                   00:12:34                   │  7-segment font, glows while running
│                   RECORDING                  │  RECORDING · PAUSED · STOPWATCH
├──────────────────────────────────────────────┤
│   DEEP    │   MEET   │   BACK   │   REVIEW   │  task pads, amber = picked
├──────────────────────────────────────────────┤
│    START     │    PAUSE     │      STOP      │  STOP posts the session
└──────────────────────────────────────────────┘`;

const ERROR_RESPONSE = `{
  "error": {
    "code": "invalid_request",
    "message": "Send exactly one of 'taskId' or 'task'."
  }
}`;

export default async function Page() {
  const origin = resolveOrigin();

  return (
    <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>API docs</CardTitle>
          <CardDescription>
            Log time from a microcontroller, script, or anything else that can
            speak HTTP. Everything is JSON in, JSON out, authenticated with an
            API key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Base URL</p>
            <CopyValue value={origin} label="Copy base URL" />
          </div>
          <p className="text-sm text-muted-foreground">
            The API is meant for devices and servers, so no cross-origin headers
            are sent — calling it from browser JavaScript on another site will be
            blocked. Create and revoke keys on the{" "}
            <Link href="/api" className="underline underline-offset-3">
              API keys
            </Link>{" "}
            page.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>
            Send your key on every request. It is checked against a hash, so a
            lost key can only be replaced — never recovered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock code={`Authorization: Bearer to_live_xxxxxxxxxxxxxxxx`} />
          <p className="text-sm text-muted-foreground">
            If your HTTP stack makes that header awkward, the same value is
            accepted as <code className="font-mono text-xs">X-API-Key</code>.
            Requests without a usable key get a{" "}
            <code className="font-mono text-xs">401</code>, and the response
            doesn&apos;t distinguish between an unknown, revoked, and expired key.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>
            Two calls: one to log time, one to find out what you can log against.
            Open a section for the full contract.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* hiddenUntilFound keeps closed panels searchable, so Ctrl+F for a
              field name still lands on it. */}
          <Accordion defaultValue={["time-entries"]} hiddenUntilFound>
            <AccordionItem value="time-entries">
              <AccordionTrigger>
                <Endpoint
                  method="POST"
                  path="/api/v1/time-entries"
                  summary="Log one completed session"
                />
              </AccordionTrigger>
              <AccordionContent className="space-y-6 pb-6">
                <p className="text-sm text-muted-foreground">
                  Creates one completed time entry on your account. Entries are
                  saved as already finished, so posting never clashes with a
                  timer running in the browser.
                </p>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Body</h3>
                  <ParamTable params={CREATE_PARAMS} />
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Choosing the time span</h3>
                  <p className="text-sm text-muted-foreground">
                    Send a duration, a pair of instants, or a duration anchored
                    to one instant — whichever your device can actually measure.
                  </p>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    <li>
                      <code className="font-mono text-xs">minutes</code> or{" "}
                      <code className="font-mono text-xs">seconds</code> on their
                      own — the entry ends now and starts that long ago. Best for
                      a board that has no idea what time it is.
                    </li>
                    <li>
                      a duration plus{" "}
                      <code className="font-mono text-xs">startTime</code> — the
                      entry ends that long after the start.
                    </li>
                    <li>
                      a duration plus{" "}
                      <code className="font-mono text-xs">endTime</code> — the
                      entry starts that long before the end.
                    </li>
                    <li>
                      <code className="font-mono text-xs">startTime</code> and{" "}
                      <code className="font-mono text-xs">endTime</code> — the
                      span between them. Don&apos;t also send a duration; the two
                      can disagree, so the request is rejected instead of
                      guessing.
                    </li>
                  </ul>
                  <p className="text-sm text-muted-foreground">
                    Time is stored in whole minutes. A session can&apos;t be
                    longer than {MAX_SESSION_HOURS} hours or end more than a
                    minute in the future, and instants must carry a UTC offset —
                    without one there is no way to know which clock you meant.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Request</h3>
                    <CodeBlock code={CREATE_REQUEST} />
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Response</h3>
                    <CodeBlock code={CREATE_RESPONSE} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tasks">
              <AccordionTrigger>
                <Endpoint
                  method="GET"
                  path="/api/v1/tasks"
                  summary="List what you can log against"
                />
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-6">
                <p className="text-sm text-muted-foreground">
                  Lists the tasks you can log against, in the order they appear
                  in the app. It takes no parameters, which also makes it the
                  cheapest way for a device to check its key at boot.
                </p>
                <CodeBlock code={TASKS_RESPONSE} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Errors</CardTitle>
          <CardDescription>
            Failures come back with the same envelope. Branch on{" "}
            <code className="font-mono text-xs">error.code</code> rather than the
            message — codes are stable, wording isn&apos;t.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock code={ERROR_RESPONSE} />
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="w-40">Code</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ERRORS.map((error) => (
                  <TableRow key={error.status}>
                    <TableCell className="font-mono text-xs">
                      {error.status}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {error.code}
                    </TableCell>
                    <TableCell>{error.when}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>
            A button wired to GPIO 0 starts the timer on the first press and logs
            the session on the second. Replace the credentials and the task, and
            it runs as-is.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeTabs
            tabs={[
              {
                value: "arduino",
                label: "ESP32 (Arduino)",
                code: arduinoSketch(origin),
              },
              {
                value: "micropython",
                label: "MicroPython",
                code: micropythonSnippet(origin),
              },
              { value: "curl", label: "curl", code: curlSnippet(origin) },
            ]}
          />
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Prefer <code className="font-mono text-xs">seconds</code> over
              timestamps unless the board syncs its clock over NTP. The server
              stamps the instants, so an unset RTC can&apos;t skew your history.
            </li>
            <li>
              <code className="font-mono text-xs">setInsecure()</code> skips
              certificate validation — quick to get working, but anyone on the
              path can read the key. Pin a root CA with{" "}
              <code className="font-mono text-xs">setCACert()</code> for anything
              you leave running.
            </li>
            <li>
              A successful create returns{" "}
              <code className="font-mono text-xs">201</code>. Treat{" "}
              <code className="font-mono text-xs">5xx</code> and network errors as
              retryable; a <code className="font-mono text-xs">4xx</code> will
              fail the same way every time, so log it and move on.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build the timer as a device</CardTitle>
          <CardDescription>
            A full sketch for the ESP32 &ldquo;Cheap Yellow Display&rdquo;
            (ESP32-2432S028R) that rebuilds the{" "}
            <Link href="/timer" className="underline underline-offset-3">
              timer console
            </Link>{" "}
            on its touchscreen — same amber-on-dark palette, same task pads and
            START / PAUSE / STOP transport.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CodeBlock code={CYD_LAYOUT} />
          <Accordion>
            <AccordionItem value="cyd">
              <AccordionTrigger>
                <span className="flex flex-1 items-center gap-3 pr-4">
                  <Badge variant="secondary">C++</Badge>
                  <span>ESP32-2432S028R sketch</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-6">
                <CodeBlock code={cydSketch(origin)} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Needs <code className="font-mono text-xs">TFT_eSPI</code> and{" "}
              <code className="font-mono text-xs">XPT2046_Touchscreen</code>. The
              header comment carries the whole{" "}
              <code className="font-mono text-xs">User_Setup.h</code> for this
              panel.
            </li>
            <li>
              Leave <code className="font-mono text-xs">TOUCH_CS</code> undefined.
              The CYD wires its touch controller to a second set of pins, so
              TFT_eSPI&apos;s built-in touch can&apos;t reach it — that mismatch
              is the usual reason one of these draws fine but ignores every tap.
            </li>
            <li>
              The session is held on the device and posted once, on STOP. Nothing
              to reconcile if the board reboots mid-session, and no clock needed —
              though an unsaved session is lost, which is the trade for not
              keeping server state.
            </li>
            <li>
              Countdown presets are left out; the sketch is a stopwatch, which is
              all this API records.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

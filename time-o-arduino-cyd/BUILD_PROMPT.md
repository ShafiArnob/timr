# Build prompt — Time-O timer console on the ESP32 CYD

Paste everything below into Claude Code from inside `time-o-arduino-cyd/`.

---

## What to build

Turn this PlatformIO project into a physical version of the Time-O **Timer** page: a
touchscreen stopwatch/countdown console that logs finished sessions to the Time-O API
over WiFi.

Replace `src/main.cpp` with the full firmware. Split into headers under `src/` if it
helps, but a single well-sectioned `main.cpp` is acceptable and preferred for a first
version.

---

## The board — these facts are verified on the real hardware, do not "fix" them

ESP32-2432S028R "Cheap Yellow Display", 320×240, landscape (`setRotation(1)`).

**The panel is ST7789, not ILI9341.** Some CYD guides (and Time-O's own API docs page)
say ILI9341 — that is wrong for this unit and produces a blank or garbled screen. The
working config is already in `include/User_Setup.h` and is pulled in by
`platformio.ini` via `-D USER_SETUP_LOADED=1 -include include/User_Setup.h`:

```c
#define ST7789_DRIVER
#define TFT_RGB_ORDER TFT_BGR     // without this, red and blue swap
#define TFT_WIDTH  240
#define TFT_HEIGHT 320
#define TFT_MISO 12
#define TFT_MOSI 13
#define TFT_SCLK 14
#define TFT_CS   15
#define TFT_DC    2
#define TFT_RST  -1
#define TFT_BL   21
#define TFT_BACKLIGHT_ON HIGH
#define USE_HSPI_PORT
```

Non-negotiable details that already cost debugging time:

- **`tft.invertDisplay(false)` immediately after `tft.init()`.** Without it the whole
  screen renders inverted.
- **Drive `TFT_BL` HIGH manually** (`pinMode(TFT_BL, OUTPUT)`) before `tft.init()`.
  This build does not light the backlight on its own.
- **`TOUCH_CS` is deliberately not defined in `User_Setup.h`.** The CYD wires its
  XPT2046 to a second pin set, so TFT_eSPI's built-in touch cannot reach it. Touch runs
  on its own `SPIClass(VSPI)`:
  ```c
  #define XPT2046_IRQ  36
  #define XPT2046_MOSI 32
  #define XPT2046_MISO 39
  #define XPT2046_CLK  25
  #define XPT2046_CS   33
  ```
  The display is on HSPI, so the two buses never collide.
- **Touch calibration, already validated on this unit:**
  `map(p.x, 200, 3700, 0, 320)` and `map(p.y, 240, 3800, 0, 240)`, with `ts.setRotation(1)`.
  Keep these as named constants so they are easy to nudge later.
- `TFT_RGB_ORDER` is handled inside the driver, so RGB565 literals below are ordinary
  RGB — do not byte-swap them.

The current `src/main.cpp` is a hardware smoke test (draws a cyan dot where you tap).
Keep a way to get that back — a `#define TOUCH_DEBUG` that prints raw and mapped
coordinates to serial is enough.

`platformio.ini` already has TFT_eSPI and XPT2046_Touchscreen. Add `bblanchon/ArduinoJson`
for parsing the task list.

---

## The API

Base URL: `https://timr0.vercel.app`

Auth on every request — either header works:

```
Authorization: Bearer to_live_xxxxxxxxxxxxxxxx
X-API-Key: to_live_xxxxxxxxxxxxxxxx
```

Keys are issued in the app under **API**, shown once at creation. TLS: `WiFiClientSecure`
with `setInsecure()` is fine for now; leave a comment marking it as the thing to replace
with a pinned root CA before this leaves the bench.

### `GET /api/v1/tasks`

Lists the tasks a session can be logged against, in the user's own manual order. Also the
cheapest way to verify the key at boot.

```json
{ "tasks": [ { "id": "clx…", "value": "deep-work", "label": "Deep Work", "color": "#7dd3fc" } ] }
```

`color` is always a `#rrggbb` hex string from a fixed pastel palette.

### `POST /api/v1/time-entries`

Creates **one already-completed entry**. `Content-Type: application/json`.

Send **exactly one** task selector:

| Field | Notes |
|---|---|
| `task` | Matched case-insensitively against a task's `value` **or** `label`. Prefer this — firmware ships readable names instead of generated ids. |
| `taskId` | The `id` from `GET /api/v1/tasks`. |

And **exactly one** way of expressing the window:

| Field | Notes |
|---|---|
| `seconds` | Integer, 1–86400. Server stamps `endTime` = now and `startTime` = now − span. **Use this.** |
| `minutes` | Integer, 1–1440. Same behaviour. |
| `startTime` + `endTime` | ISO 8601 **with a UTC offset** (`2026-07-25T14:00:00Z`). Requires a synced clock. |

Sending a duration *and* both timestamps is a 400 — they can disagree, and the server
will not guess.

`seconds` is rounded to whole minutes for storage, so **anything under 30 seconds rounds
to zero and is rejected** with `"A session has to be at least 30 seconds long."` The
device should refuse to send those itself rather than take the round trip.

Success is **201**:

```json
{
  "id": "clx…",
  "task": { "id": "clx…", "value": "deep-work", "label": "Deep Work", "color": "#7dd3fc" },
  "startTime": "2026-07-25T13:35:00.000Z",
  "endTime": "2026-07-25T14:00:00.000Z",
  "minutesSpent": 25,
  "status": "COMPLETED",
  "createdAt": "2026-07-25T14:00:01.412Z"
}
```

### Errors

Every failure has the same envelope. Branch on `code`, never on the prose:

```json
{ "error": { "code": "invalid_request", "message": "Send exactly one of 'taskId' or 'task'." } }
```

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | Missing, revoked, expired, or unknown key. Also sends `WWW-Authenticate: Bearer`. |
| `invalid_request` | 400 | Malformed JSON, unknown field, bad or contradictory duration. |
| `not_found` | 404 | No task matches the `task` or `taskId` sent. |
| `server_error` | 500 | Retry. |

The API deliberately gives the same message for a revoked, expired, and unknown key — do
not try to distinguish them on the device.

Entries always land as `COMPLETED`, so the device can post while a timer runs in a
browser without colliding with the app's one-active-timer rule.

**There is no start / pause / resume endpoint.** Those exist only as server actions
behind a session cookie in the web app. The device owns its session entirely in RAM and
makes exactly one HTTP call, on STOP. That means a reboot mid-session loses it, and
that is the accepted trade — nothing to reconcile, no clock needed.

---

## The UI to reproduce

The web Timer is a retro amber console: dark warm background, 2px rules, dotted-LED
clock, amber-on-dark pads that invert to dark-on-amber when selected.

### Palette — already converted from the app's oklch tokens, use verbatim

```c
#define C_BG    0x1040  // --retro-bg    console background
#define C_CELL  0x1881  // --retro-cell  hover / unselected pad fill
#define C_LINE  0x4163  // --retro-line  2px rules, disabled text
#define C_DIM   0x8B6A  // --retro-dim   secondary text, unselected pad text
#define C_AMBER 0xFD07  // --retro-amber primary text, selected pad fill
#define C_GLOW  0xFE05  // --retro-glow  the clock while running
```

### Layout

The web console is two columns on wide screens and stacks into horizontal bands on
narrow ones. 320px is narrow, so build the stacked form. Recommended geometry, summing
exactly to 240 rows (2px rules between bands, drawn in `C_LINE`):

| Band | y | Height | Contents |
|---|---|---|---|
| Header | 0 | 18 | Selected task dot + name (left, font 2, `C_AMBER`) · `ONLINE`/`OFFLINE` (right, font 2, `C_AMBER`/`C_LINE`) |
| Clock | 20 | 82 | `HH:MM:SS` centred, **font 7**, `C_GLOW` while running else `C_AMBER` |
| Status | 102 | 20 | Centred, font 2, `C_DIM`, uppercase |
| Task pads | 124 | 38 | 4 across, 80px each, font 2 |
| Preset pads | 164 | 30 | 4 across, 80px each, font 2 |
| Transport | 196 | 44 | START · PAUSE/RESUME · STOP, ~106px each, font 4 |

Font 7 is TFT_eSPI's 7-segment face — digits and colon only, which is exactly the clock
and is the closest available stand-in for the web app's dotted `bpdots` font. Everything
else uses fonts 2 and 4.

### States and text

Status line, mirroring the web app exactly:

| State | Status text |
|---|---|
| Idle, no preset | `STOPWATCH` |
| Idle, preset selected | `TIMER · 30M` (the selected preset) |
| Running, no preset | `RECORDING` |
| Running, preset selected | `COUNTING DOWN` |
| Paused | `PAUSED` |

Transient messages take over the status line for ~2.5s, then it reverts: `SAVING`,
`SAVED`, `SAVE FAILED`, `TOO SHORT`, `STOP FIRST`, `TIME'S UP`.

Pad appearance:

- **Selected**: fill `C_AMBER`, text `C_BG`.
- **Unselected and enabled**: fill `C_CELL`, text `C_DIM`.
- **Unselected and locked** (a session is running): text `C_LINE` — the web app dims
  these to 40%.
- Each task pad carries a thin bar in that task's own colour, parsed from the API's
  `#rrggbb` into RGB565.
- Fewer than 4 tasks: remaining pads render a single `·` in `C_LINE`, like the web grid.

Transport buttons: label in `C_AMBER` when enabled, `C_LINE` when disabled. START is
enabled only when idle **and** a task is selected. PAUSE/STOP only when not idle. The
middle button reads `RESUME` while paused.

---

## Behaviour

**Boot**
1. Backlight, `tft.init()`, `invertDisplay(false)`, rotation 1, touch on VSPI.
2. Splash: `TIME-O` (font 4, amber) over a status line (font 2, dim).
3. Connect WiFi with a ~20s deadline. Do not block forever — the console must run
   offline, only saving needs the network.
4. `GET /api/v1/tasks`. Take the **first four** in the order returned (that is the user's
   manual order, same four the web console shows). Store `value`, `label`, `color`.
   - 401 → splash `CHECK API KEY` and halt with a clear serial message. A bad key is a
     config error, not a transient one.
   - Offline or any other failure → fall back to a compiled-in task list at the top of
     the file, and mark the header `OFFLINE`.
5. Draw the console.

**Task pads** select the task to log against. Locked while a session is running or
paused — switching mid-session would detach the timer from what is being recorded. Tapping
a locked pad flashes `STOP FIRST`. Selecting a task redraws the header dot and name.

**Preset pads** are `15m`, `30m`, `45m`, `1h` (60 minutes renders as `1h`, matching the web
app's formatter). Selecting one turns the console into a countdown; **tapping the lit
preset again returns to stopwatch mode**. Locked once a session starts — moving the finish
line under a running countdown is not allowed.

**START** (idle only, task required) begins the session. **PAUSE** banks the elapsed time
and stops the clock; **RESUME** starts a new segment. Elapsed time is always
`banked + (running ? millis() - runningSince : 0)`, computed in **unsigned** arithmetic so
it survives the `millis()` rollover at ~49 days.

**Clock display**: stopwatch counts up from `00:00:00`; countdown shows time *remaining*
(`target − elapsed`). Redraw at ~200ms, and only when the rendered string actually
changed — use `setTextPadding` so shrinking strings do not leave crumbs behind.

**STOP** ends the session and posts it:
- Under 30 seconds → flash `TOO SHORT`, discard, no request.
- Otherwise paint `SAVING` **before** the call (`HTTPClient` blocks for a second or
  more), then `POST /api/v1/time-entries` with `{"task":"<value>","seconds":<n>}`.
- 201 → `SAVED`. Anything else → `SAVE FAILED`, and print status + body to serial. Retry
  up to 3 times with a short backoff on 5xx or a transport error; do not retry 4xx.
- Return to idle either way.

**Countdown reaching zero** behaves like the web app's alarm: stop immediately, post the
**full preset duration** (not the measured elapsed), flash `TIME'S UP`, return to idle.
Guard against firing twice on back-to-back ticks. If the board has a buzzer wired, three
short beeps; otherwise flash the clock colour between `C_GLOW` and `C_AMBER` a few times.

**Touch** fires once per press, on the touch-down edge — latch a flag so holding a
finger down does not repeat. Gate on `ts.tirqTouched() && ts.touched()`.

**WiFi** is re-checked every few seconds; on a state change update the header and call
`WiFi.reconnect()` when it drops. Never block the console on the network.

---

## Constraints

- Arduino framework on PlatformIO, C++. Compile clean with no warnings.
- No dynamic `String` churn in the draw path — fixed `char` buffers and `snprintf`.
- `loop()` must never block for more than a few ms except during the single POST on STOP.
- Every literal that could reasonably need changing (WiFi, API key, base URL, calibration,
  fallback tasks, minimum session length) goes in one clearly marked config block at the
  top.
- Comments explain *why*, not *what*. The hardware quirks above are exactly what deserves
  a comment.

**Out of scope** — do not build these:
- Persisting sessions to NVS or an offline queue.
- NTP / absolute timestamps. Duration-only posting is the design.
- Editing or deleting entries from the device.
- OTA updates, a captive portal, or a WiFi setup UI.

---

## Done when

- `pio run` builds clean.
- The console draws correctly on the ST7789 panel: right way up, correct colours, no
  inversion, no leftover pixels as the clock ticks.
- Taps land on the pad they appear to hit in all four corners.
- A ≥30s session tapped out on the device shows `SAVED` and appears on the Time-O
  dashboard with the right task and duration.
- A sub-30s session shows `TOO SHORT` and sends nothing.
- Pulling the WiFi mid-session still lets the console run; STOP shows `SAVE FAILED`
  rather than hanging or rebooting.
- A wrong API key stops at the splash with a clear message instead of failing silently
  at the first save.

Tell me anything you had to guess at, and flag anything you could not verify without the
hardware in hand.

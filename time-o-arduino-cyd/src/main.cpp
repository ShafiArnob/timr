/* =============================================================================
   Time-O timer console — ESP32-2432S028R "Cheap Yellow Display", 320x240

   A physical version of the Time-O Timer page: stopwatch / countdown on a
   touchscreen, posting each finished session to the Time-O API.

   The device owns its session entirely in RAM and makes exactly one HTTP call,
   on STOP. There is no start/pause/resume endpoint — those are cookie-backed
   server actions in the web app — so a reboot mid-session loses it. In exchange
   there is nothing to reconcile and no clock to sync.
   ============================================================================= */

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

/* =============================================================================
   CONFIG — everything you might reasonably need to change lives here

   Credentials are the exception: WIFI_SSID, WIFI_PASSWORD, API_BASE and API_KEY
   live in include/secrets.h, which is gitignored. Copy secrets.example.h to
   secrets.h and fill it in.
   ============================================================================= */

#if defined(__has_include)
#  if __has_include("secrets.h")
#    include "secrets.h"
#  else
#    error "Missing include/secrets.h - copy include/secrets.example.h to include/secrets.h and fill in your credentials."
#  endif
#else
#  include "secrets.h"
#endif

#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD) || !defined(API_BASE) || !defined(API_KEY)
#  error "include/secrets.h must define WIFI_SSID, WIFI_PASSWORD, API_BASE and API_KEY."
#endif

// Sessions shorter than this are discarded on-device. The server rounds seconds
// to whole minutes, so anything under 30s would round to zero and come back 400.
#define MIN_SESSION_SEC   30

#define WIFI_CONNECT_TIMEOUT_MS  20000UL  // boot deadline; console runs offline
#define WIFI_CHECK_MS             3000UL  // header ONLINE/OFFLINE refresh
#define WIFI_RECONNECT_MS        15000UL  // don't thrash reconnect(); it disconnects first
#define HTTP_CONNECT_TIMEOUT_MS   6000
#define HTTP_TIMEOUT_MS           8000
#define POST_MAX_ATTEMPTS            3
#define POST_BACKOFF_MS            400

// Touch calibration, validated on this unit. Nudge if taps land off-target.
#define TOUCH_X_MIN   200
#define TOUCH_X_MAX  3700
#define TOUCH_Y_MIN   240
#define TOUCH_Y_MAX  3800

// Set to 1 to get the old smoke-test behaviour back: raw + mapped coords on serial.
#define TOUCH_DEBUG 0

// The CYD has a speaker pad on GPIO26, but nothing is wired by default, so the
// alarm falls back to flashing the clock. Set to 1 if you have solders on it.
#define USE_BUZZER 0
#define BUZZER_PIN 26

// Used when the task fetch fails (offline, or any non-401 error). These `value`
// strings are what gets POSTed, so they must match real task values/labels on
// the server or a save made while running on the fallback list will 404.
#define FALLBACK_TASK_COUNT 4
static const char *FALLBACK_VALUE[FALLBACK_TASK_COUNT] = {
    "deep-work", "meetings", "learning", "admin"};
static const char *FALLBACK_LABEL[FALLBACK_TASK_COUNT] = {
    "Deep Work", "Meetings", "Learning", "Admin"};
static const char *FALLBACK_COLOR[FALLBACK_TASK_COUNT] = {
    "#7dd3fc", "#fca5a5", "#a7f3d0", "#fcd34d"};

/* =============================================================================
   HARDWARE — verified on this board, do not "fix"
   ============================================================================= */

// TOUCH_CS is deliberately absent from User_Setup.h: the CYD wires its XPT2046
// to a second pin set that TFT_eSPI's built-in touch cannot reach. The panel is
// on HSPI (USE_HSPI_PORT), touch gets VSPI to itself, so the buses never collide.
#define XPT2046_IRQ  36
#define XPT2046_MOSI 32
#define XPT2046_MISO 39
#define XPT2046_CLK  25
#define XPT2046_CS   33

static TFT_eSPI tft = TFT_eSPI();
static SPIClass touchSPI(VSPI);
static XPT2046_Touchscreen ts(XPT2046_CS, XPT2046_IRQ);

/* =============================================================================
   PALETTE — the web console's oklch tokens, pre-converted to RGB565.
   TFT_RGB_ORDER is handled inside the driver, so these are ordinary RGB.
   ============================================================================= */

#define C_BG    0x1040  // --retro-bg    console background
#define C_CELL  0x1881  // --retro-cell  unselected pad fill
#define C_LINE  0x4163  // --retro-line  2px rules, disabled text
#define C_DIM   0x8B6A  // --retro-dim   secondary text, unselected pad text
#define C_AMBER 0xFD07  // --retro-amber primary text, selected pad fill
#define C_GLOW  0xFE05  // --retro-glow  the clock while running

/* =============================================================================
   LAYOUT — the web console's stacked (narrow) form. Bands sum to exactly 240.
   ============================================================================= */

#define SCR_W 320
#define SCR_H 240

#define HEADER_Y    0
#define HEADER_H   18
#define CLOCK_Y    20
#define CLOCK_H    82
#define STATUS_Y  102
#define STATUS_H   20
#define TASK_Y    124
#define TASK_H     38
#define PRESET_Y  164
#define PRESET_H   30
#define TRANS_Y   196
#define TRANS_H    44

#define RULE_H 2

#define PAD_COLS   4
#define PAD_W     80
#define PAD_INSET  1   // 2px of background between neighbours reads as a gutter

// Transport: three cells with 2px rules between them, summing to 320. The middle
// cell is the wide one because "RESUME" is 104px in font 4 — an even 105px split
// would leave it zero margin.
static const int16_t TRANS_X[3] = {0, 102, 220};
static const int16_t TRANS_W[3] = {100, 116, 100};
#define TRANS_RULE1_X 100
#define TRANS_RULE2_X 218

#define MAX_TASKS 4

static const uint16_t PRESET_MIN[PAD_COLS] = {15, 30, 45, 60};
// 60 minutes renders as "1h", matching the web app's duration formatter.
static const char *PRESET_LABEL[PAD_COLS] = {"15m", "30m", "45m", "1h"};
static const char *PRESET_LABEL_UC[PAD_COLS] = {"15M", "30M", "45M", "1H"};

/* =============================================================================
   STATE
   ============================================================================= */

struct Task {
  char value[40];   // POSTed as "task"; matched case-insensitively server-side
  char label[24];
  uint16_t color;
};

static Task tasks[MAX_TASKS];
static int taskCount = 0;

enum RunState { ST_IDLE, ST_RUNNING, ST_PAUSED };
static RunState state = ST_IDLE;

static int selectedTask = -1;   // -1 = none
static int selectedPreset = -1; // -1 = stopwatch mode

// Session timing. Unsigned throughout so it survives the millis() rollover at
// ~49 days: (millis() - runSince) stays correct across the wrap.
static uint32_t sessionBankedMs = 0;
static uint32_t sessionRunSince = 0;
static bool alarmFired = false;  // countdown fires once, not on every tick

static bool online = false;
static bool usingFallbackTasks = false;

// Transient status messages take the status line for ~2.5s, then it reverts.
#define FLASH_MS 2500UL
static char flashMsg[24] = "";
static uint32_t flashStart = 0;

// Non-blocking alarm flash, so loop() never stalls on an animation.
#define ALARM_BLINKS       3
#define ALARM_TOGGLE_MS  150UL
static uint8_t alarmBlinksLeft = 0;
static uint32_t alarmToggleAt = 0;
static bool alarmBright = false;

// Redraw memos — the clock repaints at 5Hz, everything else only on change.
static char lastClock[12] = "";
static uint16_t lastClockColor = 0;
static char lastStatus[32] = "";

static uint32_t lastClockTick = 0;
static uint32_t lastWifiCheck = 0;
static uint32_t lastReconnect = 0;

// Touch edge latch. tirqTouched() stays true for as long as a finger is down,
// so a plain level test would repeat; the release timeout debounces the lift.
#define TOUCH_RELEASE_MS 60UL
static bool touchLatched = false;
static uint32_t lastTouchDown = 0;

/* =============================================================================
   SMALL HELPERS
   ============================================================================= */

static uint16_t hexToRGB565(const char *hex) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return C_DIM;
  long v = strtol(hex + 1, nullptr, 16);
  uint8_t r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

// Pads are 80px wide, so long task names have to give somewhere.
static void fitLabel(char *dst, size_t dstSize, const char *src, int16_t maxW, uint8_t font) {
  strlcpy(dst, src, dstSize);
  while (dst[0] != '\0' && tft.textWidth(dst, font) > maxW) dst[strlen(dst) - 1] = '\0';
}

static void drawCentered(const char *s, int16_t cx, int16_t cy, uint8_t font,
                         uint16_t fg, uint16_t bg) {
  tft.setTextDatum(MC_DATUM);
  tft.setTextPadding(0);
  tft.setTextColor(fg, bg);
  tft.drawString(s, cx, cy, font);
}

static bool sessionActive() { return state != ST_IDLE; }

// The header reports whether a save can actually be trusted, not just whether the
// radio is up: on the fallback task list the values are unverified against the
// server, so it stays OFFLINE even once WiFi comes back.
static bool headerOnline() { return online && !usingFallbackTasks; }

static uint32_t elapsedMs() {
  uint32_t e = sessionBankedMs;
  if (state == ST_RUNNING) e += (uint32_t)(millis() - sessionRunSince);
  return e;
}

static uint32_t targetMs() {
  return selectedPreset < 0 ? 0UL : (uint32_t)PRESET_MIN[selectedPreset] * 60000UL;
}

/* =============================================================================
   DRAWING
   ============================================================================= */

static void drawChrome() {
  tft.fillScreen(C_BG);
  tft.fillRect(0, HEADER_Y + HEADER_H, SCR_W, RULE_H, C_LINE);
  tft.fillRect(0, STATUS_Y + STATUS_H, SCR_W, RULE_H, C_LINE);
  tft.fillRect(0, TASK_Y + TASK_H, SCR_W, RULE_H, C_LINE);
  tft.fillRect(0, PRESET_Y + PRESET_H, SCR_W, RULE_H, C_LINE);
  // Vertical rules between the three transport cells.
  tft.fillRect(TRANS_RULE1_X, TRANS_Y, RULE_H, TRANS_H, C_LINE);
  tft.fillRect(TRANS_RULE2_X, TRANS_Y, RULE_H, TRANS_H, C_LINE);
}

static void drawHeader() {
  tft.fillRect(0, HEADER_Y, SCR_W, HEADER_H, C_BG);
  const int16_t cy = HEADER_Y + HEADER_H / 2;

  char name[24];
  uint16_t dot, fg;
  if (selectedTask >= 0) {
    dot = tasks[selectedTask].color;
    fg = C_AMBER;
    fitLabel(name, sizeof name, tasks[selectedTask].label, 200, 2);
  } else {
    dot = C_LINE;
    fg = C_DIM;
    strlcpy(name, "SELECT TASK", sizeof name);
  }
  tft.fillCircle(8, cy, 3, dot);

  tft.setTextDatum(ML_DATUM);
  tft.setTextPadding(0);
  tft.setTextColor(fg, C_BG);
  tft.drawString(name, 16, cy, 2);

  const bool up = headerOnline();
  tft.setTextDatum(MR_DATUM);
  tft.setTextColor(up ? C_AMBER : C_LINE, C_BG);
  tft.drawString(up ? "ONLINE" : "OFFLINE", SCR_W - 6, cy, 2);
}

static void drawClock(bool force) {
  uint32_t showSec;
  if (selectedPreset >= 0) {
    const uint32_t t = targetMs(), e = elapsedMs();
    // Round up, so a fresh 30m countdown reads 00:30:00 rather than 00:29:59.
    showSec = (e >= t) ? 0UL : (t - e + 999UL) / 1000UL;
  } else {
    showSec = elapsedMs() / 1000UL;
  }

  uint32_t h = showSec / 3600UL;
  if (h > 99) h = 99;  // the field is two digits wide

  char buf[12];
  snprintf(buf, sizeof buf, "%02u:%02u:%02u", (unsigned)h,
           (unsigned)((showSec / 60UL) % 60UL), (unsigned)(showSec % 60UL));

  uint16_t fg;
  if (alarmBlinksLeft > 0) fg = alarmBright ? C_GLOW : C_AMBER;
  else fg = (state == ST_RUNNING) ? C_GLOW : C_AMBER;

  if (!force && fg == lastClockColor && strcmp(buf, lastClock) == 0) return;
  strlcpy(lastClock, buf, sizeof lastClock);
  lastClockColor = fg;

  // Font 7 is the 7-segment face: digits are 32px, the colon 12px, so the
  // string is a fixed 216px. Padding wider than that lets TFT_eSPI erase the
  // previous frame itself — a fillRect here would flicker at 5Hz.
  tft.setTextDatum(MC_DATUM);
  tft.setTextPadding(240);
  tft.setTextColor(fg, C_BG);
  tft.drawString(buf, SCR_W / 2, CLOCK_Y + CLOCK_H / 2, 7);
  tft.setTextPadding(0);
}

static void drawStatus() {
  char text[32];
  if (flashMsg[0] != '\0') {
    strlcpy(text, flashMsg, sizeof text);
  } else if (state == ST_PAUSED) {
    strlcpy(text, "PAUSED", sizeof text);
  } else if (state == ST_RUNNING) {
    strlcpy(text, selectedPreset >= 0 ? "COUNTING DOWN" : "RECORDING", sizeof text);
  } else if (selectedPreset >= 0) {
    // Marker for the middle dot, which font 2 (ASCII 32-127) cannot render.
    snprintf(text, sizeof text, "TIMER\x01%s", PRESET_LABEL_UC[selectedPreset]);
  } else {
    strlcpy(text, "STOPWATCH", sizeof text);
  }

  if (strcmp(text, lastStatus) == 0) return;
  strlcpy(lastStatus, text, sizeof lastStatus);

  tft.fillRect(0, STATUS_Y, SCR_W, STATUS_H, C_BG);
  const int16_t cy = STATUS_Y + STATUS_H / 2;

  char *sep = strchr(text, '\x01');
  if (sep == nullptr) {
    drawCentered(text, SCR_W / 2, cy, 2, C_DIM, C_BG);
    return;
  }

  // Two-part draw so we can put a real dot between the halves.
  *sep = '\0';
  const char *right = sep + 1;
  const int16_t gap = 14;
  const int16_t lw = tft.textWidth(text, 2), rw = tft.textWidth(right, 2);
  const int16_t x0 = (SCR_W - (lw + gap + rw)) / 2;

  tft.setTextDatum(ML_DATUM);
  tft.setTextPadding(0);
  tft.setTextColor(C_DIM, C_BG);
  tft.drawString(text, x0, cy, 2);
  tft.fillCircle(x0 + lw + gap / 2, cy, 2, C_DIM);
  tft.drawString(right, x0 + lw + gap, cy, 2);
}

// One pad in the 4-across grid. `locked` dims the text the way the web app
// drops unselected pads to 40% while a session runs.
static void drawPad(int16_t x, int16_t y, int16_t w, int16_t h, const char *label,
                    bool selected, bool locked, bool hasBar, uint16_t barColor) {
  const int16_t px = x + PAD_INSET, pw = w - 2 * PAD_INSET;
  tft.fillRect(px, y, pw, h, selected ? C_AMBER : C_CELL);

  int16_t textTop = y;
  int16_t textH = h;
  if (hasBar) {
    tft.fillRect(px + 4, y + 4, pw - 8, 3, barColor);
    textTop = y + 7;
    textH = h - 7;
  }

  if (label == nullptr) {  // empty grid cell
    tft.fillCircle(x + w / 2, y + h / 2, 2, C_LINE);
    return;
  }

  uint16_t bg = selected ? C_AMBER : C_CELL;
  uint16_t fg = selected ? C_BG : (locked ? C_LINE : C_DIM);

  char fitted[24];
  fitLabel(fitted, sizeof fitted, label, pw - 8, 2);
  drawCentered(fitted, x + w / 2, textTop + textH / 2, 2, fg, bg);
}

static void drawTaskPads() {
  const bool locked = sessionActive();
  for (int i = 0; i < PAD_COLS; i++) {
    const int16_t x = i * PAD_W;
    if (i < taskCount) {
      drawPad(x, TASK_Y, PAD_W, TASK_H, tasks[i].label, i == selectedTask, locked,
              true, tasks[i].color);
    } else {
      drawPad(x, TASK_Y, PAD_W, TASK_H, nullptr, false, true, false, 0);
    }
  }
}

static void drawPresetPads() {
  const bool locked = sessionActive();
  for (int i = 0; i < PAD_COLS; i++) {
    drawPad(i * PAD_W, PRESET_Y, PAD_W, PRESET_H, PRESET_LABEL[i],
            i == selectedPreset, locked, false, 0);
  }
}

static void drawTransport() {
  const bool canStart = (state == ST_IDLE) && (selectedTask >= 0);
  const bool active = sessionActive();
  const char *labels[3] = {"START", (state == ST_PAUSED) ? "RESUME" : "PAUSE", "STOP"};
  const bool enabled[3] = {canStart, active, active};

  for (int i = 0; i < 3; i++) {
    tft.fillRect(TRANS_X[i], TRANS_Y, TRANS_W[i], TRANS_H, C_BG);
    drawCentered(labels[i], TRANS_X[i] + TRANS_W[i] / 2, TRANS_Y + TRANS_H / 2, 4,
                 enabled[i] ? C_AMBER : C_LINE, C_BG);
  }
}

static void drawConsole() {
  drawChrome();
  drawHeader();
  drawStatus();
  drawClock(true);
  drawTaskPads();
  drawPresetPads();
  drawTransport();
}

static void showFlash(const char *msg) {
  strlcpy(flashMsg, msg, sizeof flashMsg);
  flashStart = millis();
  drawStatus();  // paint immediately — SAVING has to land before the POST blocks
}

static void splash(const char *line) {
  tft.fillScreen(C_BG);
  drawCentered("TIME-O", SCR_W / 2, 96, 4, C_AMBER, C_BG);
  drawCentered(line, SCR_W / 2, 136, 2, C_DIM, C_BG);
}

/* =============================================================================
   NETWORK
   ============================================================================= */

static void addAuth(HTTPClient &http) {
  http.addHeader("Authorization", "Bearer " API_KEY);
  http.addHeader("Accept", "application/json");
}

// TLS is unverified for now. Replace with setCACert() and a pinned root CA
// before this leaves the bench — setInsecure() accepts any certificate.
static void prepareClient(WiFiClientSecure &client, HTTPClient &http) {
  client.setInsecure();
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
}

static void loadFallbackTasks() {
  taskCount = FALLBACK_TASK_COUNT < MAX_TASKS ? FALLBACK_TASK_COUNT : MAX_TASKS;
  for (int i = 0; i < taskCount; i++) {
    strlcpy(tasks[i].value, FALLBACK_VALUE[i], sizeof tasks[i].value);
    strlcpy(tasks[i].label, FALLBACK_LABEL[i], sizeof tasks[i].label);
    tasks[i].color = hexToRGB565(FALLBACK_COLOR[i]);
  }
  usingFallbackTasks = true;
}

enum FetchResult { FETCH_OK, FETCH_UNAUTHORIZED, FETCH_FAILED };

static FetchResult fetchTasks() {
  if (WiFi.status() != WL_CONNECTED) return FETCH_FAILED;

  WiFiClientSecure client;
  HTTPClient http;
  prepareClient(client, http);

  if (!http.begin(client, API_BASE "/api/v1/tasks")) {
    Serial.println("tasks: http.begin failed");
    return FETCH_FAILED;
  }
  addAuth(http);

  const int code = http.GET();
  if (code == 401) {
    http.end();
    return FETCH_UNAUTHORIZED;
  }
  if (code != 200) {
    Serial.printf("tasks: HTTP %d %s\n", code,
                  code > 0 ? http.getString().c_str() : http.errorToString(code).c_str());
    http.end();
    return FETCH_FAILED;
  }

  // getString() rather than getStream(): it dechunks for us, and the list is
  // small enough that the copy costs nothing outside the draw path.
  const String body = http.getString();
  http.end();

  // Filter so only the three fields we render make it into the document.
  JsonDocument filter;
  JsonObject shape = filter["tasks"].add<JsonObject>();
  shape["value"] = true;
  shape["label"] = true;
  shape["color"] = true;

  JsonDocument doc;
  const DeserializationError err =
      deserializeJson(doc, body, DeserializationOption::Filter(filter));
  if (err) {
    Serial.printf("tasks: JSON parse failed (%s)\n", err.c_str());
    return FETCH_FAILED;
  }

  JsonArray arr = doc["tasks"].as<JsonArray>();
  if (arr.isNull()) {
    Serial.println("tasks: no 'tasks' array in response");
    return FETCH_FAILED;
  }

  // First four in the order returned — that is the user's own manual order,
  // the same four the web console shows.
  taskCount = 0;
  for (JsonObject t : arr) {
    if (taskCount >= MAX_TASKS) break;
    const char *value = t["value"] | "";
    if (value[0] == '\0') continue;
    strlcpy(tasks[taskCount].value, value, sizeof tasks[taskCount].value);
    strlcpy(tasks[taskCount].label, t["label"] | value, sizeof tasks[taskCount].label);
    tasks[taskCount].color = hexToRGB565(t["color"] | "");
    taskCount++;
  }

  if (taskCount == 0) {
    Serial.println("tasks: list was empty");
    return FETCH_FAILED;
  }
  usingFallbackTasks = false;
  return FETCH_OK;
}

// One completed entry. Duration-only, so no clock sync is needed: the server
// stamps endTime = now and startTime = now - seconds.
static bool postEntry(const char *taskValue, uint32_t seconds) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("post: offline");
    return false;
  }

  JsonDocument body;
  body["task"] = taskValue;
  body["seconds"] = seconds;
  char payload[160];
  serializeJson(body, payload, sizeof payload);

  for (int attempt = 1; attempt <= POST_MAX_ATTEMPTS; attempt++) {
    WiFiClientSecure client;
    HTTPClient http;
    prepareClient(client, http);

    if (!http.begin(client, API_BASE "/api/v1/time-entries")) {
      Serial.println("post: http.begin failed");
      return false;
    }
    addAuth(http);
    http.addHeader("Content-Type", "application/json");

    const int code = http.POST((uint8_t *)payload, strlen(payload));
    const String resp = (code > 0) ? http.getString() : String();
    http.end();

    if (code == 201) {
      Serial.printf("post: saved %s for %us\n", taskValue, (unsigned)seconds);
      return true;
    }

    if (code > 0) {
      // Branch on the error code, never the prose.
      JsonDocument err;
      const char *errCode = deserializeJson(err, resp) ? "" : (err["error"]["code"] | "");
      Serial.printf("post: HTTP %d code=%s body=%s\n", code, errCode, resp.c_str());
    } else {
      Serial.printf("post: transport error %s\n", http.errorToString(code).c_str());
    }

    // 4xx will not change on a retry — the request itself is wrong.
    const bool retryable = (code < 0) || (code >= 500);
    if (!retryable || attempt == POST_MAX_ATTEMPTS) return false;
    delay(POST_BACKOFF_MS * attempt);
  }
  return false;
}

/* =============================================================================
   SESSION CONTROL
   ============================================================================= */

static void redrawForStateChange() {
  drawStatus();
  drawClock(true);
  drawTaskPads();
  drawPresetPads();
  drawTransport();
}

static void startAlarmFeedback() {
  alarmBlinksLeft = ALARM_BLINKS;
  alarmBright = true;
  alarmToggleAt = millis();
#if USE_BUZZER
  tone(BUZZER_PIN, 2200, 90);  // non-blocking: queued to the core's tone task
#endif
}

static void beginSession() {
  sessionBankedMs = 0;
  sessionRunSince = millis();
  alarmFired = false;
  state = ST_RUNNING;
  redrawForStateChange();
}

static void pauseSession() {
  sessionBankedMs += (uint32_t)(millis() - sessionRunSince);
  state = ST_PAUSED;
  redrawForStateChange();
}

static void resumeSession() {
  sessionRunSince = millis();
  state = ST_RUNNING;
  redrawForStateChange();
}

// `overrideSeconds` > 0 posts that instead of the measured elapsed time. The
// countdown alarm uses it to log the full preset rather than the tick it fired on.
static void endSession(uint32_t overrideSeconds, const char *successMsg) {
  const uint32_t seconds = overrideSeconds > 0 ? overrideSeconds : elapsedMs() / 1000UL;
  const int task = selectedTask;

  state = ST_IDLE;
  sessionBankedMs = 0;
  sessionRunSince = 0;
  alarmFired = false;
  redrawForStateChange();

  if (seconds < MIN_SESSION_SEC) {
    // Refuse on-device rather than spend a round trip on a guaranteed 400.
    showFlash("TOO SHORT");
    return;
  }
  if (task < 0) return;  // START is gated on a selection, so this cannot happen

  showFlash("SAVING");
  const bool ok = postEntry(tasks[task].value, seconds);
  showFlash(ok ? successMsg : "SAVE FAILED");
}

/* =============================================================================
   TOUCH
   ============================================================================= */

static void handleTap(int16_t x, int16_t y) {
  // Task pads — locked mid-session, because switching would detach the timer
  // from whatever is being recorded.
  if (y >= TASK_Y && y < TASK_Y + TASK_H) {
    const int i = x / PAD_W;
    if (i >= taskCount) return;
    if (sessionActive()) { showFlash("STOP FIRST"); return; }
    selectedTask = i;
    drawHeader();
    drawTaskPads();
    drawTransport();
    return;
  }

  // Preset pads — tapping the lit one returns to stopwatch mode.
  if (y >= PRESET_Y && y < PRESET_Y + PRESET_H) {
    if (sessionActive()) { showFlash("STOP FIRST"); return; }
    const int i = x / PAD_W;
    selectedPreset = (selectedPreset == i) ? -1 : i;
    drawPresetPads();
    drawStatus();
    drawClock(true);
    return;
  }

  if (y >= TRANS_Y) {
    for (int i = 0; i < 3; i++) {
      if (x < TRANS_X[i] || x >= TRANS_X[i] + TRANS_W[i]) continue;
      if (i == 0) {
        if (state == ST_IDLE && selectedTask >= 0) beginSession();
      } else if (i == 1) {
        if (state == ST_RUNNING) pauseSession();
        else if (state == ST_PAUSED) resumeSession();
      } else {
        if (sessionActive()) endSession(0, "SAVED");
      }
      return;
    }
  }
}

static void serviceTouch() {
  const bool down = ts.tirqTouched() && ts.touched();
  const uint32_t now = millis();

  if (down) {
    lastTouchDown = now;
    if (!touchLatched) {
      touchLatched = true;
      const TS_Point p = ts.getPoint();
      const int16_t x = (int16_t)map(p.x, TOUCH_X_MIN, TOUCH_X_MAX, 0, SCR_W);
      const int16_t y = (int16_t)map(p.y, TOUCH_Y_MIN, TOUCH_Y_MAX, 0, SCR_H);
#if TOUCH_DEBUG
      Serial.printf("touch raw=(%d,%d) z=%d  ->  (%d,%d)\n", p.x, p.y, p.z, x, y);
#endif
      if (x >= 0 && x < SCR_W && y >= 0 && y < SCR_H) handleTap(x, y);
    }
  } else if (touchLatched && (uint32_t)(now - lastTouchDown) > TOUCH_RELEASE_MS) {
    touchLatched = false;
  }
}

/* =============================================================================
   SETUP / LOOP
   ============================================================================= */

static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED &&
         (uint32_t)(millis() - started) < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
  }
  online = (WiFi.status() == WL_CONNECTED);
  if (online) Serial.printf("wifi: %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("wifi: timed out — running offline");
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nTime-O console booting...");

  // This build does not light the backlight on its own.
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  tft.init();
  tft.invertDisplay(false);  // ST7789 on this unit comes up inverted otherwise
  tft.setRotation(1);
  tft.fillScreen(C_BG);

  touchSPI.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  ts.begin(touchSPI);
  ts.setRotation(1);

#if USE_BUZZER
  pinMode(BUZZER_PIN, OUTPUT);
#endif

  splash("CONNECTING WIFI");
  connectWiFi();

  splash("LOADING TASKS");
  const FetchResult fr = online ? fetchTasks() : FETCH_FAILED;
  if (fr == FETCH_UNAUTHORIZED) {
    // A bad key is a config error, not a transient one — stop here rather than
    // fail silently at the first save.
    Serial.println("FATAL: API key rejected (401). Check API_KEY in the config block.");
    splash("CHECK API KEY");
    while (true) delay(1000);
  }
  if (fr != FETCH_OK) {
    Serial.println("tasks: using the compiled-in fallback list");
    loadFallbackTasks();  // headerOnline() now reports OFFLINE for the whole run
  }

  drawConsole();
  Serial.printf("ready: %d tasks%s\n", taskCount, usingFallbackTasks ? " (fallback)" : "");
}

void loop() {
  serviceTouch();  // STOP posts from in here, which blocks for a second or more

  // Countdown alarm: stop immediately, log the full preset, flash TIME'S UP.
  if (state == ST_RUNNING && selectedPreset >= 0 && !alarmFired &&
      elapsedMs() >= targetMs()) {
    alarmFired = true;  // set before endSession() so a re-entrant tick can't refire
    const uint32_t full = (uint32_t)PRESET_MIN[selectedPreset] * 60UL;
    endSession(full, "TIME'S UP");
    // Started after the POST, not before: the save blocks for a second or more
    // and would otherwise eat the whole blink animation before it could tick.
    startAlarmFeedback();
  }

  // Read the clock only after everything above, both of which can spend seconds
  // inside a POST. A value sampled at the top of loop() would be behind the
  // flashStart that showFlash() just set, and (now - flashStart) would underflow
  // past FLASH_MS — wiping SAVED off the status line the instant it appeared.
  const uint32_t now = millis();

  if ((uint32_t)(now - lastClockTick) >= 200UL) {
    lastClockTick = now;
    drawClock(false);
  }

  if (alarmBlinksLeft > 0 && (uint32_t)(now - alarmToggleAt) >= ALARM_TOGGLE_MS) {
    alarmToggleAt = now;
    alarmBright = !alarmBright;
    if (alarmBright) {
#if USE_BUZZER
      tone(BUZZER_PIN, 2200, 90);
#endif
    } else if (--alarmBlinksLeft == 0) {
      alarmBright = false;
    }
    drawClock(true);
  }

  if (flashMsg[0] != '\0' && (uint32_t)(now - flashStart) >= FLASH_MS) {
    flashMsg[0] = '\0';
    drawStatus();
  }

  if ((uint32_t)(now - lastWifiCheck) >= WIFI_CHECK_MS) {
    lastWifiCheck = now;
    const bool up = (WiFi.status() == WL_CONNECTED);
    if (up != online) {
      online = up;
      drawHeader();
    }
    // reconnect() disconnects first, so calling it on every check would stop
    // the association from ever completing.
    if (!up && (uint32_t)(now - lastReconnect) >= WIFI_RECONNECT_MS) {
      lastReconnect = now;
      WiFi.reconnect();
    }
  }
}

/**
 * Copy-paste examples for the docs page. Each one takes the origin the page is
 * being served from, so what's on screen is already pointed at this install.
 *
 * The C++ builds its JSON with a raw string literal — no escaped quotes to get
 * wrong when someone retypes it on a smaller screen.
 */

export function arduinoSketch(origin: string): string {
  return `#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

const char *WIFI_SSID     = "your-network";
const char *WIFI_PASSWORD = "your-password";

const char *API_BASE = "${origin}";
const char *API_KEY  = "to_live_xxxxxxxxxxxxxxxx";
const char *TASK     = "deep-work";  // a task value or label from GET /api/v1/tasks

const int BUTTON_PIN = 0;  // the BOOT button on most ESP32 dev boards

bool     running   = false;
uint32_t startedAt = 0;

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\\nconnected as %s\\n", WiFi.localIP().toString().c_str());
}

// Sends elapsed seconds and lets the server stamp the start and end instants,
// so the board never needs its clock synced over NTP.
bool logSeconds(uint32_t seconds) {
  WiFiClientSecure client;
  client.setInsecure();  // fine on a bench; pin a root CA before you ship it

  HTTPClient http;
  if (!http.begin(client, String(API_BASE) + "/api/v1/time-entries")) {
    Serial.println("begin failed");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_KEY);

  char body[160];
  snprintf(body, sizeof(body), R"({"task":"%s","seconds":%u})", TASK, seconds);

  int    status = http.POST(body);
  String reply  = http.getString();
  http.end();

  Serial.printf("HTTP %d: %s\\n", status, reply.c_str());
  return status == 201;
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  connectWiFi();
  Serial.println("press the button to start, press again to log the session");
}

void loop() {
  static bool lastLevel = HIGH;
  bool        level     = digitalRead(BUTTON_PIN);

  // Falling edge: the button was just pressed.
  if (lastLevel == HIGH && level == LOW) {
    delay(40);  // debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      if (!running) {
        running   = true;
        startedAt = millis();
        Serial.println("timer started");
      } else {
        running = false;
        // Unsigned subtraction, so this survives the millis() rollover.
        uint32_t seconds = (millis() - startedAt) / 1000;
        Serial.printf("timer stopped after %us\\n", seconds);
        if (seconds >= 30) {
          logSeconds(seconds);
        } else {
          Serial.println("under 30 seconds, nothing logged");
        }
      }
      while (digitalRead(BUTTON_PIN) == LOW) {
        delay(10);  // wait for the release
      }
    }
  }

  lastLevel = level;
  delay(10);
}`;
}

/**
 * The Cheap Yellow Display (ESP32-2432S028R) is a 320x240 ILI9341 with a
 * resistive touch panel, which is enough to rebuild the app's timer console as
 * a physical device. Colors are the app's own retro tokens converted to RGB565.
 */
export function cydSketch(origin: string): string {
  return `/*
 * Time-O timer console for the ESP32 "Cheap Yellow Display" (ESP32-2432S028R).
 *
 * Tap a task pad to pick a task, then START / PAUSE / STOP. The session lives
 * on the device while it runs and is posted once, on STOP, as a completed
 * entry — so the board needs no clock and nothing to reconcile if it reboots
 * mid-session.
 *
 * Libraries: TFT_eSPI, XPT2046_Touchscreen.   Board: "ESP32 Dev Module".
 *
 * TFT_eSPI User_Setup.h for this panel:
 *   #define ILI9341_2_DRIVER
 *   #define TFT_WIDTH  240
 *   #define TFT_HEIGHT 320
 *   #define TFT_MISO 12
 *   #define TFT_MOSI 13
 *   #define TFT_SCLK 14
 *   #define TFT_CS   15
 *   #define TFT_DC    2
 *   #define TFT_RST  -1
 *   #define TFT_BL   21
 *   #define TFT_BACKLIGHT_ON HIGH
 *   #define USE_HSPI_PORT
 *   #define LOAD_GLCD
 *   #define LOAD_FONT2
 *   #define LOAD_FONT4
 *   #define LOAD_FONT7
 *   #define SPI_FREQUENCY 55000000
 *
 * Leave TOUCH_CS undefined. The CYD wires its XPT2046 to a second set of pins
 * (below), so TFT_eSPI's built-in touch cannot reach it — that mismatch is the
 * usual reason a CYD draws fine but ignores every tap.
 */

#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>

// ---------------------------------------------------------------- settings --
const char *WIFI_SSID     = "your-network";
const char *WIFI_PASSWORD = "your-password";

const char *API_BASE = "${origin}";
const char *API_KEY  = "to_live_xxxxxxxxxxxxxxxx";

// Sessions shorter than this round to zero minutes and are refused, so the
// console doesn't bother sending them.
const uint32_t MIN_SECONDS = 30;

// "name" is sent as the API's \`task\` field, which matches a task's value or
// label — so firmware ships readable names instead of generated ids. Edit these
// to match your own tasks; "caption" is only what fits on a pad.
struct Task {
  const char *name;
  const char *caption;
  uint16_t    color;
};

Task TASKS[] = {
  {"deep-work", "DEEP",   0x963F},
  {"meetings",  "MEET",   0xFE89},
  {"backend",   "BACK",   0xFD34},
  {"review",    "REVIEW", 0x8775},
};
const int TASK_COUNT = sizeof(TASKS) / sizeof(TASKS[0]);

// ------------------------------------------------------------------ colors --
// The app's retro console tokens, converted from oklch to RGB565.
#define C_BG    0x1040
#define C_CELL  0x1881
#define C_LINE  0x4163
#define C_DIM   0x8B6A
#define C_AMBER 0xFD07
#define C_GLOW  0xFE05

// ------------------------------------------------------------------- touch --
// The XPT2046 sits on its own pins, so it gets its own SPI bus. The display
// runs on HSPI (see USE_HSPI_PORT above) and the two never collide.
#define XPT2046_IRQ  36
#define XPT2046_MOSI 32
#define XPT2046_MISO 39
#define XPT2046_CLK  25
#define XPT2046_CS   33

// Raw corners of the touch panel. Nudge these if taps land off-target.
const uint16_t TOUCH_X_MIN = 200, TOUCH_X_MAX = 3700;
const uint16_t TOUCH_Y_MIN = 240, TOUCH_Y_MAX = 3800;

SPIClass            touchSPI = SPIClass(VSPI);
XPT2046_Touchscreen touch(XPT2046_CS, XPT2046_IRQ);
TFT_eSPI            tft = TFT_eSPI();

// ------------------------------------------------------------------ layout --
const int SCREEN_W = 320;
const int SCREEN_H = 240;
const int HEADER_H = 24;
const int CLOCK_Y  = HEADER_H;        //  24
const int CLOCK_H  = 92;              //  ..116
const int STATUS_Y = CLOCK_Y + CLOCK_H;
const int STATUS_H = 24;              //  ..140
const int PADS_Y   = STATUS_Y + STATUS_H;
const int PADS_H   = 44;              //  ..184
const int BAR_Y    = PADS_Y + PADS_H;
const int BAR_H    = SCREEN_H - BAR_Y;
const int PAD_W    = SCREEN_W / TASK_COUNT;

// Transport button edges: START | PAUSE | STOP.
const int BTN_X[4] = {0, 106, 213, 320};

// ------------------------------------------------------------------- state --
enum State { IDLE, RUNNING, PAUSED };

State    state        = IDLE;
int      selected     = 0;
uint32_t bankedMs     = 0;   // time from segments before the last pause
uint32_t runningSince = 0;   // millis() at the last start/resume
bool     online       = false;

char     lastClock[12]  = "";
char     lastStatus[24] = "";
char     message[24]    = "";
uint32_t messageUntil   = 0;
bool     touchLatched   = false;
uint32_t lastTick       = 0;
uint32_t lastNetCheck   = 0;

// Unsigned arithmetic, so this stays correct across the millis() rollover.
uint32_t elapsedMs() {
  return bankedMs + (state == RUNNING ? millis() - runningSince : 0);
}

void formatClock(uint32_t ms, char *out, size_t size) {
  uint32_t total = ms / 1000;
  snprintf(out, size, "%02u:%02u:%02u", total / 3600, (total / 60) % 60,
           total % 60);
}

/** Shows a transient line in place of the status text. */
void flash(const char *text) {
  snprintf(message, sizeof(message), "%s", text);
  messageUntil = millis() + 2500;
}

// ------------------------------------------------------------------ drawing --
void drawHeader() {
  tft.fillRect(0, 0, SCREEN_W, HEADER_H, C_BG);
  tft.fillCircle(13, HEADER_H / 2, 5, TASKS[selected].color);

  tft.setTextDatum(ML_DATUM);
  tft.setTextColor(C_AMBER, C_BG);
  tft.drawString(TASKS[selected].name, 26, HEADER_H / 2, 2);

  tft.setTextDatum(MR_DATUM);
  tft.setTextColor(online ? C_AMBER : C_LINE, C_BG);
  tft.drawString(online ? "ONLINE" : "OFFLINE", SCREEN_W - 8, HEADER_H / 2, 2);
}

void drawClock(bool force) {
  char buf[12];
  formatClock(elapsedMs(), buf, sizeof(buf));
  if (!force && strcmp(buf, lastClock) == 0) return;
  snprintf(lastClock, sizeof(lastClock), "%s", buf);

  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(state == RUNNING ? C_GLOW : C_AMBER, C_BG);
  // Padding repaints the previous string's box, so digits never leave crumbs.
  tft.setTextPadding(280);
  tft.drawString(buf, SCREEN_W / 2, CLOCK_Y + CLOCK_H / 2, 7);
  tft.setTextPadding(0);
}

void drawStatus(bool force) {
  const char *text;
  if (message[0] != 0 && (int32_t)(millis() - messageUntil) < 0) {
    text = message;
  } else {
    message[0] = 0;
    text = state == RUNNING ? "RECORDING" : state == PAUSED ? "PAUSED"
                                                            : "STOPWATCH";
  }
  if (!force && strcmp(text, lastStatus) == 0) return;
  snprintf(lastStatus, sizeof(lastStatus), "%s", text);

  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(C_DIM, C_BG);
  tft.setTextPadding(SCREEN_W);
  tft.drawString(text, SCREEN_W / 2, STATUS_Y + STATUS_H / 2, 2);
  tft.setTextPadding(0);
}

void drawPads() {
  for (int i = 0; i < TASK_COUNT; i++) {
    const int x        = i * PAD_W;
    const bool isPicked = i == selected;
    // Pads lock while a session runs: switching task mid-run would detach the
    // timer from what is actually being recorded.
    // Unpicked pads take the cell tint, so the pad row reads as its own band.
    const uint16_t bg = isPicked ? C_AMBER : C_CELL;
    const uint16_t fg = isPicked ? C_BG : (state == IDLE ? C_DIM : C_LINE);

    tft.fillRect(x, PADS_Y + 2, PAD_W, PADS_H - 2, bg);
    tft.fillRect(x + 6, PADS_Y + 8, PAD_W - 12, 4,
                 isPicked ? C_BG : TASKS[i].color);
    if (i > 0) tft.fillRect(x, PADS_Y + 2, 2, PADS_H - 2, C_LINE);

    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(fg, bg);
    tft.drawString(TASKS[i].caption, x + PAD_W / 2, PADS_Y + 30, 2);
  }
}

void drawTransport() {
  const char *labels[3] = {"START", "PAUSE", "STOP"};
  for (int i = 0; i < 3; i++) {
    const int x = BTN_X[i];
    const int w = BTN_X[i + 1] - x;
    const bool enabled = i == 0 ? state == IDLE : state != IDLE;
    const char *label = (i == 1 && state == PAUSED) ? "RESUME" : labels[i];

    tft.fillRect(x, BAR_Y + 2, w, BAR_H - 2, C_BG);
    if (i > 0) tft.fillRect(x, BAR_Y + 2, 2, BAR_H - 2, C_LINE);

    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(enabled ? C_AMBER : C_LINE, C_BG);
    tft.drawString(label, x + w / 2, BAR_Y + BAR_H / 2, 4);
  }
}

void drawFrame() {
  tft.fillScreen(C_BG);
  tft.fillRect(0, HEADER_H - 2, SCREEN_W, 2, C_LINE);
  tft.fillRect(0, PADS_Y, SCREEN_W, 2, C_LINE);
  tft.fillRect(0, BAR_Y, SCREEN_W, 2, C_LINE);
  drawHeader();
  drawPads();
  drawTransport();
  drawClock(true);
  drawStatus(true);
}

void splash(const char *line) {
  tft.fillScreen(C_BG);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(C_AMBER, C_BG);
  tft.drawString("TIME-O", SCREEN_W / 2, 96, 4);
  tft.setTextColor(C_DIM, C_BG);
  tft.drawString(line, SCREEN_W / 2, 132, 2);
}

// ---------------------------------------------------------------- transport --
bool postSession(const char *task, uint32_t seconds) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();  // fine on a bench; pin a root CA before you ship it

  HTTPClient http;
  if (!http.begin(client, String(API_BASE) + "/api/v1/time-entries")) {
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_KEY);

  char body[160];
  snprintf(body, sizeof(body), R"({"task":"%s","seconds":%u})", task, seconds);

  const int status = http.POST(body);
  Serial.print("POST /api/v1/time-entries -> ");
  Serial.println(status);
  if (status != 201) Serial.println(http.getString());
  http.end();

  return status == 201;
}

void startSession() {
  if (state != IDLE) return;
  bankedMs     = 0;
  runningSince = millis();
  state        = RUNNING;
  drawTransport();
  drawPads();
  drawClock(true);
  drawStatus(true);
}

void togglePause() {
  if (state == RUNNING) {
    bankedMs += millis() - runningSince;
    state = PAUSED;
  } else if (state == PAUSED) {
    runningSince = millis();
    state        = RUNNING;
  } else {
    return;
  }
  drawTransport();
  drawClock(true);
  drawStatus(true);
}

void stopSession() {
  if (state == IDLE) return;

  const uint32_t seconds = elapsedMs() / 1000;
  state        = IDLE;
  bankedMs     = 0;
  runningSince = 0;

  drawTransport();
  drawPads();
  drawClock(true);

  if (seconds < MIN_SECONDS) {
    flash("TOO SHORT");
    drawStatus(true);
    return;
  }

  // Painted before the request, which blocks for a second or so.
  flash("SAVING");
  drawStatus(true);
  flash(postSession(TASKS[selected].name, seconds) ? "SAVED" : "SAVE FAILED");
  drawStatus(true);
}

// -------------------------------------------------------------------- input --
void handleTouch(int x, int y) {
  if (y >= BAR_Y) {
    if (x < BTN_X[1])      startSession();
    else if (x < BTN_X[2]) togglePause();
    else                   stopSession();
    return;
  }

  if (y >= PADS_Y) {
    if (state != IDLE) {
      flash("STOP FIRST");
      drawStatus(true);
      return;
    }
    const int i = x / PAD_W;
    if (i >= 0 && i < TASK_COUNT && i != selected) {
      selected = i;
      drawPads();
      drawHeader();
    }
  }
}

/** Fires once per press, on the touch-down edge. */
void pollTouch() {
  const bool down = touch.tirqTouched() && touch.touched();

  if (down && !touchLatched) {
    const TS_Point p = touch.getPoint();
    const int x = constrain(
        map(p.x, TOUCH_X_MIN, TOUCH_X_MAX, 0, SCREEN_W), 0, SCREEN_W - 1);
    const int y = constrain(
        map(p.y, TOUCH_Y_MIN, TOUCH_Y_MAX, 0, SCREEN_H), 0, SCREEN_H - 1);
    touchLatched = true;
    handleTouch(x, y);
  } else if (!down) {
    touchLatched = false;
  }
}

void netTick() {
  if (millis() - lastNetCheck < 3000) return;
  lastNetCheck = millis();

  const bool nowOnline = WiFi.status() == WL_CONNECTED;
  if (nowOnline == online) return;
  online = nowOnline;
  if (!online) WiFi.reconnect();
  drawHeader();
}

void setup() {
  Serial.begin(115200);

  // Some CYD builds leave the backlight off until the pin is driven high.
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  tft.init();
  tft.setRotation(1);  // landscape, 320x240

  touchSPI.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  touch.begin(touchSPI);
  touch.setRotation(1);

  splash("CONNECTING");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t deadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }
  online = WiFi.status() == WL_CONNECTED;
  Serial.println(online ? WiFi.localIP().toString() : String("offline"));

  // The console still runs offline — only saving needs the network.
  drawFrame();
}

void loop() {
  pollTouch();

  if (millis() - lastTick >= 200) {
    lastTick = millis();
    drawClock(false);
    drawStatus(false);
  }

  netTick();
}`;
}

export function micropythonSnippet(origin: string): string {
  return `import urequests

API_BASE = "${origin}"
API_KEY  = "to_live_xxxxxxxxxxxxxxxx"

def log_minutes(task, minutes):
    response = urequests.post(
        API_BASE + "/api/v1/time-entries",
        headers={
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
        },
        json={"task": task, "minutes": minutes},
    )
    try:
        print(response.status_code, response.text)
        return response.status_code == 201
    finally:
        # urequests holds the socket open until you close it — skip this and
        # the board runs out of sockets after a handful of calls.
        response.close()

log_minutes("deep-work", 25)`;
}

export function curlSnippet(origin: string): string {
  return `# Log 25 minutes against a task, ending now
curl -X POST ${origin}/api/v1/time-entries \\
  -H "Authorization: Bearer to_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"task": "deep-work", "minutes": 25}'

# List the tasks you can log against
curl ${origin}/api/v1/tasks \\
  -H "Authorization: Bearer to_live_xxxxxxxxxxxxxxxx"`;
}

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>

#define XPT2046_IRQ  36
#define XPT2046_MOSI 32
#define XPT2046_MISO 39
#define XPT2046_CLK  25
#define XPT2046_CS   33

TFT_eSPI tft = TFT_eSPI();
SPIClass touchSPI(VSPI);
XPT2046_Touchscreen ts(XPT2046_CS, XPT2046_IRQ);

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("CYD booting...");

  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  // tft.init();
  // tft.setRotation(1);
  // tft.fillScreen(TFT_BLACK);

  tft.init();
  tft.invertDisplay(false);   // <-- add this line
  tft.setRotation(1);
  tft.fillScreen(TFT_BLACK);

  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(20, 20);
  tft.println("CYD is alive!");

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(20, 60);
  tft.println("Touch the screen...");

  // Color test bars
  tft.fillRect(20, 100, 40, 40, TFT_RED);
  tft.fillRect(70, 100, 40, 40, TFT_GREEN);
  tft.fillRect(120, 100, 40, 40, TFT_BLUE);

  touchSPI.begin(XPT2046_CLK, XPT2046_MISO, XPT2046_MOSI, XPT2046_CS);
  ts.begin(touchSPI);
  ts.setRotation(1);
}

void loop() {
  if (ts.tirqTouched() && ts.touched()) {
    TS_Point p = ts.getPoint();
    int x = map(p.x, 200, 3700, 0, 320);
    int y = map(p.y, 240, 3800, 0, 240);
    tft.fillCircle(x, y, 3, TFT_CYAN);
    Serial.printf("touch raw=(%d,%d) z=%d  ->  (%d,%d)\n", p.x, p.y, p.z, x, y);
  }
}
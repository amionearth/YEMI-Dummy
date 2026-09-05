/*
  ESP32 OLED frame receiver

  Display: SSD1306, 128 x 64, I2C
  Library: Adafruit GFX Library + Adafruit SSD1306

  Wiring (typical ESP32 DevKit):
    OLED VCC -> 3V3
    OLED GND -> GND
    OLED SDA -> GPIO 21
    OLED SCL -> GPIO 22

  Serial frame protocol:
    Send the two-byte marker 0xA5 0x5A followed by 1024 bytes.
    The 1024 bytes are one monochrome 128 x 64 frame, row by row.
    Bit 7 is the leftmost pixel in each group of eight pixels.
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

constexpr uint8_t OLED_WIDTH = 128;
constexpr uint8_t OLED_HEIGHT = 64;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr int OLED_SDA = 21;
constexpr int OLED_SCL = 22;
constexpr size_t FRAME_BYTES = OLED_WIDTH * OLED_HEIGHT / 8;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
uint8_t frame[FRAME_BYTES];

bool readExact(uint8_t *buffer, size_t length) {
  size_t received = 0;
  unsigned long lastByteAt = millis();

  while (received < length) {
    if (Serial.available()) {
      buffer[received++] = static_cast<uint8_t>(Serial.read());
      lastByteAt = millis();
    } else if (millis() - lastByteAt > 1000) {
      return false; // Interrupted frame; resynchronize on the next marker.
    }
  }
  return true;
}

void showFrame(const uint8_t *pixels) {
  display.clearDisplay();
  for (uint8_t y = 0; y < OLED_HEIGHT; ++y) {
    for (uint8_t byteX = 0; byteX < OLED_WIDTH / 8; ++byteX) {
      uint8_t bits = pixels[y * (OLED_WIDTH / 8) + byteX];
      for (uint8_t bit = 0; bit < 8; ++bit) {
        if (bits & (0x80 >> bit)) {
          display.drawPixel(byteX * 8 + bit, y, SSD1306_WHITE);
        }
      }
    }
  }
  display.display();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(OLED_SDA, OLED_SCL);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    while (true) delay(1000);
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(18, 28);
  display.print("Waiting for face");
  display.display();
}

void loop() {
  static bool sawFirstMarkerByte = false;

  while (Serial.available()) {
    uint8_t value = static_cast<uint8_t>(Serial.read());

    if (!sawFirstMarkerByte) {
      sawFirstMarkerByte = (value == 0xA5);
      continue;
    }

    sawFirstMarkerByte = false;
    if (value == 0x5A && readExact(frame, FRAME_BYTES)) {
      showFrame(frame);
    }
  }
}

/*
  ==============================================================================
  OpenPets / Tink — ESP32 Dual-Core Pet Body Controller
  ==============================================================================
  All-in-one production firmware for Tink the AI Tamagotchi.
  
  Dual-Core Architecture (ESP32 FreeRTOS):
  - CORE 0 (PRO_CPU): Dedicated Servo & Multi-Mode Touch Sensing
    * Jitter-free PWM servo sweep (GPIO 13): 0° to 70° limit, 20° sweep (25°-45°).
    * High-speed touch sensing (GPIO 32 / A0 / Touch9): capacitive, analog & digital.
    * Completely isolated from OLED and Serial delays!
  - CORE 1 (APP_CPU): Dedicated OLED Display & Serial Frame Receiver
    * 128x64 OLED display over I2C at 800 kHz (SDA=21, SCL=22).
    * Binary stream receiver (0xA5 0x5A + 1024 bytes) for live animated face frames.
    * Serial text command parser ("SERVO:FAST", "SERVO:SLOW", "SERVO:STOP").

  Hardware Pinout:
  ------------------------------------------------------------------------------
  | Component    | ESP32 Pin  | Notes                                          |
  |--------------|------------|------------------------------------------------|
  | OLED VCC     | 3V3        | 3.3V Power                                     |
  | OLED GND     | GND        | Ground                                         |
  | OLED SDA     | GPIO 21    | I2C Data                                       |
  | OLED SCL     | GPIO 22    | I2C Clock                                      |
  | SERVO PWM    | GPIO 13    | SG90/MG90S signal (0°-70° limit, 20° sweep)    |
  | TOUCH SENSOR | GPIO 32    | A0 / ADC1_CH4 / Touch9 (Capacitive/Analog/Dig) |
  ------------------------------------------------------------------------------
*/

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>

constexpr uint8_t OLED_WIDTH = 128;
constexpr uint8_t OLED_HEIGHT = 64;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr int OLED_SDA = 21;
constexpr int OLED_SCL = 22;
constexpr int OLED_RESET = -1;
constexpr size_t FRAME_BYTES = OLED_WIDTH * OLED_HEIGHT / 8;

#define PAKAI_SSD1306
// #define PAKAI_SH1106

#if defined(PAKAI_SSD1306)
#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
#define OLED_WHITE SSD1306_WHITE
#elif defined(PAKAI_SH1106)
#include <Adafruit_SH110X.h>
Adafruit_SH1106G display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
#define OLED_WHITE SH110X_WHITE
#endif

// =============================================================================
// HARDWARE PINS & SERVO CONFIGURATION
// =============================================================================
constexpr int TOUCH_PIN = 32;  // Touch9 (T9) / ADC1_CH4 / A0
constexpr int SERVO_PIN = 13;  // Servo control signal on GPIO 13
constexpr int SERVO_CHANNEL = 4;
constexpr int SERVO_FREQ = 50; // 50 Hz standard servo PWM
constexpr int SERVO_RES = 16;  // 16-bit resolution (0 - 65535)

// --- Servo Range Limits (0° to 70°) & 20° Sweep Calibration ---
constexpr int SERVO_LIMIT_MIN = 0;    // Hard limit: 0 degrees
constexpr int SERVO_LIMIT_MAX = 70;   // Hard limit: 70 degrees
constexpr int SWEEP_AMPLITUDE = 20;   // 20 degrees back and forth movement

// Centered inside 0° to 70°: sweep between 25° and 45° (45 - 25 = 20°)
constexpr int SWEEP_START_ANGLE = 25;
constexpr int SWEEP_END_ANGLE   = 45;
constexpr int SERVO_CENTER_ANGLE = 35;

// =============================================================================
// UNIVERSAL ESP32 ARDUINO CORE (v2.x & v3.x+) PWM COMPATIBILITY LAYER
// =============================================================================
// Handles breaking API changes between ESP32 Arduino Core 2.x and Core 3.x+
#if defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
  #define USE_LEDC_CORE_V3 1
#elif defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  #define USE_LEDC_CORE_V3 1
#else
  #define USE_LEDC_CORE_V3 0
#endif

inline void servoPwmSetup() {
#if USE_LEDC_CORE_V3
  ledcAttach(SERVO_PIN, SERVO_FREQ, SERVO_RES);
#else
  ledcSetup(SERVO_CHANNEL, SERVO_FREQ, SERVO_RES);
  ledcAttachPin(SERVO_PIN, SERVO_CHANNEL);
#endif
}

inline void servoPwmWrite(uint32_t duty) {
#if USE_LEDC_CORE_V3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(SERVO_CHANNEL, duty);
#endif
}

// Convert angle (0° - 180°) to 16-bit PWM duty at 50Hz (20000us period, 65535 counts)
// Standard 1000us (0°) to 2000us (180°) linear mapping:
uint32_t angleToDuty(float angleDeg) {
  if (angleDeg < SERVO_LIMIT_MIN) angleDeg = SERVO_LIMIT_MIN;
  if (angleDeg > SERVO_LIMIT_MAX) angleDeg = SERVO_LIMIT_MAX;
  float pulseUs = 1000.0f + (angleDeg * 1000.0f / 180.0f);
  return static_cast<uint32_t>((pulseUs / 20000.0f) * 65535.0f);
}

// Servo State Machine (Shared between cores, atomic/volatile)
enum ServoSpeed { SERVO_OFF, SERVO_SLOW_MODE, SERVO_FAST_MODE };
volatile ServoSpeed currentServoMode = SERVO_SLOW_MODE;
volatile unsigned long servoStepIntervalMs = 45; // Default slow sweep: 45ms per step

int servoCurrentAngle = SWEEP_START_ANGLE;
int servoDirection = 1; // +1 or -1
unsigned long lastServoStepTime = 0;

// Touch sensor timing & thresholds
unsigned long lastTouchCheckTime = 0;
unsigned long lastTouchTriggerTime = 0;
constexpr int CAPACITIVE_TOUCH_THRESHOLD = 40; // Capacitive touch reading below this = touch
constexpr int ANALOG_TOUCH_THRESHOLD = 1500;   // Analog A0 reading above this = touch

// OLED frame buffer
uint8_t frame[FRAME_BYTES];

// FreeRTOS Task Handle for Core 0
TaskHandle_t Core0TaskHandle = NULL;

// =============================================================================
// CORE 0 WORKER: SERVO MOTION & TOUCH SENSING (FreeRTOS Task)
// =============================================================================
void updateServoMotion() {
  if (currentServoMode == SERVO_OFF) return;

  unsigned long now = millis();
  if (now - lastServoStepTime >= servoStepIntervalMs) {
    lastServoStepTime = now;

    // Move 20 degrees back and forth (between 25° and 45°)
    servoCurrentAngle += servoDirection;
    if (servoCurrentAngle >= SWEEP_END_ANGLE) {
      servoCurrentAngle = SWEEP_END_ANGLE;
      servoDirection = -1;
    } else if (servoCurrentAngle <= SWEEP_START_ANGLE) {
      servoCurrentAngle = SWEEP_START_ANGLE;
      servoDirection = 1;
    }

    // Safety clamp strictly within 0° to 70° limit
    if (servoCurrentAngle < SERVO_LIMIT_MIN) servoCurrentAngle = SERVO_LIMIT_MIN;
    if (servoCurrentAngle > SERVO_LIMIT_MAX) servoCurrentAngle = SERVO_LIMIT_MAX;

    servoPwmWrite(angleToDuty(servoCurrentAngle));
  }
}

void checkTouchSensor() {
  unsigned long now = millis();
  if (now - lastTouchCheckTime < 50) return;
  lastTouchCheckTime = now;

  bool touched = false;

  // 1. Capacitive touchRead (ESP32 Touch9 / T9 on GPIO 32)
  int touchVal = touchRead(TOUCH_PIN);
  if (touchVal > 0 && touchVal < CAPACITIVE_TOUCH_THRESHOLD) {
    touched = true;
  }

  // 2. Analog read on A0 / ADC1_CH4 (GPIO 32)
  int analogVal = analogRead(TOUCH_PIN);
  if (analogVal > ANALOG_TOUCH_THRESHOLD) {
    touched = true;
  }

  // 3. Digital active-high read
  if (digitalRead(TOUCH_PIN) == HIGH) {
    touched = true;
  }

  // Debounce touch: trigger at most once every 1200ms
  if (touched && (now - lastTouchTriggerTime > 1200)) {
    lastTouchTriggerTime = now;
    Serial.println("EVENT:TOUCH");
    Serial.flush();
  }
}

void core0Worker(void *pvParameters) {
  for (;;) {
    updateServoMotion();
    checkTouchSensor();
    vTaskDelay(pdMS_TO_TICKS(5)); // Run every 5ms on Core 0 with zero jitter!
  }
}

// =============================================================================
// CORE 1 WORKER: OLED DISPLAY & SERIAL PROTOCOL
// =============================================================================
bool readExact(uint8_t *buffer, size_t length) {
  size_t received = 0;
  unsigned long lastByteAt = millis();

  while (received < length) {
    if (Serial.available()) {
      buffer[received++] = static_cast<uint8_t>(Serial.read());
      lastByteAt = millis();
    } else if (millis() - lastByteAt > 1000) {
      return false;
    }
  }
  return true;
}

void showFrame(const uint8_t *pixels) {
  display.clearDisplay();
  display.drawBitmap(0, 0, pixels, OLED_WIDTH, OLED_HEIGHT, OLED_WHITE);
  display.display();
}

void handleCommand(const String &cmd) {
  if (cmd == "SERVO:FAST") {
    currentServoMode = SERVO_FAST_MODE;
    servoStepIntervalMs = 12; // Fast 20° sweep for crying or hungry/alert!
  } else if (cmd == "SERVO:SLOW") {
    currentServoMode = SERVO_SLOW_MODE;
    servoStepIntervalMs = 45; // Gentle slow sweep for sitting/happy
  } else if (cmd == "SERVO:STOP") {
    currentServoMode = SERVO_OFF;
    servoPwmWrite(angleToDuty(SERVO_CENTER_ANGLE)); // Park at 35°
  } else if (cmd == "TOUCH_TEST") {
    Serial.println("EVENT:TOUCH");
  }
}

// =============================================================================
// SETUP & LOOP
// =============================================================================
void setup() {
  Serial.begin(115200);
  pinMode(TOUCH_PIN, INPUT);

  // Setup Servo on GPIO 13 via universal LEDC PWM
  servoPwmSetup();
  servoPwmWrite(angleToDuty(SERVO_CENTER_ANGLE));

  // Initialize I2C OLED at 800 kHz
  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(800000);

#if defined(PAKAI_SSD1306)
  display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
#elif defined(PAKAI_SH1106)
  display.begin(OLED_ADDRESS, true);
#endif

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(OLED_WHITE);
  display.setCursor(12, 28);
  display.print("Tink Dual-Core Ready");
  display.display();

  // Launch Core 0 Worker Task for Servo & Touch Sensor
  xTaskCreatePinnedToCore(
    core0Worker,         // Task function
    "ServoTouchCore0",   // Name of task
    4096,                // Stack size in words
    NULL,                // Task input parameter
    2,                   // Priority of the task
    &Core0TaskHandle,    // Task handle
    0                    // Pinned to Core 0!
  );

  Serial.println("INFO:ESP32_DUAL_CORE_READY");
}

void loop() {
  // Core 1 handles OLED frames and Serial incoming data
  static bool sawFirstMarkerByte = false;

  while (Serial.available()) {
    int peekVal = Serial.peek();

    // Check for Text Command line (e.g. SERVO:FAST)
    if (peekVal == 'S' || peekVal == 'T' || peekVal == 'C') {
      String cmd = Serial.readStringUntil('\n');
      cmd.trim();
      if (cmd.length() > 0) {
        handleCommand(cmd);
      }
      continue;
    }

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

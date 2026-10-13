// =============================================================================
// main.cpp — WPFL Arena LED Driver
// Weaponized Plastic Fighting League — arena lighting on a Rotato PCB
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE file for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
// Derived from the Rotato Robot Controller firmware (same author, same license).
//
// ARCHITECTURE
//
//   ┌──────────────────────── main.cpp ─────────────────────────┐
//   │  wires modules, polls buttons, runs controller.update()   │
//   └──────────┬───────────────────────────────┬────────────────┘
//              │                               │
//   ┌──────────▼───────────┐       ┌───────────▼─────────────────┐
//   │ app/ArenaController  │◄──────│ connectivity/               │
//   │  protocol, sessions, │       │  WiFiManager  (STA/AP/mDNS) │
//   │  settings, mutex     │       │  WebServerManager (HTTP/WS) │
//   └──────────┬───────────┘       └─────────────────────────────┘
//              │
//   ┌──────────▼───────────┐       ┌─────────────────────────────┐
//   │ led/                 │       │ hardware/                   │
//   │  ArenaLayout         │       │  BuzzerController (GPIO7)   │
//   │  LedEngine           │       │  SupplyMonitor    (GPIO0)   │
//   │  LedOutput (RMT)     │       │  Button  (GPIO5/6/9)        │
//   └──────────────────────┘       └─────────────────────────────┘
//
// STARTUP: Serial → layout → buzzer/supply → WiFi → controller (LEDs on, boot
//          scene) → web server → ready beep.
// LOOP:    buttons → wifi.update → web.update → controller.update → buzzer.
// =============================================================================

#include <Arduino.h>
#include "config.h"
#include "version.h"
#include "version_build.h"

#include "led/ArenaLayout.h"
#include "led/LedEngine.h"
#include "led/LedOutput.h"
#include "hardware/BuzzerController.h"
#include "hardware/SupplyMonitor.h"
#include "hardware/Button.h"
#include "connectivity/WiFiManager.h"
#include "connectivity/WebServerManager.h"
#include "connectivity/Uplink.h"
#include "app/ArenaController.h"

// ── Module instances (static allocation — keeps the heap for WiFi/TCP) ───────
ArenaLayout      layout;
LedEngine        engine;
LedOutput        output;
BuzzerController buzzer;
SupplyMonitor    supply;
WiFiManager      wifi;
WebServerManager webServer;
Uplink           uplink;
ArenaController  controller(layout, engine, output, wifi, webServer, uplink, buzzer, supply);

Button bootButton;
#ifdef HAS_EXT_BUTTONS
Button startButton;
Button stopButton;
#endif

void setup() {
    Serial.begin(115200);
    {   // USB-CDC: give a monitor up to 2 s to attach (don't hold the arena hostage)
        uint32_t t0 = millis();
        while (!Serial && millis() - t0 < 2000) delay(10);
    }
    Serial.println("\n========================================");
    Serial.println("  WPFL Arena LED Driver");
    Serial.println("  Weaponized Plastic Fighting League");
    Serial.println("========================================");
    Serial.printf("[Boot] Firmware v%s (built %s %s), protocol v%d\n",
                  FW_VERSION_FULL, FW_BUILD_DATE, FW_BUILD_TIME, PROTOCOL_VERSION);
    Serial.printf("[Boot] %s rev %u, %u MHz, flash %u MB\n", ESP.getChipModel(),
                  ESP.getChipRevision(), ESP.getCpuFreqMHz(), ESP.getFlashChipSize() / (1024 * 1024));
    Serial.printf("[Heap] boot               free=%u  maxBlock=%u  (total %u)\n",
                  ESP.getFreeHeap(), ESP.getMaxAllocHeap(), ESP.getHeapSize());

    // ── Hardware ─────────────────────────────────────────────────────────────
    layout.begin();
    buzzer.begin();
    supply.begin();
    bootButton.begin(PIN_BOOT_BUTTON);
#ifdef HAS_EXT_BUTTONS
    startButton.begin(PIN_BTN_START);
    stopButton.begin(PIN_BTN_STOP);
#endif

    // ── LEDs first, so the arena lights up even while WiFi is connecting ─────
    uplink.begin();
    controller.begin();
    controller.update(millis());

    // ── Network ──────────────────────────────────────────────────────────────
    wifi.begin();
    webServer.begin();

    buzzer.beepStartup();
    Serial.println("[Main] ----------------------------------------");
    Serial.printf("[Main] Ready. Open http://%s  or  http://%s.local\n",
                  wifi.ip().c_str(), wifi.hostname().c_str());
    Serial.printf("[Main] WebSocket: ws://%s%s\n", wifi.ip().c_str(), WS_PATH);
    Serial.printf("[Heap] after setup        free=%u  maxBlock=%u\n",
                  ESP.getFreeHeap(), ESP.getMaxAllocHeap());
    Serial.println("[Main] ----------------------------------------");
}

void loop() {
    uint32_t now = millis();

    // ── Buttons ──────────────────────────────────────────────────────────────
    switch (bootButton.update(now)) {
        case Button::SHORT:
            controller.startDefaultCountdown("countdown");
            break;
        case Button::LONG:
            Serial.println("[Main] BOOT held 3 s — forgetting WiFi network...");
            buzzer.beepError();
            controller.requestWifiReset();
            break;
        default: break;
    }
#ifdef HAS_EXT_BUTTONS
    if (startButton.update(now) == Button::PRESSED) controller.startDefaultCountdown("countdown");
    if (stopButton.update(now)  == Button::PRESSED) controller.allStop();
#endif

    wifi.update(now);
    webServer.update(now);
    controller.update(now);
    buzzer.update();

    // Yield one tick so the idle task runs (task watchdog) — ≤ 1 ms latency.
    vTaskDelay(1);
}

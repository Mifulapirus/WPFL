#pragma once
// =============================================================================
// ArenaController.h — The protocol brain: commands in, LEDs + state out
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// Implements the WebSocket/HTTP protocol (docs/protocols/arena-led-websocket.md)
// on top of the modules:
//
//   WebServerManager ──text/binary──► ArenaController ──► LedEngine ──► LedOutput
//          ▲                               │  ▲               ▲
//          └──── state/status/frames ──────┘  └─ ArenaLayout ─┘
//
// THREADING
//   Network callbacks run on the AsyncTCP task; render/broadcast run in loop().
//   One FreeRTOS mutex guards layout, engine, settings and sessions. Anything
//   slow (NVS writes, bus re-creation, reboots) is deferred to loop().
//
// LATENCY PATH
//   WS frame → parse → engine change → _dirty → loop renders on its next pass
//   (≤ 1 ms) → RMT transmits 72 px in ~2.2 ms.
// =============================================================================

#include <Arduino.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "config.h"
#include "led/ArenaLayout.h"
#include "led/LedEngine.h"
#include "led/LedOutput.h"
#include "connectivity/WiFiManager.h"
#include "connectivity/WebServerManager.h"
#include "hardware/BuzzerController.h"
#include "hardware/SupplyMonitor.h"

// Persisted LED + countdown settings (NVS "leds"/"settings").
struct LedSettings {
    uint16_t magic;
    uint8_t  brightness;
    char     colorOrder[4];
    uint8_t  gamma;
    uint16_t maxWatts;
    uint16_t mwPerPixel;     // milliwatts per pixel at full white
    uint8_t  bootScene;      // index into BOOT_SCENES
    uint8_t  buzzer;
    uint32_t cdMs;           // countdown length
    uint32_t cdWarnMs;       // switch to WARN color at/below this
    uint16_t cdGoMs;         // GO flashing time
    RGB      cdHigh, cdWarn, cdGo, cdThen;
    uint8_t  cdHasThen;
};

class ArenaController {
public:
    ArenaController(ArenaLayout& layout, LedEngine& engine, LedOutput& output,
                    WiFiManager& wifi, WebServerManager& web,
                    BuzzerController& buzzer, SupplyMonitor& supply);

    // Load settings, configure outputs, apply the boot scene, hook up the web layer.
    void begin();

    // Render, broadcast, deferred work. Call every loop().
    void update(uint32_t now);

    // ── Local inputs (buttons) ───────────────────────────────────────────────
    void startDefaultCountdown(const char* label);
    void allStop();                 // solid red everywhere
    void requestWifiReset();        // forget network + reboot

private:
    struct Session {
        uint32_t id        = 0;     // 0 = free slot
        bool     authed    = false;
        bool     frames    = false;
        uint16_t frameMs   = 100;
        uint32_t lastFrame = 0;
        bool     hello     = false; // send config/state/status from loop()
        bool     scanReq   = false;
    };

    // Who sent a command (WebSocket session or HTTP call).
    struct Ctx {
        Session* session;
        bool     authed;
    };

    ArenaLayout&      _layout;
    LedEngine&        _engine;
    LedOutput&        _output;
    WiFiManager&      _wifi;
    WebServerManager& _web;
    BuzzerController& _buzzer;
    SupplyMonitor&    _supply;

    SemaphoreHandle_t _mtx = nullptr;
    LedSettings _settings{};
    Session     _sessions[WS_MAX_CLIENTS + 2];
    char        _label[32] = "boot";

    // Flags set by commands, consumed by loop()
    volatile bool _dirty        = true;
    volatile bool _stateChanged = true;
    volatile bool _configChanged = false;
    volatile bool _scanRequested = false;
    bool     _reconfigure   = false;
    bool     _saveSettings  = false;
    bool     _saveLayout    = false;
    uint32_t _saveAt        = 0;
    uint32_t _rebootAt      = 0;
    bool     _forgetWifi    = false;
    bool     _factoryReset  = false;

    // Loop bookkeeping
    uint32_t _lastFrame = 0, _lastState = 0, _lastStatus = 0, _lastHeapLog = 0, _lastSupply = 0;
    uint32_t _fpsWindow = 0;
    uint16_t _fpsCount  = 0, _fps = 0;
    volatile uint8_t _clientCount = 0;
    uint8_t  _preview[3 + 3 * LED_MAX_PIXELS];
    uint8_t  _scratch[3 * LED_MAX_PIXELS];

    // ── Locking ──────────────────────────────────────────────────────────────
    void lock()   { xSemaphoreTake(_mtx, portMAX_DELAY); }
    void unlock() { xSemaphoreGive(_mtx); }

    // ── Network entry points ─────────────────────────────────────────────────
    void onConnection(uint32_t id, bool connected);
    void onText(uint32_t id, const char* data, size_t len);
    void onBinary(uint32_t id, const uint8_t* data, size_t len);
    void onHttpGet(const char* what, String& reply);
    void onHttpCmd(const char* body, size_t len, const String& token, String& reply);
    bool tokenOk(const String& token) const;

    // ── Protocol (call with lock held) ───────────────────────────────────────
    void handle(JsonObjectConst cmd, Ctx& ctx, JsonDocument& reply);
    bool handleLed(const char* type, JsonObjectConst cmd, JsonDocument& reply, const char*& err);
    bool handleConfig(const char* type, JsonObjectConst cmd, Ctx& ctx, JsonDocument& reply, const char*& err);
    void buildState(JsonDocument& doc);
    void buildStatus(JsonDocument& doc);
    void buildConfig(JsonDocument& doc);
    void settingsToJson(JsonObject o) const;
    bool settingsFromJson(JsonObjectConst in, const char*& err);
    void applySettingsToOutput();
    void setLabel(JsonObjectConst cmd, const char* fallback);
    void markChanged() { _dirty = true; _stateChanged = true; }
    Session* findSession(uint32_t id);

    // ── Settings persistence ─────────────────────────────────────────────────
    void loadSettings();
    void storeSettings();
    void defaultSettings();
    void applyBootScene();
    void startCountdown(SectionMask mask, uint32_t ms, uint32_t warnMs, uint16_t goMs,
                        RGB high, RGB warn, RGB go, bool hasThen, RGB then);

    // ── Loop helpers ─────────────────────────────────────────────────────────
    void sendDoc(uint32_t id, JsonDocument& doc);
    void broadcastDoc(JsonDocument& doc);
    void sendFrames(uint32_t now);
    void logHeap(const char* tag);
};

#pragma once
// =============================================================================
// WiFiManager.h — Station + fallback Access Point, mDNS, device identity
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
//
// Adapted from the Rotato WiFiManager (a custom class — not the popular
// third-party library of the same name).
//
// BEHAVIOR
//   No saved network      → AP only: SSID "WPFL-Arena-XXXX", http://192.168.4.1
//   Saved network         → STA. If it can't join within STA_CONNECT_TIMEOUT_MS
//                           at boot → AP + STA (keeps retrying the network).
//   STA lost at runtime   → after STA_LOST_FALLBACK_MS the AP comes up too, so
//                           the referee tablet can still reach the driver.
//   Always                → mDNS http://<hostname>.local, modem sleep OFF
//                           (WiFi power save adds 100+ ms of latency).
//
// NVS
//   "net": ssid, pass, static (bool), ip, gw, mask, dns
//   "dev": host, ap_ssid, ap_pass, token
//
// Saving never reboots by itself — the caller schedules the reboot.
// =============================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include "config.h"

struct StaticIpConfig {
    bool   enabled = false;
    String ip, gateway, mask, dns;
};

class WiFiManager {
public:
    void begin();
    void update(uint32_t now);   // runtime fallback / retry logic — call from loop()

    // ── Persisted settings (take effect after reboot) ───────────────────────
    bool saveNetwork(const String& ssid, const String& pass, const StaticIpConfig& st,
                     bool keepPassword, const char*& err);
    void clearNetwork();
    bool saveDevice(const String& hostname, const String& apSsid, const String& apPass,
                    const char*& err);
    void saveToken(const String& token);
    void factoryReset();         // wipes "net" and "dev"

    // ── Status ───────────────────────────────────────────────────────────────
    bool        staConnected() const { return WiFi.status() == WL_CONNECTED; }
    bool        apActive() const     { return _apActive; }
    const char* modeName() const;    // "sta" | "ap" | "ap+sta"
    String      ip() const;          // STA IP if connected, else AP IP
    int         rssi() const         { return staConnected() ? WiFi.RSSI() : 0; }
    const String& hostname() const   { return _hostname; }
    const String& apSsid() const     { return _apSsid; }
    const String& staSsid() const    { return _ssid; }
    const String& token() const      { return _token; }
    const StaticIpConfig& staticIp() const { return _static; }

    // ── Scanning (async) ─────────────────────────────────────────────────────
    void startScan();
    // Returns true when finished and fills `out` (array of {ssid,rssi,secure}).
    bool scanResults(JsonArray out);
    bool scanning() const        { return _scanning; }

private:
    String _ssid, _pass, _hostname, _apSsid, _apPass, _defaultApSsid, _token;
    StaticIpConfig _static;
    bool     _apActive      = false;
    bool     _scanning      = false;
    uint32_t _lostSince     = 0;
    uint32_t _lastRetry     = 0;

    void loadSettings();
    bool connectSta(uint32_t timeoutMs);
    void startAp(bool keepSta);
    void startMdns();
    String buildDefaultApSsid();
    static bool validHostname(const String& h);
};

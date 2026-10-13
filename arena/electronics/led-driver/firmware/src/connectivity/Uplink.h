#pragma once
// =============================================================================
// Uplink.h — Outbound WebSocket to the match server (wss://…/led)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// WHY OUTBOUND: the match tracker runs on a public server and the driver sits
// on the venue network behind NAT. The server cannot reach the driver, so the
// driver dials out and keeps the socket open. Over it the server sends the
// same protocol-v1 commands as any local client; the driver answers and
// pushes config/state/status exactly as it does on /ws.
//
// TRANSPORT: ESP-IDF esp_websocket_client in its own FreeRTOS task (TLS
// handshakes never block loop()). wss:// is verified against RootCerts.h;
// ws:// works for LAN tests. Auth: "Authorization: Bearer <key>".
// Reconnects by itself every ~10 s while enabled and WiFi (STA) is up.
//
// THREADING: callbacks run on the uplink task — same rules as AsyncTCP
// callbacks (ArenaController takes its mutex). send() may be called from
// loop() but NEVER while holding the controller mutex: the client task holds
// its own lock while it runs our callbacks → lock-order deadlock otherwise.
//
// NVS namespace "up": url (String), key (String), on (Bool).
// =============================================================================

#include <Arduino.h>
#include <functional>
#include <esp_websocket_client.h>
#include "config.h"

class Uplink {
public:
    using ConnHandler = std::function<void(bool connected)>;
    using TextHandler = std::function<void(const char* data, size_t len)>;

    void begin();                       // load NVS settings
    void update(bool wifiUp);           // loop(): start/stop with WiFi and settings

    // Validate + persist. Call from loop() (NVS write); restarts the link.
    bool save(const String& url, const String& key, bool keepKey, bool enabled, const char*& err);
    void factoryReset();                // wipes "up"

    bool send(const char* data, size_t len);   // false if not connected / busy

    void onConnection(ConnHandler h) { _onConn = h; }
    void onText(TextHandler h)       { _onText = h; }

    bool          enabled() const   { return _enabled; }
    bool          connected() const { return _connected; }
    bool          keySet() const    { return !_key.isEmpty(); }
    const String& url() const       { return _url; }
    const char*   stateName() const;   // "off" | "waiting" | "connecting" | "connected"

    static bool validUrl(const String& url);

private:
    esp_websocket_client_handle_t _client = nullptr;
    String _url, _key;
    bool   _enabled = false;
    volatile bool _connected = false;
    bool   _restart = false;
    bool   _wifiUp  = false;
    char   _headers[96] = {};
    ConnHandler _onConn;
    TextHandler _onText;

    // Reassembly of frames larger than the client buffer (protocol max 3 KB).
    char   _rx[WS_MAX_MSG_LEN];
    size_t _rxLen = 0;

    void start();
    void stop();
    static void onEvent(void* arg, esp_event_base_t base, int32_t id, void* data);
};

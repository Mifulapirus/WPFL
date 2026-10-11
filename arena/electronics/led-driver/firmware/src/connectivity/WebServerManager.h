#pragma once
// =============================================================================
// WebServerManager.h — HTTP server + WebSocket transport
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
//
// Adapted from the Rotato WebServerManager. This class only moves bytes; it
// does not know what a "countdown" is. ArenaController registers callbacks
// and implements the protocol (docs/protocols/arena-led-websocket.md).
//
// ENDPOINTS
//   GET  /              Web UI (gzip, embedded at build time)
//   WS   /ws            JSON commands + binary pixel frames (main API)
//   GET  /api/status    \
//   GET  /api/state      > same JSON as the WebSocket messages (for curl/health checks)
//   GET  /api/config    /
//   POST /api/cmd       one JSON command in the body → JSON reply
//   POST /update        OTA firmware upload (multipart .bin)
//
// TOKEN (optional, set in the UI): HTTP calls pass it as header "X-Token"
// or query "?token=". WebSocket clients send {"type":"auth","token":...}.
//
// LATENCY / HEAP
//   • TCP_NODELAY on every socket (no Nagle batching of small frames).
//   • At most WS_MAX_CLIENTS sockets; new sockets are refused when the largest
//     free heap block is below WS_MIN_HEAP_NEW_CLIENT.
//   • Messages > WS_MAX_MSG_LEN are dropped. Per-client send queue is capped
//     (WS_MAX_QUEUED_MESSAGES); when full, messages are discarded, not queued.
//
// THREADING: all callbacks run on the AsyncTCP task, not the Arduino loop.
// =============================================================================

#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <functional>
#include "config.h"

class WebServerManager {
public:
    using TextHandler    = std::function<void(uint32_t clientId, const char* data, size_t len)>;
    using BinaryHandler  = std::function<void(uint32_t clientId, const uint8_t* data, size_t len)>;
    using ConnHandler    = std::function<void(uint32_t clientId, bool connected)>;
    // GET /api/<what> → reply JSON. what = "status" | "state" | "config"
    using HttpGetHandler = std::function<void(const char* what, String& reply)>;
    // POST /api/cmd → reply JSON
    using HttpCmdHandler = std::function<void(const char* body, size_t len, const String& token, String& reply)>;
    using TokenCheck     = std::function<bool(const String& token)>;
    using OtaDoneHandler = std::function<void(bool ok)>;

    WebServerManager();

    void onText(TextHandler cb)        { _onText = cb; }
    void onBinary(BinaryHandler cb)    { _onBinary = cb; }
    void onConnection(ConnHandler cb)  { _onConn = cb; }
    void onHttpGet(HttpGetHandler cb)  { _onGet = cb; }
    void onHttpCmd(HttpCmdHandler cb)  { _onCmd = cb; }
    void onTokenCheck(TokenCheck cb)   { _tokenOk = cb; }
    void onOtaDone(OtaDoneHandler cb)  { _onOtaDone = cb; }

    void begin();
    void update(uint32_t now);   // client cleanup + keep-alive pings (loop)

    // ── Sending (safe from any task) ─────────────────────────────────────────
    bool   sendText(uint32_t id, const char* msg, size_t len) { return _ws.text(id, msg, len); }
    bool   sendBinary(uint32_t id, const uint8_t* d, size_t len) { return _ws.binary(id, d, len); }
    void   broadcastText(const char* msg, size_t len)        { if (_ws.count()) _ws.textAll(msg, len); }
    bool   canSend(uint32_t id)                              { return _ws.availableForWrite(id); }
    size_t clientCount() const                               { return _ws.count(); }
    void   closeAll()                                        { _ws.closeAll(); }

private:
    AsyncWebServer _server;
    AsyncWebSocket _ws;

    TextHandler    _onText;
    BinaryHandler  _onBinary;
    ConnHandler    _onConn;
    HttpGetHandler _onGet;
    HttpCmdHandler _onCmd;
    TokenCheck     _tokenOk;
    OtaDoneHandler _onOtaDone;

    // Reassembly buffer for frames that arrive in several TCP chunks.
    uint8_t  _rx[WS_MAX_MSG_LEN];
    uint32_t _rxOwner = 0;
    uint32_t _lastPing = 0;
    bool     _otaAuthorized = false;

    void onEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                 AwsEventType type, void* arg, uint8_t* data, size_t len);
    void dispatch(uint32_t id, uint8_t opcode, const uint8_t* data, size_t len);
    static String requestToken(AsyncWebServerRequest* req);
};

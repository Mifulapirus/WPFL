// =============================================================================
// WebServerManager.cpp — HTTP server + WebSocket transport (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.

#include "WebServerManager.h"
#include "web_ui_html.h"
#include <Update.h>

WebServerManager::WebServerManager() : _server(WEB_SERVER_PORT), _ws(WS_PATH) {}

String WebServerManager::requestToken(AsyncWebServerRequest* req) {
    if (req->hasHeader("X-Token")) return req->header("X-Token");
    if (req->hasParam("token")) return req->getParam("token")->value();
    return String();
}

void WebServerManager::begin() {
    _ws.onEvent([this](AsyncWebSocket* s, AsyncWebSocketClient* c, AwsEventType t,
                       void* arg, uint8_t* data, size_t len) {
        onEvent(s, c, t, arg, data, len);
    });
    _server.addHandler(&_ws);

    // ── Web UI (gzip in flash) ────────────────────────────────────────────────
    _server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
        AsyncWebServerResponse* r = req->beginResponse(200, "text/html", WEB_UI_HTML_GZ, WEB_UI_HTML_GZ_LEN);
        r->addHeader("Content-Encoding", "gzip");
        r->addHeader("Cache-Control", "no-cache");
        req->send(r);
    });

    // ── JSON API ──────────────────────────────────────────────────────────────
    auto get = [this](const char* what) {
        return [this, what](AsyncWebServerRequest* req) {
            String reply;
            if (_onGet) _onGet(what, reply);
            AsyncWebServerResponse* r = req->beginResponse(200, "application/json", reply);
            r->addHeader("Access-Control-Allow-Origin", "*");
            req->send(r);
        };
    };
    _server.on("/api/status", HTTP_GET, get("status"));
    _server.on("/api/state",  HTTP_GET, get("state"));
    _server.on("/api/config", HTTP_GET, get("config"));

    _server.on("/api/cmd", HTTP_POST,
        [this](AsyncWebServerRequest* req) {
            String reply;
            const char* body = (const char*)req->_tempObject;
            if (!body) {
                reply = F("{\"type\":\"error\",\"error\":\"empty or oversized body\"}");
            } else if (_onCmd) {
                _onCmd(body, strlen(body), requestToken(req), reply);
            }
            AsyncWebServerResponse* r = req->beginResponse(200, "application/json", reply);
            r->addHeader("Access-Control-Allow-Origin", "*");
            req->send(r);
        },
        nullptr,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t index, size_t total) {
            if (total == 0 || total > WS_MAX_MSG_LEN) return;
            if (index == 0) {
                req->_tempObject = malloc(total + 1);   // freed by the request destructor
                if (!req->_tempObject) return;
            }
            if (!req->_tempObject) return;
            memcpy((uint8_t*)req->_tempObject + index, data, len);
            if (index + len == total) ((char*)req->_tempObject)[total] = '\0';
        });

    // ── OTA firmware update (from Rotato) ─────────────────────────────────────
    _server.on("/update", HTTP_POST,
        [this](AsyncWebServerRequest* req) {
            bool ok = _otaAuthorized && !Update.hasError();
            String body = ok ? String("{\"ok\":true}")
                             : String("{\"ok\":false,\"error\":\"") +
                               (_otaAuthorized ? Update.errorString() : "unauthorized") + "\"}";
            AsyncWebServerResponse* r = req->beginResponse(ok ? 200 : 400, "application/json", body);
            r->addHeader("Connection", "close");
            req->send(r);
            if (_onOtaDone) _onOtaDone(ok);   // controller schedules the reboot
        },
        [this](AsyncWebServerRequest* req, const String& filename, size_t index,
               uint8_t* data, size_t len, bool final) {
            if (index == 0) {
                _otaAuthorized = !_tokenOk || _tokenOk(requestToken(req));
                if (!_otaAuthorized) {
                    Serial.println("[OTA] Rejected: bad token.");
                    return;
                }
                Serial.printf("[OTA] Receiving '%s'\n", filename.c_str());
                // Free WebSocket heap before the flash writer allocates.
                _ws.closeAll();
                if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
                    Serial.printf("[OTA] begin() failed: %s\n", Update.errorString());
                    return;
                }
            }
            if (!_otaAuthorized) return;
            if (!Update.hasError() && Update.write(data, len) != len) {
                Serial.printf("[OTA] write() error: %s\n", Update.errorString());
            }
            if (final) {
                if (Update.end(true)) Serial.printf("[OTA] %u bytes — image OK.\n", (unsigned)(index + len));
                else Serial.printf("[OTA] end() failed: %s\n", Update.errorString());
            }
        });

    _server.onNotFound([](AsyncWebServerRequest* req) { req->send(404, "text/plain", "Not found"); });

    _server.begin();
    Serial.printf("[Web] HTTP on :%d, WebSocket at %s\n", WEB_SERVER_PORT, WS_PATH);
}

void WebServerManager::update(uint32_t now) {
    // Removes closed sockets. The limit is above WS_MAX_CLIENTS on purpose:
    // new sockets are refused at connect time, so this never kicks the oldest
    // client (which is usually the match server).
    _ws.cleanupClients(WS_MAX_CLIENTS + 2);
    if (now - _lastPing >= WS_PING_INTERVAL_MS) {
        _lastPing = now;
        if (_ws.count()) _ws.pingAll();
    }
}

void WebServerManager::onEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                               AwsEventType type, void* arg, uint8_t* data, size_t len) {
    switch (type) {
        case WS_EVT_CONNECT: {
            size_t block = ESP.getMaxAllocHeap();
            if (server->count() > WS_MAX_CLIENTS || block < WS_MIN_HEAP_NEW_CLIENT) {
                Serial.printf("[Web] Refusing client #%u (clients=%u, maxBlock=%u)\n",
                              client->id(), (unsigned)server->count(), (unsigned)block);
                client->close(1013, "busy");   // 1013 = try again later
                return;
            }
            client->setCloseClientOnQueueFull(false);   // drop messages, keep the socket
            if (client->client()) client->client()->setNoDelay(true);
            Serial.printf("[Web] WS client #%u connected from %s\n",
                          client->id(), client->remoteIP().toString().c_str());
            if (_onConn) _onConn(client->id(), true);
            break;
        }
        case WS_EVT_DISCONNECT:
            Serial.printf("[Web] WS client #%u disconnected\n", client->id());
            if (_rxOwner == client->id()) _rxOwner = 0;
            if (_onConn) _onConn(client->id(), false);
            break;

        case WS_EVT_DATA: {
            AwsFrameInfo* info = (AwsFrameInfo*)arg;
            // Fragmented messages (FIN=0) are not used by our clients — ignore.
            if (!info->final || info->len > WS_MAX_MSG_LEN) {
                if (info->index == 0) Serial.printf("[Web] Dropped oversized/fragmented message from #%u\n", client->id());
                return;
            }
            uint8_t opcode = info->opcode;
            // Common case: whole frame in one chunk → no copy.
            if (info->index == 0 && len == info->len) {
                dispatch(client->id(), opcode, data, len);
                return;
            }
            // Frame split across TCP segments → reassemble.
            if (info->index == 0) _rxOwner = client->id();
            if (_rxOwner != client->id() || info->index + len > WS_MAX_MSG_LEN) return;
            memcpy(_rx + info->index, data, len);
            if (info->index + len == info->len) {
                _rxOwner = 0;
                dispatch(client->id(), opcode, _rx, info->len);
            }
            break;
        }
        default:
            break;
    }
}

void WebServerManager::dispatch(uint32_t id, uint8_t opcode, const uint8_t* data, size_t len) {
    if (opcode == WS_TEXT) {
        if (_onText) _onText(id, (const char*)data, len);
    } else if (opcode == WS_BINARY) {
        if (_onBinary) _onBinary(id, data, len);
    }
}

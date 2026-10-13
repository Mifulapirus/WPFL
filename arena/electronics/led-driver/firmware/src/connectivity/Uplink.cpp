// =============================================================================
// Uplink.cpp — Outbound WebSocket to the match server (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "Uplink.h"
#include <Preferences.h>
#include "RootCerts.h"

static const char* NVS_NS = "up";

void Uplink::begin() {
    Preferences p;
    if (p.begin(NVS_NS, true)) {
        _url     = p.getString("url", "");
        _key     = p.getString("key", "");
        _enabled = p.getBool("on", false);
        p.end();
    }
    Serial.printf("[Uplink] %s%s\n", _enabled ? "enabled → " : "disabled", _enabled ? _url.c_str() : "");
}

bool Uplink::validUrl(const String& url) {
    if (url.length() > 120) return false;
    if (!url.startsWith("wss://") && !url.startsWith("ws://")) return false;
    return url.indexOf(' ') < 0 && url.length() > (url.startsWith("wss://") ? 6u : 5u);
}

bool Uplink::save(const String& url, const String& key, bool keepKey, bool enabled, const char*& err) {
    if ((enabled || !url.isEmpty()) && !validUrl(url)) { err = "URL must start with wss:// (or ws:// for LAN tests)"; return false; }
    if (!keepKey && key.length() > 64) { err = "key max 64 chars"; return false; }
    if (enabled && (keepKey ? _key : key).isEmpty()) { err = "key required"; return false; }
    Preferences p;
    if (!p.begin(NVS_NS, false)) { err = "NVS error"; return false; }
    p.putString("url", url);
    if (!keepKey) p.putString("key", key);
    p.putBool("on", enabled);
    p.end();
    _url = url;
    if (!keepKey) _key = key;
    _enabled = enabled;
    _restart = true;
    Serial.printf("[Uplink] Saved: %s %s\n", enabled ? "on" : "off", url.c_str());
    return true;
}

void Uplink::factoryReset() {
    Preferences p;
    p.begin(NVS_NS, false); p.clear(); p.end();
}

const char* Uplink::stateName() const {
    if (!_enabled) return "off";
    if (_connected) return "connected";
    return _client ? "connecting" : "waiting";   // waiting = no WiFi STA yet
}

void Uplink::update(bool wifiUp) {
    _wifiUp = wifiUp;
    const bool want = _enabled && wifiUp && validUrl(_url) && !_key.isEmpty();
    if (_restart) { _restart = false; stop(); }
    if (want && !_client) start();
    else if (!want && _client) stop();
}

void Uplink::start() {
    snprintf(_headers, sizeof(_headers), "Authorization: Bearer %s\r\n", _key.c_str());
    esp_websocket_client_config_t cfg = {};
    cfg.uri                 = _url.c_str();
    cfg.headers             = _headers;
    cfg.cert_pem            = UPLINK_ROOT_CAS;   // ignored for ws://
    cfg.user_agent          = "wpfl-arena-led";
    cfg.buffer_size         = 1024;
    cfg.task_stack          = 8 * 1024;          // TLS handshake needs the room
    cfg.task_prio           = 1;                 // = loop(): handshakes time-slice, never starve the LEDs
    cfg.ping_interval_sec   = 10;
    cfg.pingpong_timeout_sec = 25;
    cfg.user_context        = this;
    _client = esp_websocket_client_init(&cfg);
    if (!_client) { Serial.println("[Uplink] init failed (heap?)"); return; }
    esp_websocket_register_events(_client, WEBSOCKET_EVENT_ANY, &Uplink::onEvent, this);
    esp_websocket_client_start(_client);
    Serial.printf("[Uplink] Connecting to %s\n", _url.c_str());
}

void Uplink::stop() {
    if (!_client) return;
    esp_websocket_client_stop(_client);       // waits for the task to finish
    esp_websocket_client_destroy(_client);
    _client = nullptr;
    if (_connected) {
        _connected = false;
        if (_onConn) _onConn(false);
    }
    Serial.println("[Uplink] Stopped.");
}

bool Uplink::send(const char* data, size_t len) {
    if (!_client || !_connected) return false;
    // Short timeout: a slow link drops a state/status update instead of stalling loop().
    return esp_websocket_client_send_text(_client, data, (int)len, pdMS_TO_TICKS(50)) == (int)len;
}

// Runs on the websocket client task.
void Uplink::onEvent(void* arg, esp_event_base_t, int32_t id, void* data) {
    Uplink* self = static_cast<Uplink*>(arg);
    auto* ev = static_cast<esp_websocket_event_data_t*>(data);
    switch (id) {
        case WEBSOCKET_EVENT_CONNECTED:
            self->_connected = true;
            self->_rxLen = 0;
            Serial.println("[Uplink] Connected to match server.");
            if (self->_onConn) self->_onConn(true);
            break;
        case WEBSOCKET_EVENT_DISCONNECTED:
        case WEBSOCKET_EVENT_CLOSED:
            if (self->_connected) {
                self->_connected = false;
                Serial.println("[Uplink] Disconnected (retrying).");
                if (self->_onConn) self->_onConn(false);
            }
            break;
        case WEBSOCKET_EVENT_ERROR:
            Serial.println("[Uplink] Connection error (bad URL/key/certificate, or server down).");
            break;
        case WEBSOCKET_EVENT_DATA: {
            if (ev->op_code != 0x01 && ev->op_code != 0x00) break;   // text (+ continuation) only
            if (ev->payload_len > (int)sizeof(self->_rx)) break;     // over the protocol limit: drop
            if (ev->payload_offset == 0) self->_rxLen = 0;
            if (self->_rxLen + ev->data_len > sizeof(self->_rx)) { self->_rxLen = 0; break; }
            memcpy(self->_rx + self->_rxLen, ev->data_ptr, ev->data_len);
            self->_rxLen += ev->data_len;
            if (ev->payload_offset + ev->data_len >= ev->payload_len) {
                if (self->_onText) self->_onText(self->_rx, self->_rxLen);
                self->_rxLen = 0;
            }
            break;
        }
        default:
            break;
    }
}

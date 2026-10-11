// =============================================================================
// WiFiManager.cpp — Station + fallback AP, mDNS (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.

#include "WiFiManager.h"
#include <Preferences.h>
#include <ESPmDNS.h>

static const char* NS_NET = "net";
static const char* NS_DEV = "dev";
static const uint32_t STA_RETRY_MS = 30000;

void WiFiManager::loadSettings() {
    Preferences p;
    p.begin(NS_NET, false);   // read-write so the namespace exists on first boot
    _ssid           = p.getString("ssid", "");
    _pass           = p.getString("pass", "");
    _static.enabled = p.getBool("static", false);
    _static.ip      = p.getString("ip", "");
    _static.gateway = p.getString("gw", "");
    _static.mask    = p.getString("mask", "255.255.255.0");
    _static.dns     = p.getString("dns", "");
    p.end();

    p.begin(NS_DEV, false);
    _hostname = p.getString("host", DEFAULT_HOSTNAME);
    _apSsid   = p.getString("ap_ssid", "");
    _apPass   = p.getString("ap_pass", AP_PASSWORD);
    _token    = p.getString("token", "");
    p.end();
}

void WiFiManager::begin() {
    WiFi.persistent(false);   // we keep our own settings in NVS
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(100);

    // AP MAC is needed for the default SSID suffix — bring the AP side up briefly.
    WiFi.mode(WIFI_AP);
    delay(100);
    _defaultApSsid = buildDefaultApSsid();

    loadSettings();
    if (_apSsid.isEmpty()) _apSsid = _defaultApSsid;
    Serial.printf("[WiFi] Hostname: %s | AP SSID: %s\n", _hostname.c_str(), _apSsid.c_str());

    WiFi.mode(WIFI_OFF);
    WiFi.setHostname(_hostname.c_str());

    if (!_ssid.isEmpty() && connectSta(STA_CONNECT_TIMEOUT_MS)) {
        Serial.printf("[WiFi] Connected to '%s' — IP %s, RSSI %d dBm\n",
                      _ssid.c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else {
        startAp(!_ssid.isEmpty());   // keep retrying STA if a network is configured
    }

    // Latency: modem power-save holds packets for up to a DTIM interval.
    WiFi.setSleep(false);
    startMdns();
}

bool WiFiManager::connectSta(uint32_t timeoutMs) {
    Serial.printf("[WiFi] Connecting to '%s'...\n", _ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    if (_static.enabled) {
        IPAddress ip, gw, mask, dns;
        if (ip.fromString(_static.ip) && gw.fromString(_static.gateway) && mask.fromString(_static.mask)) {
            if (!dns.fromString(_static.dns)) dns = gw;
            WiFi.config(ip, gw, mask, dns);
            Serial.printf("[WiFi] Static IP %s\n", _static.ip.c_str());
        } else {
            Serial.println("[WiFi] Static IP config invalid — using DHCP.");
        }
    }
    WiFi.begin(_ssid.c_str(), _pass.c_str());
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - t0 > timeoutMs) {
            Serial.println("\n[WiFi] Connection timed out.");
            return false;
        }
        delay(200);
        Serial.print(".");
    }
    Serial.println();
    return true;
}

void WiFiManager::startAp(bool keepSta) {
    WiFi.mode(keepSta ? WIFI_AP_STA : WIFI_AP);
    delay(100);
    bool ok = WiFi.softAP(_apSsid.c_str(), _apPass.c_str());
    _apActive = ok;
    if (!ok) {
        Serial.println("[WiFi] ERROR: softAP() failed (password must be 8–63 chars).");
        return;
    }
    if (keepSta) WiFi.begin(_ssid.c_str(), _pass.c_str());
    _lastRetry = millis();
    Serial.println("[WiFi] ────────────────────────────────────────");
    Serial.printf( "[WiFi]  AP SSID     : %s\n", _apSsid.c_str());
    Serial.printf( "[WiFi]  AP Password : %s\n", _apPass.c_str());
    Serial.printf( "[WiFi]  AP IP       : %s\n", WiFi.softAPIP().toString().c_str());
    Serial.printf( "[WiFi]  STA retry   : %s\n", keepSta ? "yes" : "no network saved");
    Serial.println("[WiFi] ────────────────────────────────────────");
}

void WiFiManager::startMdns() {
    if (MDNS.begin(_hostname.c_str())) {
        MDNS.addService("http", "tcp", WEB_SERVER_PORT);
        MDNS.addService("wpfl-led", "tcp", WEB_SERVER_PORT);   // for auto-discovery
        Serial.printf("[WiFi] mDNS: http://%s.local\n", _hostname.c_str());
    } else {
        Serial.println("[WiFi] mDNS failed to start.");
    }
}

void WiFiManager::update(uint32_t now) {
    if (_ssid.isEmpty()) return;   // AP-only device, nothing to manage

    if (staConnected()) {
        _lostSince = 0;
        return;
    }
    if (_lostSince == 0) _lostSince = now ? now : 1;

    // STA dropped at runtime → bring the AP up too after a grace period.
    if (!_apActive && now - _lostSince >= STA_LOST_FALLBACK_MS) {
        Serial.println("[WiFi] Network lost — starting fallback AP (STA keeps retrying).");
        startAp(true);
        return;
    }
    // While in AP+STA, nudge the STA side periodically.
    if (_apActive && now - _lastRetry >= STA_RETRY_MS && !_scanning) {
        _lastRetry = now;
        WiFi.begin(_ssid.c_str(), _pass.c_str());
    }
}

const char* WiFiManager::modeName() const {
    if (staConnected()) return _apActive ? "ap+sta" : "sta";
    return "ap";
}

String WiFiManager::ip() const {
    if (staConnected()) return WiFi.localIP().toString();
    return _apActive ? WiFi.softAPIP().toString() : String(AP_IP_ADDRESS);
}

// ── Persistence ──────────────────────────────────────────────────────────────

bool WiFiManager::saveNetwork(const String& ssid, const String& pass, const StaticIpConfig& st,
                              bool keepPassword, const char*& err) {
    if (ssid.isEmpty() || ssid.length() > 32) { err = "SSID must be 1-32 chars"; return false; }
    if (!keepPassword && pass.length() > 63) { err = "password too long"; return false; }
    if (st.enabled) {
        IPAddress a;
        if (!a.fromString(st.ip) || !a.fromString(st.gateway) || !a.fromString(st.mask)) {
            err = "invalid static IP / gateway / mask"; return false;
        }
    }
    Preferences p;
    p.begin(NS_NET, false);
    p.putString("ssid", ssid);
    if (!keepPassword) p.putString("pass", pass);
    p.putBool("static", st.enabled);
    p.putString("ip", st.ip);
    p.putString("gw", st.gateway);
    p.putString("mask", st.mask);
    p.putString("dns", st.dns);
    p.end();
    Serial.printf("[WiFi] Network '%s' saved.\n", ssid.c_str());
    return true;
}

void WiFiManager::clearNetwork() {
    Preferences p;
    p.begin(NS_NET, false);
    p.clear();
    p.end();
    Serial.println("[WiFi] Saved network cleared.");
}

bool WiFiManager::validHostname(const String& h) {
    if (h.isEmpty() || h.length() > 31) return false;
    for (size_t i = 0; i < h.length(); i++) {
        char c = h[i];
        if (!(isalnum((unsigned char)c) || c == '-')) return false;
    }
    return h[0] != '-' && h[h.length() - 1] != '-';
}

bool WiFiManager::saveDevice(const String& hostname, const String& apSsid, const String& apPass,
                             const char*& err) {
    if (!validHostname(hostname)) { err = "hostname: 1-31 chars, letters/digits/-"; return false; }
    if (apSsid.length() > 32) { err = "AP SSID too long"; return false; }
    if (!apPass.isEmpty() && (apPass.length() < 8 || apPass.length() > 63)) {
        err = "AP password must be 8-63 chars"; return false;
    }
    Preferences p;
    p.begin(NS_DEV, false);
    p.putString("host", hostname);
    if (apSsid.isEmpty() || apSsid == _defaultApSsid) p.remove("ap_ssid");
    else p.putString("ap_ssid", apSsid);
    if (!apPass.isEmpty()) p.putString("ap_pass", apPass);
    p.end();
    Serial.println("[WiFi] Device identity saved.");
    return true;
}

void WiFiManager::saveToken(const String& token) {
    Preferences p;
    p.begin(NS_DEV, false);
    p.putString("token", token);
    p.end();
    _token = token;
    Serial.printf("[WiFi] Control token %s.\n", token.isEmpty() ? "cleared" : "set");
}

void WiFiManager::factoryReset() {
    Preferences p;
    p.begin(NS_NET, false); p.clear(); p.end();
    p.begin(NS_DEV, false); p.clear(); p.end();
    Serial.println("[WiFi] Network + device settings wiped.");
}

// ── Scanning ─────────────────────────────────────────────────────────────────

void WiFiManager::startScan() {
    if (_scanning) return;
    if (!(WiFi.getMode() & WIFI_STA)) WiFi.enableSTA(true);   // scanning needs the STA side
    WiFi.scanNetworks(true /*async*/, false /*hidden*/);
    _scanning = true;
}

bool WiFiManager::scanResults(JsonArray out) {
    if (!_scanning) return false;
    int16_t n = WiFi.scanComplete();
    if (n == WIFI_SCAN_RUNNING) return false;
    _scanning = false;
    for (int16_t i = 0; i < n && i < 20; i++) {
        JsonObject o = out.add<JsonObject>();
        o["ssid"]   = WiFi.SSID(i);
        o["rssi"]   = WiFi.RSSI(i);
        o["secure"] = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    }
    WiFi.scanDelete();
    return true;
}

String WiFiManager::buildDefaultApSsid() {
    uint8_t mac[6];
    WiFi.softAPmacAddress(mac);
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
    return String(AP_SSID_PREFIX) + suffix;
}

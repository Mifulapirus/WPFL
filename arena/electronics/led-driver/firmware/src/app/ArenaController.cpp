// =============================================================================
// ArenaController.cpp — Protocol brain (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// Protocol reference: docs/protocols/arena-led-websocket.md (keep in sync!)

#include "ArenaController.h"
#include <Preferences.h>
#include <esp_system.h>
#include "version.h"
#include "version_build.h"

static const char*    NVS_NS          = "leds";
static const char*    NVS_SETTINGS    = "settings";
static const uint16_t SETTINGS_MAGIC  = 0x5E72;   // bump if LedSettings changes shape
static const uint32_t SAVE_DEBOUNCE_MS = 1500;

static const char* const BOOT_SCENES[] = {"off", "white", "rainbow", "red", "yellow", "green", "blue"};
static const uint8_t NUM_BOOT_SCENES   = sizeof(BOOT_SCENES) / sizeof(BOOT_SCENES[0]);
static const char* const COLOR_ORDERS[] = {"RGB", "RBG", "GRB", "GBR", "BRG", "BGR"};

// Why the chip last restarted — "panic" / "task_wdt" / "brownout" mean trouble.
const char* resetReasonName() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON:   return "power_on";
        case ESP_RST_SW:        return "software";
        case ESP_RST_PANIC:     return "panic";
        case ESP_RST_INT_WDT:   return "int_wdt";
        case ESP_RST_TASK_WDT:  return "task_wdt";
        case ESP_RST_WDT:       return "wdt";
        case ESP_RST_BROWNOUT:  return "brownout";
        case ESP_RST_DEEPSLEEP: return "deep_sleep";
        case ESP_RST_EXT:       return "external";
        case ESP_RST_SDIO:      return "sdio";
        default:                return "unknown";
    }
}

// ── Small helpers ────────────────────────────────────────────────────────────

// Color from "#rrggbb" / "#rgb" / name / [r,g,b]. Missing → def. False if invalid.
static bool colorArg(JsonVariantConst v, RGB& out, const RGB& def) {
    if (v.isNull()) { out = def; return true; }
    if (v.is<JsonArrayConst>()) {
        JsonArrayConst a = v.as<JsonArrayConst>();
        if (a.size() != 3) return false;
        out = RGB(constrain(a[0].as<int>(), 0, 255), constrain(a[1].as<int>(), 0, 255),
                  constrain(a[2].as<int>(), 0, 255));
        return true;
    }
    return color::parse(v.as<const char*>(), out);
}

// Takes the object + key, not obj[key]: converting a missing member to a
// JsonVariant yields an unbound variant and set() would silently do nothing.
static void hexInto(JsonObject o, const char* key, const RGB& c) {
    char buf[8];
    color::toHex(c, buf);
    o[key] = (const char*)buf;   // const char* → copied into the document
}

static uint16_t defaultPeriod(Fx fx) {
    switch (fx) {
        case Fx::Blink:   return 500;
        case Fx::Breathe: return 2000;
        case Fx::Rainbow: return 5000;
        case Fx::Chase:   return 1500;
        case Fx::Sparkle: return 120;
        default:          return 1000;
    }
}

// ── Construction / setup ─────────────────────────────────────────────────────

ArenaController::ArenaController(ArenaLayout& layout, LedEngine& engine, LedOutput& output,
                                 WiFiManager& wifi, WebServerManager& web, Uplink& uplink,
                                 BuzzerController& buzzer, SupplyMonitor& supply)
    : _layout(layout), _engine(engine), _output(output), _wifi(wifi), _web(web),
      _uplink(uplink), _buzzer(buzzer), _supply(supply) {}

void ArenaController::begin() {
    _mtx = xSemaphoreCreateMutex();

    loadSettings();
    applySettingsToOutput();
    _buzzer.setEnabled(_settings.buzzer);

    _engine.begin(&_layout);
    // Runs inside render() (loop task, lock held) — keep it tiny.
    _engine.onCountdown([this](int secondsLeft) {
        if (secondsLeft > 0)       _buzzer.beepTick();
        else if (secondsLeft == 0) _buzzer.beepGo();
        else                       strlcpy(_label, "go", sizeof(_label));   // finished
    });

    _output.configure(_layout);
    applyBootScene();

    _web.onConnection([this](uint32_t id, bool c) { onConnection(id, c); });
    _web.onText([this](uint32_t id, const char* d, size_t n) { onText(id, d, n); });
    _web.onBinary([this](uint32_t id, const uint8_t* d, size_t n) { onBinary(id, d, n); });
    _web.onHttpGet([this](const char* what, String& r) { onHttpGet(what, r); });
    _web.onHttpCmd([this](const char* b, size_t n, const String& t, String& r) { onHttpCmd(b, n, t, r); });
    _web.onTokenCheck([this](const String& t) { return tokenOk(t); });
    _web.onOtaDone([this](bool ok) { if (ok) _rebootAt = millis() + 500; });
    _uplink.onConnection([this](bool c) { onConnection(UPLINK_ID, c); });
    _uplink.onText([this](const char* d, size_t n) { onText(UPLINK_ID, d, n); });

    logHeap("controller ready");
}

// ── Settings ─────────────────────────────────────────────────────────────────

void ArenaController::defaultSettings() {
    LedSettings& s = _settings;
    memset(&s, 0, sizeof(s));
    s.magic      = SETTINGS_MAGIC;
    s.brightness = LED_DEFAULT_BRIGHTNESS;
    strlcpy(s.colorOrder, LED_DEFAULT_COLOR_ORDER, sizeof(s.colorOrder));
    s.gamma      = LED_DEFAULT_GAMMA;
    s.maxWatts   = LED_DEFAULT_MAX_WATTS;
    s.mwPerPixel = (uint16_t)(LED_DEFAULT_WATTS_PER_PX * 1000);
    s.bootScene  = 2;   // rainbow
    s.buzzer     = 1;
    s.cdMs       = CD_DEFAULT_SECONDS * 1000UL;
    s.cdWarnMs   = CD_DEFAULT_WARN_AT * 1000UL;
    s.cdGoMs     = CD_DEFAULT_GO_MS;
    color::parse(CD_DEFAULT_HIGH, s.cdHigh);
    color::parse(CD_DEFAULT_WARN, s.cdWarn);
    color::parse(CD_DEFAULT_GO, s.cdGo);
    s.cdHasThen  = color::parse(CD_DEFAULT_THEN, s.cdThen);
}

void ArenaController::loadSettings() {
    defaultSettings();
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    LedSettings stored{};
    if (p.getBytesLength(NVS_SETTINGS) == sizeof(LedSettings)) {
        p.getBytes(NVS_SETTINGS, &stored, sizeof(LedSettings));
        stored.colorOrder[3] = '\0';
        if (stored.magic == SETTINGS_MAGIC && stored.bootScene < NUM_BOOT_SCENES) {
            _settings = stored;
            Serial.println("[Settings] Loaded from NVS.");
        } else {
            Serial.println("[Settings] Stored settings outdated — using defaults.");
        }
    }
    p.end();
}

void ArenaController::storeSettings() {
    Preferences p;
    if (!p.begin(NVS_NS, false)) return;
    p.putBytes(NVS_SETTINGS, &_settings, sizeof(LedSettings));
    p.end();
    Serial.println("[Settings] Saved to NVS.");
}

void ArenaController::applySettingsToOutput() {
    _output.setBrightness(_settings.brightness);
    if (!_output.setColorOrder(_settings.colorOrder)) _output.setColorOrder(LED_DEFAULT_COLOR_ORDER);
    _output.setGamma(_settings.gamma);
    _output.setPowerLimit(_settings.maxWatts, _settings.mwPerPixel / 1000.0f);
}

void ArenaController::settingsToJson(JsonObject o) const {
    o["brightness"]    = _settings.brightness;
    o["colorOrder"]    = (const char*)_settings.colorOrder;
    o["gamma"]         = (bool)_settings.gamma;
    o["maxWatts"]      = _settings.maxWatts;
    o["wattsPerPixel"] = _settings.mwPerPixel / 1000.0;
    o["bootScene"]     = BOOT_SCENES[_settings.bootScene];
    o["buzzer"]        = (bool)_settings.buzzer;
    JsonObject cd = o["countdown"].to<JsonObject>();
    cd["seconds"] = _settings.cdMs / 1000.0;
    cd["warnAt"]  = _settings.cdWarnMs / 1000.0;
    cd["goMs"]    = _settings.cdGoMs;
    hexInto(cd, "high", _settings.cdHigh);
    hexInto(cd, "warn", _settings.cdWarn);
    hexInto(cd, "go",   _settings.cdGo);
    if (_settings.cdHasThen) hexInto(cd, "then", _settings.cdThen);
    else cd["then"] = "none";
}

bool ArenaController::settingsFromJson(JsonObjectConst in, const char*& err) {
    LedSettings s = _settings;

    if (!in["brightness"].isNull()) {
        int v = in["brightness"] | -1;
        if (v < 0 || v > 255) { err = "brightness 0-255"; return false; }
        s.brightness = v;
    }
    if (!in["colorOrder"].isNull()) {
        const char* co = in["colorOrder"] | "";
        bool found = false;
        for (const char* o : COLOR_ORDERS) if (strcasecmp(co, o) == 0) { strlcpy(s.colorOrder, o, 4); found = true; }
        if (!found) { err = "colorOrder must be RGB/RBG/GRB/GBR/BRG/BGR"; return false; }
    }
    if (!in["gamma"].isNull())  s.gamma  = in["gamma"].as<bool>();
    if (!in["buzzer"].isNull()) s.buzzer = in["buzzer"].as<bool>();
    if (!in["maxWatts"].isNull()) {
        int v = in["maxWatts"] | -1;
        if (v < 0 || v > 2000) { err = "maxWatts 0-2000 (0 = no limit)"; return false; }
        s.maxWatts = v;
    }
    if (!in["wattsPerPixel"].isNull()) {
        float v = in["wattsPerPixel"] | -1.0f;
        if (v < 0.01f || v > 20.0f) { err = "wattsPerPixel 0.01-20"; return false; }
        s.mwPerPixel = (uint16_t)(v * 1000.0f + 0.5f);
    }
    if (!in["bootScene"].isNull()) {
        const char* b = in["bootScene"] | "";
        int idx = -1;
        for (uint8_t i = 0; i < NUM_BOOT_SCENES; i++) if (strcasecmp(b, BOOT_SCENES[i]) == 0) idx = i;
        if (idx < 0) { err = "bootScene: off/white/rainbow/red/yellow/green/blue"; return false; }
        s.bootScene = idx;
    }
    JsonObjectConst cd = in["countdown"];
    if (!cd.isNull()) {
        if (!cd["seconds"].isNull()) {
            float v = cd["seconds"] | -1.0f;
            if (v < 0 || v > 600) { err = "countdown.seconds 0-600"; return false; }
            s.cdMs = (uint32_t)(v * 1000.0f + 0.5f);
        }
        if (!cd["warnAt"].isNull()) {
            float v = cd["warnAt"] | -1.0f;
            if (v < 0 || v > 600) { err = "countdown.warnAt 0-600"; return false; }
            s.cdWarnMs = (uint32_t)(v * 1000.0f + 0.5f);
        }
        if (!cd["goMs"].isNull()) {
            int v = cd["goMs"] | -1;
            if (v < 0 || v > 30000) { err = "countdown.goMs 0-30000"; return false; }
            s.cdGoMs = v;
        }
        if (!colorArg(cd["high"], s.cdHigh, s.cdHigh) || !colorArg(cd["warn"], s.cdWarn, s.cdWarn) ||
            !colorArg(cd["go"], s.cdGo, s.cdGo)) { err = "invalid countdown color"; return false; }
        if (!cd["then"].isNull()) {
            const char* t = cd["then"].as<const char*>();
            if (t && strcasecmp(t, "none") == 0) s.cdHasThen = 0;
            else if (colorArg(cd["then"], s.cdThen, s.cdThen)) s.cdHasThen = 1;
            else { err = "invalid countdown.then"; return false; }
        }
    }
    _settings = s;
    return true;
}

void ArenaController::applyBootScene() {
    const SectionMask all = _layout.allMask();
    switch (_settings.bootScene) {
        case 0: _engine.fill(all, color::BLACK); break;
        case 1: _engine.fill(all, color::WHITE); break;
        case 2: {
            Effect e;
            e.type = Fx::Rainbow; e.mask = all; e.periodMs = 8000;
            _engine.addEffect(e, millis());
            break;
        }
        default: {
            RGB c;
            color::parse(BOOT_SCENES[_settings.bootScene], c);
            _engine.fill(all, c);
            break;
        }
    }
    strlcpy(_label, BOOT_SCENES[_settings.bootScene], sizeof(_label));
    markChanged();
}

void ArenaController::startCountdown(SectionMask mask, uint32_t ms, uint32_t warnMs, uint16_t goMs,
                                     RGB high, RGB warn, RGB go, bool hasThen, RGB then, bool pulse) {
    Effect e;
    e.type      = Fx::Countdown;
    e.mask      = mask;
    e.c1        = high;
    e.cdTotalMs = ms;
    e.cdWarnMs  = warnMs;
    e.cdGoMs    = goMs;
    e.cdWarn    = warn;
    e.cdGo      = go;
    e.cdHasThen = hasThen;
    e.cdThen    = then;
    e.cdPulse   = pulse;
    _engine.addEffect(e, millis());
}

// ── Local inputs ─────────────────────────────────────────────────────────────

void ArenaController::startDefaultCountdown(const char* label) {
    lock();
    const LedSettings& s = _settings;
    startCountdown(_layout.allMask(), s.cdMs, s.cdWarnMs, s.cdGoMs, s.cdHigh, s.cdWarn, s.cdGo,
                   s.cdHasThen, s.cdThen, CD_DEFAULT_PULSE);
    strlcpy(_label, label, sizeof(_label));
    markChanged();
    unlock();
}

void ArenaController::allStop() {
    lock();
    _engine.fill(_layout.allMask(), RGB(255, 0, 0));
    strlcpy(_label, "stop", sizeof(_label));
    markChanged();
    unlock();
}

void ArenaController::requestWifiReset() {
    _forgetWifi = true;
    _rebootAt   = millis() + 300;
}

// ── Sessions / network entry points ──────────────────────────────────────────

ArenaController::Session* ArenaController::findSession(uint32_t id) {
    for (auto& s : _sessions) if (s.id == id) return &s;
    return nullptr;
}

bool ArenaController::tokenOk(const String& token) const {
    return _wifi.token().isEmpty() || token == _wifi.token();
}

void ArenaController::onConnection(uint32_t id, bool connected) {
    lock();
    if (connected) {
        Session* s = findSession(0);
        if (s) {
            *s = Session();
            s->id     = id;
            s->authed = id == UPLINK_ID || _wifi.token().isEmpty();   // the server proved itself with its key
            s->hello  = true;
        }
    } else {
        Session* s = findSession(id);
        if (s) *s = Session();
    }
    unlock();
}

void ArenaController::onText(uint32_t id, const char* data, size_t len) {
    JsonDocument cmd, reply;
    DeserializationError e = deserializeJson(cmd, data, len);
    if (e || !cmd.is<JsonObject>()) {
        reply["type"]  = "error";
        reply["error"] = e ? e.c_str() : "expected a JSON object";
    } else {
        lock();
        Session* s = findSession(id);
        Ctx ctx{s, s && s->authed};
        handle(cmd.as<JsonObjectConst>(), ctx, reply);
        unlock();
    }
    if (!reply.isNull()) sendDoc(id, reply);
}

// Binary 0x01: [0x01][start hi][start lo][r g b]... → base pixels (logical order)
void ArenaController::onBinary(uint32_t id, const uint8_t* data, size_t len) {
    if (len < 3 || data[0] != 0x01) return;
    lock();
    Session* s = findSession(id);
    if (s && s->authed) {
        uint16_t start = (uint16_t)(data[1] << 8 | data[2]);
        _engine.setPixels(start, data + 3, (uint16_t)((len - 3) / 3));
        _dirty = true;
        if (strcmp(_label, "stream") != 0) { strlcpy(_label, "stream", sizeof(_label)); _stateChanged = true; }
    }
    unlock();
}

void ArenaController::onHttpGet(const char* what, String& reply) {
    JsonDocument doc;
    lock();
    if (strcmp(what, "state") == 0)       buildState(doc);
    else if (strcmp(what, "config") == 0) buildConfig(doc);
    else                                  buildStatus(doc);
    unlock();
    serializeJson(doc, reply);
}

void ArenaController::onHttpCmd(const char* body, size_t len, const String& token, String& reply) {
    JsonDocument cmd, out;
    DeserializationError e = deserializeJson(cmd, body, len);
    if (e || !cmd.is<JsonObject>()) {
        out["type"]  = "error";
        out["error"] = e ? e.c_str() : "expected a JSON object";
    } else {
        lock();
        Ctx ctx{nullptr, tokenOk(token) || tokenOk(cmd["token"] | "")};
        handle(cmd.as<JsonObjectConst>(), ctx, out);
        unlock();
        if (out.isNull()) { out["type"] = "ack"; out["ok"] = true; }
    }
    serializeJson(out, reply);
}

// ── Protocol ─────────────────────────────────────────────────────────────────

void ArenaController::setLabel(JsonObjectConst cmd, const char* fallback) {
    const char* l = cmd["label"] | fallback;
    if (l) strlcpy(_label, l, sizeof(_label));
}

void ArenaController::handle(JsonObjectConst cmd, Ctx& ctx, JsonDocument& reply) {
    const char* type = cmd["type"] | "";
    JsonVariantConst id = cmd["id"];
    const char* err = nullptr;

    // ── Read-only / session commands (no token needed) ───────────────────────
    if (!strcmp(type, "ping")) {
        reply["type"] = "pong";
        reply["t"]    = cmd["t"];
        reply["ms"]   = millis();
    } else if (!strcmp(type, "auth")) {
        bool good = tokenOk(cmd["token"] | "");
        if (ctx.session && good) ctx.session->authed = true;
        reply["type"] = "auth";
        reply["ok"]   = good;
    } else if (!strcmp(type, "get_state")) {
        buildState(reply);
    } else if (!strcmp(type, "get_status")) {
        buildStatus(reply);
    } else if (!strcmp(type, "get_config")) {
        buildConfig(reply);
    } else if (!strcmp(type, "subscribe")) {
        if (!ctx.session) { err = "subscribe needs a WebSocket"; }
        else {
            ctx.session->frames  = (cmd["frames"] | false) && ctx.session->id != UPLINK_ID;
            int fps = constrain((int)(cmd["fps"] | 10), 1, FRAMES_MAX_FPS);
            ctx.session->frameMs = 1000 / fps;
        }
    }
    // ── Everything else changes something → needs auth ───────────────────────
    else if (!ctx.authed) {
        err = "auth required";
    } else if (!handleLed(type, cmd, reply, err) && !handleConfig(type, cmd, ctx, reply, err)) {
        err = "unknown type";
    }

    if (err) {
        reply.clear();
        reply["type"]  = "error";
        reply["error"] = err;
        reply["cmd"]   = type;
    } else if (reply.isNull() && !id.isNull()) {
        reply["type"] = "ack";
        reply["ok"]   = true;
        reply["cmd"]  = type;
    }
    if (!reply.isNull() && !id.isNull()) reply["id"] = id;
}

bool ArenaController::handleLed(const char* type, JsonObjectConst cmd, JsonDocument& reply, const char*& err) {
    SectionMask mask = 0;
    const SectionMask all = _layout.allMask();
    const uint32_t now = millis();

    // ── solid / off ──────────────────────────────────────────────────────────
    bool isEffect = !strcmp(type, "effect");
    const char* fxName = isEffect ? (cmd["fx"] | (cmd["effect"] | "")) : "";
    if (!strcmp(type, "solid") || !strcmp(type, "off") ||
        (isEffect && (!strcasecmp(fxName, "solid") || !strcasecmp(fxName, "off")))) {
        bool off = !strcmp(type, "off") || !strcasecmp(fxName, "off");
        if (!_layout.resolve(cmd["target"], mask, err)) return true;
        RGB c = color::BLACK;
        if (!off && !colorArg(cmd["color"], c, color::WHITE)) { err = "invalid color"; return true; }
        _engine.fill(mask, c);
        if (!cmd["label"].isNull() || mask == all) {
            const char* name = cmd["color"].as<const char*>();
            setLabel(cmd, off ? "off" : (name ? name : "solid"));
        }
        markChanged();
        return true;
    }

    // ── effect ───────────────────────────────────────────────────────────────
    if (isEffect) {
        Fx fx = LedEngine::fxFromName(fxName);
        if (fx == Fx::None || fx == Fx::Countdown) { err = "unknown fx"; return true; }
        if (!_layout.resolve(cmd["target"], mask, err)) return true;
        Effect e;
        e.type    = fx;
        e.mask    = mask;
        e.overlay = cmd["overlay"] | false;
        if (!colorArg(cmd["color"], e.c1, color::WHITE) || !colorArg(cmd["color2"], e.c2, color::BLACK)) {
            err = "invalid color"; return true;
        }
        e.periodMs   = (uint16_t)constrain((long)(cmd["period"] | (long)defaultPeriod(fx)), 20L, 60000L);
        e.durationMs = (uint32_t)constrain((long)(cmd["duration"] | 0L), 0L, 86400000L);
        e.value      = (uint16_t)constrain((long)((cmd["value"] | 0.0f) * 1000.0f + 0.5f), 0L, 1000L);
        _engine.addEffect(e, now);
        if (!cmd["label"].isNull() || (mask == all && !e.overlay)) setLabel(cmd, fxName);
        markChanged();
        return true;
    }

    // ── countdown ────────────────────────────────────────────────────────────
    if (!strcmp(type, "countdown")) {
        if (!_layout.resolve(cmd["target"], mask, err)) return true;
        const LedSettings& s = _settings;
        float sec  = cmd["seconds"] | (float)(s.cdMs / 1000.0f);
        float warn = cmd["warnAt"]  | (float)(s.cdWarnMs / 1000.0f);
        long  goMs = cmd["goMs"]    | (long)s.cdGoMs;
        if (sec < 0 || sec > 600 || warn < 0 || warn > 600 || goMs < 0 || goMs > 30000) {
            err = "countdown range: seconds/warnAt 0-600, goMs 0-30000"; return true;
        }
        RGB high, warnC, go, then = s.cdThen;
        bool hasThen = s.cdHasThen;
        if (!colorArg(cmd["high"], high, s.cdHigh) || !colorArg(cmd["warn"], warnC, s.cdWarn) ||
            !colorArg(cmd["go"], go, s.cdGo)) { err = "invalid color"; return true; }
        if (!cmd["then"].isNull()) {
            const char* t = cmd["then"].as<const char*>();
            if (t && !strcasecmp(t, "none")) hasThen = false;
            else if (colorArg(cmd["then"], then, then)) hasThen = true;
            else { err = "invalid then color"; return true; }
        }
        bool pulse = CD_DEFAULT_PULSE;
        if (!cmd["style"].isNull()) {
            const char* st = cmd["style"].as<const char*>();
            if (st && !strcasecmp(st, "pulse"))      pulse = true;
            else if (st && !strcasecmp(st, "solid")) pulse = false;
            else { err = "style must be pulse or solid"; return true; }
        }
        startCountdown(mask, (uint32_t)(sec * 1000.0f + 0.5f), (uint32_t)(warn * 1000.0f + 0.5f),
                       (uint16_t)goMs, high, warnC, go, hasThen, then, pulse);
        setLabel(cmd, "countdown");
        markChanged();
        return true;
    }

    // ── cancel ───────────────────────────────────────────────────────────────
    if (!strcmp(type, "cancel")) {
        if (!_layout.resolve(cmd["target"], mask, err)) return true;
        _engine.cancel(mask);
        if (!cmd["label"].isNull()) setLabel(cmd, "");
        markChanged();
        return true;
    }

    // ── brightness ───────────────────────────────────────────────────────────
    if (!strcmp(type, "brightness")) {
        int v = cmd["value"] | -1;
        if (v < 0 || v > 255) { err = "value 0-255"; return true; }
        _settings.brightness = v;
        _output.setBrightness(v);
        _saveSettings = true;
        _saveAt = now + SAVE_DEBOUNCE_MS;
        markChanged();
        return true;
    }

    // ── pixel / pixels (base layer, logical order) ───────────────────────────
    bool one = !strcmp(type, "pixel");
    if (one || !strcmp(type, "pixels")) {
        uint16_t base = 0, limit = _layout.total();
        if (!cmd["target"].isNull()) {
            int s = _layout.findSection(cmd["target"] | "");
            if (s < 0) { err = "target must be a single section"; return true; }
            base = _layout.start(s);
            limit = _layout.count(s);
        }
        int idx = one ? (cmd["index"] | -1) : (cmd["start"] | 0);
        if (idx < 0 || idx >= limit) { err = "index out of range"; return true; }
        if (cmd["clear"] | false) _engine.fill(all, color::BLACK);
        if (one) {
            RGB c;
            if (!colorArg(cmd["color"], c, color::WHITE)) { err = "invalid color"; return true; }
            _engine.setPixel(base + idx, c);
        } else {
            const char* hex = cmd["hex"] | "";
            size_t hl = strlen(hex);
            if (hl % 6) { err = "hex length must be a multiple of 6"; return true; }
            uint16_t n = min<size_t>(hl / 6, (size_t)(limit - idx));
            for (uint16_t i = 0; i < n * 3; i++) {
                char b[3] = {hex[i * 2], hex[i * 2 + 1], 0};
                char* end;
                _scratch[i] = (uint8_t)strtoul(b, &end, 16);
                if (*end) { err = "invalid hex"; return true; }
            }
            _engine.setPixels(base + idx, _scratch, n);
        }
        if (!cmd["label"].isNull()) setLabel(cmd, "");
        markChanged();
        return true;
    }

    // ── identify (setup aid) ─────────────────────────────────────────────────
    if (!strcmp(type, "identify")) {
        if (cmd["on"] | true) {
            Effect e;
            e.type = Fx::Identify; e.mask = all;
            _engine.addEffect(e, now);
            strlcpy(_label, "identify", sizeof(_label));
        } else {
            _engine.cancel(all);
            strlcpy(_label, "", sizeof(_label));
        }
        markChanged();
        return true;
    }

    return false;
}

bool ArenaController::handleConfig(const char* type, JsonObjectConst cmd, Ctx& ctx,
                                   JsonDocument& reply, const char*& err) {
    const uint32_t now = millis();

    if (!strcmp(type, "set_settings")) {
        JsonObjectConst in = cmd["settings"].is<JsonObjectConst>() ? cmd["settings"].as<JsonObjectConst>() : cmd;
        if (!settingsFromJson(in, err)) return true;
        applySettingsToOutput();
        _saveSettings = true;
        _saveAt = now + SAVE_DEBOUNCE_MS;
        _configChanged = true;
        markChanged();
        return true;
    }

    bool resetLayout = !strcmp(type, "reset_layout");
    if (resetLayout || !strcmp(type, "set_layout")) {
        if (resetLayout) {
            _layout.setDefaults();
        } else {
            JsonObjectConst in = cmd["layout"].is<JsonObjectConst>() ? cmd["layout"].as<JsonObjectConst>() : cmd;
            if (!_layout.fromJson(in, err)) return true;
        }
        _engine.reset();
        // Show section boundaries so the new layout can be checked by eye.
        Effect e;
        e.type = Fx::Identify; e.mask = _layout.allMask();
        _engine.addEffect(e, now);
        strlcpy(_label, "identify", sizeof(_label));
        _reconfigure   = true;
        _saveLayout    = true;
        _saveAt        = now + SAVE_DEBOUNCE_MS;
        _configChanged = true;
        markChanged();
        return true;
    }

    if (!strcmp(type, "wifi_scan")) {
        _scanRequested = true;
        if (ctx.session) ctx.session->scanReq = true;
        return true;
    }

    if (!strcmp(type, "set_wifi")) {
        StaticIpConfig st;
        JsonObjectConst so = cmd["static"];
        st.enabled = so["enabled"] | false;
        st.ip      = so["ip"] | "";
        st.gateway = so["gateway"] | "";
        st.mask    = so["mask"] | "255.255.255.0";
        st.dns     = so["dns"] | "";
        bool keepPass = cmd["pass"].isNull();
        if (!_wifi.saveNetwork(cmd["ssid"] | "", cmd["pass"] | "", st, keepPass, err)) return true;
        _rebootAt = now + 1000;
        reply["type"] = "ack"; reply["ok"] = true; reply["cmd"] = type; reply["reboot"] = true;
        return true;
    }

    if (!strcmp(type, "forget_wifi")) {
        _forgetWifi = true;
        _rebootAt = now + 1000;
        reply["type"] = "ack"; reply["ok"] = true; reply["cmd"] = type; reply["reboot"] = true;
        return true;
    }

    if (!strcmp(type, "set_device")) {
        if (!_wifi.saveDevice(cmd["hostname"] | _wifi.hostname().c_str(), cmd["apSsid"] | "",
                              cmd["apPass"] | "", err)) return true;
        _rebootAt = now + 1000;
        reply["type"] = "ack"; reply["ok"] = true; reply["cmd"] = type; reply["reboot"] = true;
        return true;
    }

    if (!strcmp(type, "set_uplink")) {
        const bool   on      = cmd["enabled"] | false;
        const String url     = cmd["url"] | "";
        const bool   keepKey = cmd["key"].isNull();
        const String key     = cmd["key"] | "";
        if ((on || !url.isEmpty()) && !Uplink::validUrl(url)) { err = "URL must start with wss:// (or ws:// for LAN tests)"; return true; }
        if (key.length() > 64) { err = "key max 64 chars"; return true; }
        if (on && (keepKey ? !_uplink.keySet() : key.isEmpty())) { err = "key required"; return true; }
        _upOn = on; _upUrl = url; _upKeepKey = keepKey; _upKey = key;
        _uplinkSave = true;
        return true;
    }

    if (!strcmp(type, "set_token")) {
        String token = cmd["token"] | "";
        if (token.length() > 32) { err = "token max 32 chars"; return true; }
        _wifi.saveToken(token);
        for (auto& s : _sessions) if (s.id) s.authed = token.isEmpty() || &s == ctx.session;
        _configChanged = true;
        return true;
    }

    if (!strcmp(type, "reboot")) {
        _rebootAt = now + 500;
        reply["type"] = "ack"; reply["ok"] = true; reply["cmd"] = type; reply["reboot"] = true;
        return true;
    }

    if (!strcmp(type, "factory_reset")) {
        _factoryReset = true;
        _rebootAt = now + 1000;
        reply["type"] = "ack"; reply["ok"] = true; reply["cmd"] = type; reply["reboot"] = true;
        return true;
    }

    return false;
}

// ── Messages ─────────────────────────────────────────────────────────────────

void ArenaController::buildState(JsonDocument& doc) {
    doc["type"]       = "state";
    doc["label"]      = (const char*)_label;
    doc["brightness"] = _settings.brightness;
    doc["pixels"]     = _layout.total();
    _engine.toJson(doc.as<JsonObject>(), millis());
}

void ArenaController::buildStatus(JsonDocument& doc) {
    doc["type"]   = "status";
    doc["fw"]     = FW_VERSION_FULL;
    doc["proto"]  = PROTOCOL_VERSION;
    doc["uptime"] = millis() / 1000;
    doc["reset"]  = resetReasonName();
    JsonObject h  = doc["heap"].to<JsonObject>();
    h["free"]     = ESP.getFreeHeap();
    h["min"]      = ESP.getMinFreeHeap();
    h["maxBlock"] = ESP.getMaxAllocHeap();
    h["total"]    = ESP.getHeapSize();
    JsonObject w  = doc["wifi"].to<JsonObject>();
    w["mode"]     = _wifi.modeName();
    w["ip"]       = _wifi.ip();
    w["ssid"]     = _wifi.staSsid();
    w["rssi"]     = _wifi.rssi();
    w["host"]     = _wifi.hostname();
    w["apSsid"]   = _wifi.apSsid();
    doc["clients"] = _clientCount;   // cached: never call into the WS library under our lock
    doc["fps"]     = _fps;
    doc["watts"]   = roundf(_output.watts() * 10) / 10.0;
    doc["limited"] = _output.limited();
    if (_supply.present()) doc["supplyV"] = roundf(_supply.voltage() * 100) / 100.0;
    else                   doc["supplyV"] = nullptr;
    doc["pixels"]  = _layout.total();
    doc["auth"]    = !_wifi.token().isEmpty();
    doc["uplink"]  = _uplink.stateName();
}

void ArenaController::buildConfig(JsonDocument& doc) {
    doc["type"]  = "config";
    doc["fw"]    = FW_VERSION_FULL;
    doc["proto"] = PROTOCOL_VERSION;
    _layout.toJson(doc["layout"].to<JsonObject>());
    settingsToJson(doc["settings"].to<JsonObject>());
    JsonObject d = doc["device"].to<JsonObject>();
    d["hostname"] = _wifi.hostname();
    d["apSsid"]   = _wifi.apSsid();
    d["tokenSet"] = !_wifi.token().isEmpty();
    JsonObject up = doc["uplink"].to<JsonObject>();
    up["enabled"] = _uplink.enabled();
    up["url"]     = _uplink.url();
    up["keySet"]  = _uplink.keySet();
    JsonObject w = doc["wifi"].to<JsonObject>();
    w["ssid"] = _wifi.staSsid();
    const StaticIpConfig& st = _wifi.staticIp();
    JsonObject so = w["static"].to<JsonObject>();
    so["enabled"] = st.enabled;
    so["ip"]      = st.ip;
    so["gateway"] = st.gateway;
    so["mask"]    = st.mask;
    so["dns"]     = st.dns;
    JsonObject l = doc["limits"].to<JsonObject>();
    l["maxPixels"]   = LED_MAX_PIXELS;
    l["maxSections"] = LED_MAX_SECTIONS;
    l["maxGroups"]   = LED_MAX_GROUPS;
    l["maxEffects"]  = LED_MAX_EFFECTS;
    JsonArray bs = doc["bootScenes"].to<JsonArray>();
    for (const char* b : BOOT_SCENES) bs.add(b);
}

void ArenaController::sendDoc(uint32_t id, JsonDocument& doc) {
    String s;
    serializeJson(doc, s);
    if (id == UPLINK_ID) _uplink.send(s.c_str(), s.length());
    else                 _web.sendText(id, s.c_str(), s.length());
}

void ArenaController::broadcastDoc(JsonDocument& doc) {
    String s;
    serializeJson(doc, s);
    _web.broadcastText(s.c_str(), s.length());
    _uplink.send(s.c_str(), s.length());   // no-op when the uplink is down
}

void ArenaController::logHeap(const char* tag) {
    Serial.printf("[Heap] %-18s free=%u  min=%u  maxBlock=%u  (total %u)\n", tag,
                  ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getMaxAllocHeap(), ESP.getHeapSize());
}

// ── Loop ─────────────────────────────────────────────────────────────────────

void ArenaController::sendFrames(uint32_t now) {
    // Snapshot recipients under the lock, send outside it.
    uint32_t ids[WS_MAX_CLIENTS + 2];
    uint8_t  n = 0;
    lock();
    for (auto& s : _sessions) {
        if (s.id && s.frames && now - s.lastFrame >= s.frameMs) {
            s.lastFrame = now;
            ids[n++] = s.id;
        }
    }
    unlock();
    const size_t len = 3 + 3 * (size_t)((_preview[1] << 8) | _preview[2]);
    for (uint8_t i = 0; i < n; i++) {
        if (_web.canSend(ids[i])) _web.sendBinary(ids[i], _preview, len);   // skip slow clients
    }
}

void ArenaController::update(uint32_t now) {
    // RULE: never call WebServerManager/AsyncWebSocket while holding _mtx.
    // The library fires WS_EVT_CONNECT with its client-list lock held and our
    // handler then takes _mtx — the reverse order here would deadlock.
    _clientCount = (uint8_t)_web.clientCount();

    // ── Render ───────────────────────────────────────────────────────────────
    uint32_t interval = _engine.animating() ? 1000 / LED_FPS : LED_IDLE_REFRESH_MS;
    if (_dirty || now - _lastFrame >= interval) {
        bool wantFrames = false;
        lock();
        _dirty = false;
        if (_reconfigure) { _reconfigure = false; _output.configure(_layout); }
        _engine.render(now);
        _output.show(_engine.frame(), _layout);
        if (_engine.takeChanged()) _stateChanged = true;
        for (auto& s : _sessions) if (s.id && s.frames && now - s.lastFrame >= s.frameMs) wantFrames = true;
        if (wantFrames && ESP.getFreeHeap() > WS_MIN_HEAP_FRAMES) {
            uint16_t total = _layout.total();
            _preview[0] = 0x02;
            _preview[1] = total >> 8;
            _preview[2] = total & 0xFF;
            memcpy(_preview + 3, _engine.frame(), 3 * (size_t)total);
        } else {
            wantFrames = false;
        }
        unlock();
        _lastFrame = now;
        _fpsCount++;
        if (wantFrames) sendFrames(now);
    }
    if (now - _fpsWindow >= 1000) { _fps = _fpsCount; _fpsCount = 0; _fpsWindow = now; }

    // ── Greet new clients: config → state → status ───────────────────────────
    for (auto& s : _sessions) {
        if (!s.id || !s.hello) continue;
        JsonDocument c, st, ss;
        lock();
        s.hello = false;
        uint32_t id = s.id;
        buildConfig(c); buildState(st); buildStatus(ss);
        unlock();
        sendDoc(id, c); sendDoc(id, st); sendDoc(id, ss);
    }

    // ── Broadcasts ───────────────────────────────────────────────────────────
    if (_configChanged) {
        JsonDocument doc;
        lock(); _configChanged = false; buildConfig(doc); unlock();
        broadcastDoc(doc);
    }
    if (_stateChanged && now - _lastState >= STATE_MIN_INTERVAL_MS) {
        JsonDocument doc;
        lock(); _stateChanged = false; buildState(doc); unlock();
        broadcastDoc(doc);
        _lastState = now;
    }
    if (now - _lastStatus >= STATUS_INTERVAL_MS) {
        JsonDocument doc;
        lock(); buildStatus(doc); unlock();
        broadcastDoc(doc);
        _lastStatus = now;
    }

    // ── WiFi scan (started here so the WiFi driver is only driven from loop) ─
    if (_scanRequested) { _scanRequested = false; _wifi.startScan(); }
    if (_wifi.scanning()) {
        JsonDocument doc;
        doc["type"] = "wifi_scan";
        if (_wifi.scanResults(doc["networks"].to<JsonArray>())) {
            // Never send while holding our mutex: the WS library takes its own
            // lock around event callbacks, which take ours → lock-order deadlock.
            uint32_t ids[WS_MAX_CLIENTS + 2];
            uint8_t  n = 0;
            lock();
            for (auto& s : _sessions) if (s.id && s.scanReq) { s.scanReq = false; ids[n++] = s.id; }
            unlock();
            for (uint8_t i = 0; i < n; i++) sendDoc(ids[i], doc);
        }
    }

    // ── Supply voltage ───────────────────────────────────────────────────────
    if (now - _lastSupply >= SUPPLY_READ_MS) { _supply.update(); _lastSupply = now; }

    // ── Match-server uplink: settings + start/stop with WiFi ─────────────────
    if (_uplinkSave) {
        lock();
        _uplinkSave = false;
        String url = _upUrl, key = _upKey;
        bool on = _upOn, keep = _upKeepKey;
        unlock();
        const char* e = nullptr;
        if (!_uplink.save(url, key, keep, on, e)) Serial.printf("[Uplink] Save failed: %s\n", e);
        _configChanged = true;
    }
    _uplink.update(_wifi.staConnected());

    // ── Deferred NVS writes ──────────────────────────────────────────────────
    if ((_saveSettings || _saveLayout) && (int32_t)(now - _saveAt) >= 0) {
        lock();
        if (_saveSettings) { storeSettings(); _saveSettings = false; }
        if (_saveLayout)   { _layout.save(); _saveLayout = false; }
        unlock();
        _buzzer.setEnabled(_settings.buzzer);
    }

    // ── Heap watchdog ────────────────────────────────────────────────────────
    if (now - _lastHeapLog >= HEAP_LOG_INTERVAL_MS) {
        _lastHeapLog = now;
        logHeap("periodic");
        if (ESP.getFreeHeap() < HEAP_WARN_BYTES)
            Serial.printf("[Heap] WARNING: free heap below %u bytes!\n", HEAP_WARN_BYTES);
    }

    // ── Deferred reboot ──────────────────────────────────────────────────────
    if (_rebootAt && (int32_t)(now - _rebootAt) >= 0) {
        lock();
        if (_saveSettings) storeSettings();
        if (_saveLayout)   _layout.save();
        unlock();
        if (_factoryReset) {
            _wifi.factoryReset();
            _uplink.factoryReset();
            Preferences p; p.begin(NVS_NS, false); p.clear(); p.end();
        } else if (_forgetWifi) {
            _wifi.clearNetwork();
        }
        Serial.println("[Main] Rebooting...");
        _web.closeAll();
        delay(200);
        ESP.restart();
    }
}

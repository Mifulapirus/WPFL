// =============================================================================
// ArenaLayout.cpp — Sections, groups and pixel mapping (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "ArenaLayout.h"
#include <Preferences.h>

static const char*    NVS_NS        = "leds";
static const char*    NVS_KEY       = "layout";
static const uint16_t LAYOUT_MAGIC  = 0xA7E1;   // bump if LayoutCfg changes shape

// ── Default layout ────────────────────────────────────────────────────────────
// Chain order (one data line), starting at the NW top corner:
//   ceil_n (NW→NE) → edge_ne (top→bottom) → [data return wire up the NE edge]
//   → ceil_e (NE→SE) → edge_se → ceil_s (SE→SW) → edge_sw → ceil_w (SW→NW) → edge_nw
// See docs/wiring.md. Red robot side = west half, blue = east half.
struct DefaultSection { const char* name; uint16_t count; };
static const DefaultSection DEFAULT_SECTIONS[] = {
    {"ceil_n",  LED_DEFAULT_CEILING_PIXELS}, {"edge_ne", LED_DEFAULT_EDGE_PIXELS},
    {"ceil_e",  LED_DEFAULT_CEILING_PIXELS}, {"edge_se", LED_DEFAULT_EDGE_PIXELS},
    {"ceil_s",  LED_DEFAULT_CEILING_PIXELS}, {"edge_sw", LED_DEFAULT_EDGE_PIXELS},
    {"ceil_w",  LED_DEFAULT_CEILING_PIXELS}, {"edge_nw", LED_DEFAULT_EDGE_PIXELS},
};

void ArenaLayout::setDefaults() {
    memset(&_cfg, 0, sizeof(_cfg));
    _cfg.magic = LAYOUT_MAGIC;
    _cfg.numSections = sizeof(DEFAULT_SECTIONS) / sizeof(DEFAULT_SECTIONS[0]);
    for (uint8_t i = 0; i < _cfg.numSections; i++) {
        strlcpy(_cfg.sections[i].name, DEFAULT_SECTIONS[i].name, LED_NAME_LEN);
        _cfg.sections[i].count = DEFAULT_SECTIONS[i].count;
    }
    auto secBit = [this](const char* n) -> SectionMask {
        for (uint8_t i = 0; i < _cfg.numSections; i++)
            if (strcmp(_cfg.sections[i].name, n) == 0) return (SectionMask)(1u << i);
        return 0;
    };
    const struct { const char* name; SectionMask mask; } groups[] = {
        {"ceiling", (SectionMask)(secBit("ceil_n") | secBit("ceil_e") | secBit("ceil_s") | secBit("ceil_w"))},
        {"edges",   (SectionMask)(secBit("edge_ne") | secBit("edge_se") | secBit("edge_sw") | secBit("edge_nw"))},
        {"red",     (SectionMask)(secBit("ceil_w") | secBit("edge_nw") | secBit("edge_sw"))},
        {"blue",    (SectionMask)(secBit("ceil_e") | secBit("edge_ne") | secBit("edge_se"))},
    };
    _cfg.numGroups = sizeof(groups) / sizeof(groups[0]);
    for (uint8_t i = 0; i < _cfg.numGroups; i++) {
        strlcpy(_cfg.groups[i].name, groups[i].name, LED_NAME_LEN);
        _cfg.groups[i].mask = groups[i].mask;
    }
    recompute();
}

void ArenaLayout::begin() {
    Preferences prefs;
    LayoutCfg loaded{};
    bool ok = false;
    // Read-write open so the namespace exists on a blank NVS partition.
    if (prefs.begin(NVS_NS, false)) {
        if (prefs.getBytesLength(NVS_KEY) == sizeof(LayoutCfg)) {
            prefs.getBytes(NVS_KEY, &loaded, sizeof(LayoutCfg));
            const char* err = nullptr;
            ok = loaded.magic == LAYOUT_MAGIC && validate(loaded, err);
            if (!ok) Serial.printf("[Layout] Stored layout invalid (%s) — using defaults.\n",
                                   err ? err : "bad magic");
        }
        prefs.end();
    }
    if (ok) {
        _cfg = loaded;
        for (uint8_t i = 0; i < _cfg.numSections; i++) _cfg.sections[i].reserved = 0;  // old output B
        recompute();
    } else {
        setDefaults();
    }
    Serial.printf("[Layout] %u sections, %u groups, %u pixels\n",
                  _cfg.numSections, _cfg.numGroups, _total);
}

bool ArenaLayout::save() const {
    Preferences prefs;
    if (!prefs.begin(NVS_NS, false)) return false;
    size_t n = prefs.putBytes(NVS_KEY, &_cfg, sizeof(LayoutCfg));
    prefs.end();
    Serial.printf("[Layout] Saved to NVS (%u bytes).\n", (unsigned)n);
    return n == sizeof(LayoutCfg);
}

void ArenaLayout::recompute() {
    _total = 0;
    for (uint8_t i = 0; i < _cfg.numSections; i++) {
        _start[i] = _total;
        _total   += _cfg.sections[i].count;
    }
}

SectionMask ArenaLayout::allMask() const {
    return _cfg.numSections >= 16 ? 0xFFFF : (SectionMask)((1u << _cfg.numSections) - 1);
}

int ArenaLayout::findSection(const char* name) const {
    for (uint8_t i = 0; i < _cfg.numSections; i++)
        if (strcasecmp(_cfg.sections[i].name, name) == 0) return i;
    return -1;
}

int ArenaLayout::findGroup(const char* name) const {
    for (uint8_t i = 0; i < _cfg.numGroups; i++)
        if (strcasecmp(_cfg.groups[i].name, name) == 0) return i;
    return -1;
}

uint16_t ArenaLayout::pixelsIn(SectionMask mask) const {
    uint16_t n = 0;
    for (uint8_t i = 0; i < _cfg.numSections; i++)
        if (mask & (1u << i)) n += _cfg.sections[i].count;
    return n;
}

int ArenaLayout::sectionOfPixel(uint16_t logical) const {
    for (uint8_t i = 0; i < _cfg.numSections; i++)
        if (logical >= _start[i] && logical < _start[i] + _cfg.sections[i].count) return i;
    return -1;
}

bool ArenaLayout::resolveToken(const char* tok, size_t len, SectionMask& mask) const {
    while (len && *tok == ' ') { tok++; len--; }
    while (len && tok[len - 1] == ' ') len--;
    if (len == 0 || len >= LED_NAME_LEN) return false;
    char name[LED_NAME_LEN];
    memcpy(name, tok, len);
    name[len] = '\0';
    if (strcasecmp(name, "all") == 0) { mask |= allMask(); return true; }
    int g = findGroup(name);
    if (g >= 0) { mask |= _cfg.groups[g].mask; return true; }
    int s = findSection(name);
    if (s >= 0) { mask |= (SectionMask)(1u << s); return true; }
    return false;
}

bool ArenaLayout::resolve(JsonVariantConst target, SectionMask& mask, const char*& err) const {
    mask = 0;
    if (target.isNull()) { mask = allMask(); return true; }
    if (target.is<const char*>()) {
        const char* s = target.as<const char*>();
        while (*s) {
            const char* comma = strchr(s, ',');
            size_t len = comma ? (size_t)(comma - s) : strlen(s);
            if (!resolveToken(s, len, mask)) { err = "unknown target"; return false; }
            s += len + (comma ? 1 : 0);
        }
        if (!mask) { err = "empty target"; return false; }
        return true;
    }
    if (target.is<JsonArrayConst>()) {
        for (JsonVariantConst v : target.as<JsonArrayConst>()) {
            const char* s = v.as<const char*>();
            if (!s || !resolveToken(s, strlen(s), mask)) { err = "unknown target"; return false; }
        }
        if (!mask) { err = "empty target"; return false; }
        return true;
    }
    err = "target must be a string or array";
    return false;
}

// ── JSON ─────────────────────────────────────────────────────────────────────

bool ArenaLayout::validName(const char* s) {
    size_t n = strlen(s);
    if (n == 0 || n >= LED_NAME_LEN) return false;
    if (strcasecmp(s, "all") == 0) return false;
    for (size_t i = 0; i < n; i++) {
        char c = s[i];
        if (!(isalnum((unsigned char)c) || c == '_' || c == '-')) return false;
    }
    return true;
}

bool ArenaLayout::validate(const LayoutCfg& c, const char*& err) {
    if (c.numSections == 0 || c.numSections > LED_MAX_SECTIONS) { err = "1-16 sections required"; return false; }
    if (c.numGroups > LED_MAX_GROUPS) { err = "too many groups"; return false; }
    uint32_t total = 0;
    for (uint8_t i = 0; i < c.numSections; i++) {
        const SectionCfg& s = c.sections[i];
        if (!memchr(s.name, 0, LED_NAME_LEN) || !validName(s.name)) { err = "invalid section name"; return false; }
        if (s.count == 0) { err = "section count must be >= 1"; return false; }
        total += s.count;
        for (uint8_t j = 0; j < i; j++)
            if (strcasecmp(c.sections[j].name, s.name) == 0) { err = "duplicate section name"; return false; }
    }
    if (total > LED_MAX_PIXELS) { err = "too many pixels"; return false; }
    SectionMask all = c.numSections >= 16 ? 0xFFFF : (SectionMask)((1u << c.numSections) - 1);
    for (uint8_t i = 0; i < c.numGroups; i++) {
        const GroupCfg& g = c.groups[i];
        if (!memchr(g.name, 0, LED_NAME_LEN) || !validName(g.name)) { err = "invalid group name"; return false; }
        if (g.mask & ~all) { err = "group references missing section"; return false; }
        for (uint8_t j = 0; j < c.numSections; j++)
            if (strcasecmp(c.sections[j].name, g.name) == 0) { err = "group name clashes with section"; return false; }
        for (uint8_t j = 0; j < i; j++)
            if (strcasecmp(c.groups[j].name, g.name) == 0) { err = "duplicate group name"; return false; }
    }
    return true;
}

bool ArenaLayout::fromJson(JsonObjectConst in, const char*& err) {
    LayoutCfg c{};
    c.magic = LAYOUT_MAGIC;

    JsonArrayConst secs = in["sections"];
    if (secs.isNull()) { err = "sections missing"; return false; }
    if (secs.size() == 0 || secs.size() > LED_MAX_SECTIONS) { err = "1-16 sections required"; return false; }
    for (JsonObjectConst s : secs) {
        SectionCfg& d = c.sections[c.numSections++];
        const char* name = s["name"] | "";
        if (strlen(name) >= LED_NAME_LEN) { err = "section name too long"; return false; }
        strlcpy(d.name, name, LED_NAME_LEN);
        for (char* p = d.name; *p; p++) *p = tolower((unsigned char)*p);
        int count = s["count"] | 0;
        if (count < 1 || count > LED_MAX_PIXELS) { err = "invalid section count"; return false; }
        d.count    = (uint16_t)count;
        d.reversed = (s["rev"] | false) ? 1 : 0;
    }

    JsonArrayConst grps = in["groups"];
    if (grps.size() > LED_MAX_GROUPS) { err = "too many groups"; return false; }
    for (JsonObjectConst g : grps) {
        GroupCfg& d = c.groups[c.numGroups++];
        const char* name = g["name"] | "";
        if (strlen(name) >= LED_NAME_LEN) { err = "group name too long"; return false; }
        strlcpy(d.name, name, LED_NAME_LEN);
        for (char* p = d.name; *p; p++) *p = tolower((unsigned char)*p);
        d.mask = 0;
        for (JsonVariantConst v : g["sections"].as<JsonArrayConst>()) {
            const char* sn = v.as<const char*>();
            int idx = -1;
            for (uint8_t i = 0; sn && i < c.numSections; i++)
                if (strcasecmp(c.sections[i].name, sn) == 0) { idx = i; break; }
            if (idx < 0) { err = "group references unknown section"; return false; }
            d.mask |= (SectionMask)(1u << idx);
        }
    }

    if (!validate(c, err)) return false;
    _cfg = c;
    recompute();
    return true;
}

void ArenaLayout::toJson(JsonObject out) const {
    JsonArray secs = out["sections"].to<JsonArray>();
    for (uint8_t i = 0; i < _cfg.numSections; i++) {
        const SectionCfg& s = _cfg.sections[i];
        JsonObject o = secs.add<JsonObject>();
        o["name"]  = (const char*)s.name;  // cast: char[] would be treated as a literal
        o["count"] = s.count;
        o["rev"]   = (bool)s.reversed;
        o["start"] = _start[i];
    }
    JsonArray grps = out["groups"].to<JsonArray>();
    for (uint8_t i = 0; i < _cfg.numGroups; i++) {
        JsonObject o = grps.add<JsonObject>();
        o["name"] = (const char*)_cfg.groups[i].name;
        JsonArray m = o["sections"].to<JsonArray>();
        for (uint8_t s = 0; s < _cfg.numSections; s++)
            if (_cfg.groups[i].mask & (1u << s)) m.add((const char*)_cfg.sections[s].name);
    }
    out["total"] = _total;
}

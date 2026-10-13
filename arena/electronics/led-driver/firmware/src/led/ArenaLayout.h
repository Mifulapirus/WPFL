#pragma once
// =============================================================================
// ArenaLayout.h — Sections, groups and the logical → physical pixel map
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// TERMS
//   pixel   — one addressable unit. On the PAUTIX COB strip that is one
//             WS2811 IC = one 10 cm segment (63 LEDs).
//   section — a physical run of strip (e.g. "ceil_n", 12 pixels). It may be
//             mounted reversed.
//   group   — a named set of sections (e.g. "ceiling", "red").
//   target  — what a command acts on: "all", a group, a section, a
//             comma-separated list ("ceil_n,edge_ne") or a JSON array of those.
//
// LOGICAL vs PHYSICAL ORDER
//   Logical pixel index = sections concatenated in list order, each running
//   from its own index 0 (ceiling: clockwise seen from above; edges: top→down).
//   Physical order = position on the single data chain. Sections are chained
//   in list order; "reversed" flips a section in place.
//   → The section list order IS the wiring order.
//
// Layout is persisted in NVS (namespace "leds", key "layout") as a fixed-size
// blob, so there is no heap allocation after boot.
// =============================================================================

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"

using SectionMask = uint16_t;   // one bit per section (LED_MAX_SECTIONS ≤ 16)
static_assert(LED_MAX_SECTIONS <= 16, "SectionMask is 16 bits");

struct SectionCfg {
    char     name[LED_NAME_LEN];
    uint16_t count;      // pixels in this section
    uint8_t  reserved;   // was the output (A/B) index; always 0, keeps the NVS blob shape
    uint8_t  reversed;   // 1 = mounted backwards relative to its logical direction
};

struct GroupCfg {
    char        name[LED_NAME_LEN];
    SectionMask mask;
};

struct LayoutCfg {
    uint16_t   magic;
    uint8_t    numSections;
    uint8_t    numGroups;
    SectionCfg sections[LED_MAX_SECTIONS];
    GroupCfg   groups[LED_MAX_GROUPS];
};

class ArenaLayout {
public:
    // Load from NVS, falling back to the default 4×ceiling + 4×edge layout.
    void begin();

    // Persist the current layout to NVS. Call from loop(), not a network callback.
    bool save() const;

    // Replace with the compiled-in default layout (not saved).
    void setDefaults();

    // Validate and apply a layout from JSON ({"sections":[...],"groups":[...]}).
    // On error nothing changes and `err` points at a static message.
    bool fromJson(JsonObjectConst in, const char*& err);
    void toJson(JsonObject out) const;

    // ── Queries ──────────────────────────────────────────────────────────────
    uint8_t  numSections() const               { return _cfg.numSections; }
    uint8_t  numGroups() const                 { return _cfg.numGroups; }
    const SectionCfg& section(uint8_t i) const { return _cfg.sections[i]; }
    const GroupCfg&   group(uint8_t i) const   { return _cfg.groups[i]; }
    uint16_t start(uint8_t i) const            { return _start[i]; }      // logical = chain start
    uint16_t count(uint8_t i) const            { return _cfg.sections[i].count; }
    uint16_t total() const                     { return _total; }
    SectionMask allMask() const;

    int findSection(const char* name) const;   // -1 if not found
    int findGroup(const char* name) const;     // -1 if not found

    // Resolve a command target. Null/missing → all sections.
    bool resolve(JsonVariantConst target, SectionMask& mask, const char*& err) const;

    // Number of pixels covered by a mask.
    uint16_t pixelsIn(SectionMask mask) const;

    // Section index containing a logical pixel (-1 if out of range).
    int sectionOfPixel(uint16_t logical) const;

private:
    LayoutCfg _cfg{};
    uint16_t  _start[LED_MAX_SECTIONS]  = {};
    uint16_t  _total = 0;

    void recompute();
    bool resolveToken(const char* tok, size_t len, SectionMask& mask) const;
    static bool validate(const LayoutCfg& c, const char*& err);
    static bool validName(const char* s);
};

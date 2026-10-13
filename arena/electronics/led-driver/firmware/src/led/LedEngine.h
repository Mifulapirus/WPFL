#pragma once
// =============================================================================
// LedEngine.h — What color every pixel should be, right now
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// MODEL (two layers, all static memory):
//
//   1. BASE buffer  — one RGB per logical pixel. Set by "solid"/"off"/"pixel"/
//                     binary frames. Static: it just stays.
//   2. EFFECT slots — up to LED_MAX_EFFECTS animations, each on a section mask,
//                     drawn over the base in the order they were added.
//
//   Every frame: out = base, then each effect paints its sections.
//
// LAYERING RULES (what replaces what):
//   • fill / setPixels on sections S   → removes S from EVERY effect.
//   • a normal effect on S             → removes S from every existing effect.
//   • an OVERLAY effect (overlay=true) → stacks on top, removes nothing.
//     Use overlays for temporary alerts (e.g. "red robot fault" blinking for
//     3 s): when an effect with a duration ends, whatever was below shows again.
//
// COUNTDOWN is an effect: HIGH color while remaining > warnAt, WARN color
// until 0, then GO color flashing for goMs, then (optionally) THEN color is
// written into the base buffer. A callback fires on every whole second and
// at GO, used for buzzer beeps and state broadcasts.
//
// THREADING: not thread-safe. ArenaController serializes access with a mutex.
// =============================================================================

#include <Arduino.h>
#include <ArduinoJson.h>
#include <functional>
#include "config.h"
#include "Color.h"
#include "ArenaLayout.h"

enum class Fx : uint8_t {
    None = 0,
    Blink,      // c1/c2 alternate every period/2
    Breathe,    // smooth fade c2 → c1 → c2 per period
    Rainbow,    // moving hue wheel across the target
    Chase,      // comet in c1 over c2, one lap per period
    Progress,   // first value/1000 of the target in c1, rest c2
    Sparkle,    // random twinkle of c1 over c2, re-rolled every period
    Identify,   // each section its own hue, first pixel white (setup aid)
    Countdown,  // see header comment
};

struct Effect {
    Fx          type       = Fx::None;
    bool        overlay    = false;
    SectionMask mask       = 0;
    RGB         c1         = color::WHITE;
    RGB         c2         = color::BLACK;
    uint16_t    periodMs   = 1000;
    uint16_t    value      = 0;      // Progress: 0–1000
    uint32_t    startMs    = 0;
    uint32_t    durationMs = 0;      // 0 = until replaced or cancelled

    // Countdown only (c1 = HIGH color)
    uint32_t    cdTotalMs  = 0;
    uint32_t    cdWarnMs   = 0;
    uint16_t    cdGoMs     = 0;
    RGB         cdWarn, cdGo, cdThen;
    bool        cdHasThen  = false;
    int16_t     cdLastSec  = -1;
};

class LedEngine {
public:
    // secondsLeft > 0: a new whole second started. 0: GO. -1: finished (GO phase over).
    using CountdownCallback = std::function<void(int secondsLeft)>;

    void begin(const ArenaLayout* layout);

    // Clear everything (base + effects). Call after the layout changes.
    void reset();

    // ── Base layer ───────────────────────────────────────────────────────────
    void fill(SectionMask mask, const RGB& c);
    // Logical pixels [start, start+n) from packed RGB triplets.
    void setPixels(uint16_t start, const uint8_t* rgb, uint16_t n);
    void setPixel(uint16_t index, const RGB& c);

    // ── Effects ──────────────────────────────────────────────────────────────
    // Adds an effect (startMs is set to now). Drops the oldest if slots are full.
    void addEffect(Effect e, uint32_t now);
    // Remove the sections in mask from every effect (base stays as is).
    void cancel(SectionMask mask);

    // ── Rendering ────────────────────────────────────────────────────────────
    void render(uint32_t now);
    const RGB* frame() const  { return _out; }
    // True if the frame changes over time (needs LED_FPS renders). Identify is
    // static, so it only gets the idle refresh, like a solid fill.
    bool animating() const;

    // True once after any change worth broadcasting (effect start/end, tick).
    bool takeChanged()        { bool c = _changed; _changed = false; return c; }

    void onCountdown(CountdownCallback cb) { _cdCallback = cb; }

    // {"effects":[...], "countdown":{...}} for state broadcasts.
    void toJson(JsonObject out, uint32_t now) const;

    static const char* fxName(Fx fx);
    static Fx          fxFromName(const char* name);

private:
    const ArenaLayout* _layout = nullptr;
    RGB     _base[LED_MAX_PIXELS];
    RGB     _out[LED_MAX_PIXELS];
    Effect  _fx[LED_MAX_EFFECTS];
    uint8_t _count   = 0;
    bool    _changed = false;
    CountdownCallback _cdCallback;

    void trim(SectionMask mask);
    void compact();
    // Returns false when the effect has finished and should be removed.
    bool renderEffect(Effect& e, uint32_t now);
    void paint(SectionMask mask, const RGB& c, RGB* buf);
};

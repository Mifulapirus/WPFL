// =============================================================================
// LedEngine.cpp — Base buffer + effect slots (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "LedEngine.h"

static const char* const FX_NAMES[] = {
    "none", "blink", "breathe", "rainbow", "chase", "progress", "sparkle", "identify", "countdown"
};

const char* LedEngine::fxName(Fx fx) {
    uint8_t i = (uint8_t)fx;
    return i < sizeof(FX_NAMES) / sizeof(FX_NAMES[0]) ? FX_NAMES[i] : "none";
}

Fx LedEngine::fxFromName(const char* name) {
    if (!name) return Fx::None;
    for (uint8_t i = 1; i < sizeof(FX_NAMES) / sizeof(FX_NAMES[0]); i++)
        if (strcasecmp(name, FX_NAMES[i]) == 0) return (Fx)i;
    return Fx::None;
}

void LedEngine::begin(const ArenaLayout* layout) {
    _layout = layout;
    reset();
}

void LedEngine::reset() {
    memset(_base, 0, sizeof(_base));
    memset(_out, 0, sizeof(_out));
    _count   = 0;
    _changed = true;
}

// ── Base layer ───────────────────────────────────────────────────────────────

void LedEngine::paint(SectionMask mask, const RGB& c, RGB* buf) {
    for (uint8_t s = 0; s < _layout->numSections(); s++) {
        if (!(mask & (1u << s))) continue;
        RGB* p = buf + _layout->start(s);
        for (uint16_t i = 0, n = _layout->count(s); i < n; i++) p[i] = c;
    }
}

void LedEngine::fill(SectionMask mask, const RGB& c) {
    trim(mask);
    paint(mask, c, _base);
}

void LedEngine::setPixels(uint16_t start, const uint8_t* rgb, uint16_t n) {
    uint16_t total = _layout->total();
    if (start >= total) return;
    if (n > total - start) n = total - start;
    SectionMask touched = 0;
    for (uint8_t s = 0; s < _layout->numSections(); s++) {
        uint16_t a = _layout->start(s), b = a + _layout->count(s);
        if (a < start + n && b > start) touched |= (1u << s);
    }
    trim(touched);
    for (uint16_t i = 0; i < n; i++, rgb += 3) _base[start + i] = RGB(rgb[0], rgb[1], rgb[2]);
}

void LedEngine::setPixel(uint16_t index, const RGB& c) {
    uint8_t rgb[3] = {c.r, c.g, c.b};
    setPixels(index, rgb, 1);
}

// ── Effects ──────────────────────────────────────────────────────────────────

void LedEngine::trim(SectionMask mask) {
    if (!mask) return;
    bool any = false;
    for (uint8_t i = 0; i < _count; i++) {
        if (_fx[i].mask & mask) {
            _fx[i].mask &= ~mask;
            if (!_fx[i].mask) _fx[i].type = Fx::None;
            any = true;
        }
    }
    if (any) { compact(); _changed = true; }
}

void LedEngine::compact() {
    uint8_t w = 0;
    for (uint8_t r = 0; r < _count; r++) {
        if (_fx[r].type == Fx::None) continue;
        if (w != r) _fx[w] = _fx[r];
        w++;
    }
    _count = w;
}

void LedEngine::addEffect(Effect e, uint32_t now) {
    if (e.type == Fx::None || !e.mask) return;
    if (!e.overlay) trim(e.mask);
    if (_count >= LED_MAX_EFFECTS) {      // drop the oldest
        _fx[0].type = Fx::None;
        compact();
    }
    if (e.periodMs < 20) e.periodMs = 20;
    e.startMs   = now;
    e.cdLastSec = -1;
    _fx[_count++] = e;
    _changed = true;
}

void LedEngine::cancel(SectionMask mask) {
    trim(mask);
}

bool LedEngine::animating() const {
    for (uint8_t i = 0; i < _count; i++)
        if (_fx[i].type != Fx::Identify || _fx[i].durationMs) return true;
    return false;
}

// ── Rendering ────────────────────────────────────────────────────────────────

void LedEngine::render(uint32_t now) {
    memcpy(_out, _base, sizeof(RGB) * _layout->total());
    bool removed = false;
    for (uint8_t i = 0; i < _count; i++) {
        if (!renderEffect(_fx[i], now)) { _fx[i].type = Fx::None; removed = true; }
    }
    if (removed) { compact(); _changed = true; }
}

bool LedEngine::renderEffect(Effect& e, uint32_t now) {
    const uint32_t elapsed = now - e.startMs;

    // ── Countdown ────────────────────────────────────────────────────────────
    if (e.type == Fx::Countdown) {
        int32_t remaining = (int32_t)e.cdTotalMs - (int32_t)elapsed;
        int16_t sec = remaining > 0 ? (int16_t)((remaining + 999) / 1000) : 0;
        if (sec != e.cdLastSec) {
            e.cdLastSec = sec;
            _changed = true;
            if (_cdCallback) _cdCallback(sec);
        }
        RGB c;
        if (remaining > (int32_t)e.cdWarnMs) {
            c = e.c1;
        } else if (remaining > 0) {
            c = e.cdWarn;
        } else {
            uint32_t since = (uint32_t)(-remaining);
            if (since >= e.cdGoMs) {
                if (e.cdHasThen) {           // settle into THEN color (base layer)
                    paint(e.mask, e.cdThen, _base);
                    paint(e.mask, e.cdThen, _out);
                }
                if (_cdCallback) _cdCallback(-1);
                return false;
            }
            c = ((since / CD_GO_FLASH_PERIOD_MS) & 1) ? color::BLACK : e.cdGo;
        }
        paint(e.mask, c, _out);
        return true;
    }

    if (e.durationMs && elapsed >= e.durationMs) return false;

    const uint16_t n = _layout->pixelsIn(e.mask);
    if (!n) return false;
    const uint16_t period = e.periodMs;
    const uint32_t ph     = elapsed % period;

    // Effects whose color is the same for every pixel this frame
    switch (e.type) {
        case Fx::Blink:
            paint(e.mask, ph < period / 2 ? e.c1 : e.c2, _out);
            return true;
        case Fx::Breathe:
            paint(e.mask, color::blend(e.c2, e.c1, color::breath8((uint8_t)(ph * 256 / period))), _out);
            return true;
        default:
            break;
    }

    // Per-pixel effects; p = position along the target (sections in list order)
    const uint8_t  hueShift = (uint8_t)(ph * 256 / period);
    const uint16_t head     = (uint16_t)(ph * n / period);
    const uint16_t tail     = max<uint16_t>(2, n / 5);
    const uint16_t lit      = (uint16_t)(((uint32_t)e.value * n + 500) / 1000);
    const uint32_t slot     = elapsed / period;
    const uint8_t  nsec     = _layout->numSections();

    uint16_t p = 0;
    for (uint8_t s = 0; s < nsec; s++) {
        if (!(e.mask & (1u << s))) continue;
        RGB* px = _out + _layout->start(s);
        const uint16_t cnt = _layout->count(s);
        for (uint16_t i = 0; i < cnt; i++, p++) {
            switch (e.type) {
                case Fx::Rainbow:
                    px[i] = color::wheel((uint8_t)(p * 256 / n) + hueShift);
                    break;
                case Fx::Chase: {
                    uint16_t d = (head + n - p) % n;
                    px[i] = d < tail ? color::blend(e.c2, e.c1, 255 - d * 255 / tail) : e.c2;
                    break;
                }
                case Fx::Progress:
                    px[i] = p < lit ? e.c1 : e.c2;
                    break;
                case Fx::Sparkle:
                    px[i] = (color::hash32(p * 7919u + slot * 104729u) & 7) == 0 ? e.c1 : e.c2;
                    break;
                case Fx::Identify:
                    // Full-strength hue: after brightness + gamma a dimmed one
                    // all but disappears next to the white marker.
                    px[i] = i == 0 ? color::WHITE : color::wheel(s * 256 / nsec);
                    break;
                default:
                    break;
            }
        }
    }
    return true;
}

void LedEngine::toJson(JsonObject out, uint32_t now) const {
    JsonArray arr = out["effects"].to<JsonArray>();
    JsonObject cd;
    for (uint8_t i = 0; i < _count; i++) {
        const Effect& e = _fx[i];
        uint32_t elapsed = now - e.startMs;
        if (e.type == Fx::Countdown) {
            int32_t remaining = (int32_t)e.cdTotalMs - (int32_t)elapsed;
            cd = out["countdown"].to<JsonObject>();
            cd["remainingMs"] = remaining > 0 ? remaining : 0;
            cd["secondsLeft"] = e.cdLastSec < 0 ? 0 : e.cdLastSec;
            cd["phase"] = remaining > (int32_t)e.cdWarnMs ? "high" : remaining > 0 ? "warn" : "go";
            cd["mask"]  = e.mask;
        }
        JsonObject o = arr.add<JsonObject>();
        o["fx"]      = fxName(e.type);
        o["mask"]    = e.mask;
        o["overlay"] = e.overlay;
        if (e.durationMs) o["leftMs"] = elapsed < e.durationMs ? e.durationMs - elapsed : 0;
    }
    if (cd.isNull()) out["countdown"] = nullptr;
}

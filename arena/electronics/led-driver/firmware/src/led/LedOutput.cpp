// =============================================================================
// LedOutput.cpp — WS2811 output via RMT (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "LedOutput.h"

// Wire byte k carries logical channel ORDERS[o].map[k] (0=R, 1=G, 2=B).
struct ColorOrder { const char* name; uint8_t map[3]; };
static const ColorOrder ORDERS[] = {
    {"RGB", {0, 1, 2}}, {"RBG", {0, 2, 1}}, {"GRB", {1, 0, 2}},
    {"GBR", {1, 2, 0}}, {"BRG", {2, 0, 1}}, {"BGR", {2, 1, 0}},
};

bool LedOutput::setColorOrder(const char* order) {
    for (uint8_t i = 0; i < sizeof(ORDERS) / sizeof(ORDERS[0]); i++) {
        if (order && strcasecmp(order, ORDERS[i].name) == 0) { _order = i; return true; }
    }
    return false;
}

const char* LedOutput::colorOrder() const { return ORDERS[_order].name; }

void LedOutput::buildGammaLut() {
    for (int i = 0; i < 256; i++) {
        _gammaLut[i] = (uint8_t)(powf(i / 255.0f, 2.2f) * 255.0f + 0.5f);
    }
    _lutReady = true;
}

void LedOutput::configure(const ArenaLayout& layout) {
    if (!_lutReady) buildGammaLut();

    // Blank and release the old buses (waits for any frame in flight).
    if (_busA) { _busA->ClearTo(RgbColor(0)); _busA->Show(); delete _busA; _busA = nullptr; }
    if (_busB) { _busB->ClearTo(RgbColor(0)); _busB->Show(); delete _busB; _busB = nullptr; }

    uint16_t a = layout.outputCount(0);
    uint16_t b = layout.outputCount(1);
    if (a) {
        _busA = new BusA(a + LED_TAIL_BLANK_PIXELS, PIN_LED_DATA_A);
        _busA->Begin();
        _busA->ClearTo(RgbColor(0));
        _busA->Show();
    }
    if (b) {
        _busB = new BusB(b + LED_TAIL_BLANK_PIXELS, PIN_LED_DATA_B);
        _busB->Begin();
        _busB->ClearTo(RgbColor(0));
        _busB->Show();
    }
    Serial.printf("[LED] Output A: %u px on GPIO%u%s | Output B: %u px on GPIO%u%s\n",
                  a, PIN_LED_DATA_A, a ? "" : " (off)", b, PIN_LED_DATA_B, b ? "" : " (off)");
}

inline RGB LedOutput::process(const RGB& c) const {
    RGB o = color::scale(c, _brightness);
    if (_gamma) o = RGB(_gammaLut[o.r], _gammaLut[o.g], _gammaLut[o.b]);
    return o;
}

void LedOutput::show(const RGB* logical, const ArenaLayout& layout) {
    // Pass 1: estimate power after brightness/gamma.
    uint32_t sum = 0;
    const uint16_t total = layout.total();
    for (uint16_t i = 0; i < total; i++) {
        RGB o = process(logical[i]);
        sum += o.r + o.g + o.b;
    }
    float watts = (float)sum / 765.0f * _wattsPerPixel;
    uint8_t limit = 255;
    _limited = false;
    if (_maxWatts > 0 && watts > _maxWatts) {
        limit    = (uint8_t)(255.0f * _maxWatts / watts);
        watts    = _maxWatts;
        _limited = true;
    }
    _watts = watts;

    // Pass 2: write every section at its physical position.
    const uint8_t* m = ORDERS[_order].map;
    for (uint8_t s = 0; s < layout.numSections(); s++) {
        const SectionCfg& sec = layout.section(s);
        const RGB* src = logical + layout.start(s);
        const uint16_t base = layout.outputPos(s);
        for (uint16_t i = 0; i < sec.count; i++) {
            RGB o = process(src[i]);
            if (limit != 255) o = color::scale(o, limit);
            const uint8_t ch[3] = {o.r, o.g, o.b};
            RgbColor wire(ch[m[0]], ch[m[1]], ch[m[2]]);
            uint16_t pos = base + (sec.reversed ? sec.count - 1 - i : i);
            if (sec.output == 0) { if (_busA) _busA->SetPixelColor(pos, wire); }
            else                 { if (_busB) _busB->SetPixelColor(pos, wire); }
        }
    }
    if (_busA) _busA->Show();
    if (_busB) _busB->Show();
}

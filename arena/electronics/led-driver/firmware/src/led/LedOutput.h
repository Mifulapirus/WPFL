#pragma once
// =============================================================================
// LedOutput.h — Push a logical frame out to the WS2811 data lines
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// PIPELINE per pixel (logical → wire):
//   brightness scale → gamma (optional) → power limit → color-order swap
//   → written at its physical position on output A or B (reversal applied).
//
// HARDWARE: ESP32-C3 RMT peripheral via NeoPixelBus.
//   Output A = RMT channel 0 on PIN_LED_DATA_A (Rotato J5)
//   Output B = RMT channel 1 on PIN_LED_DATA_B (Rotato J6), created only if
//   some section is assigned to it.
//   Each bus gets LED_TAIL_BLANK_PIXELS extra pixels that are always black.
//
// POWER LIMIT: estimated watts = Σ(r+g+b)/765 × wattsPerPixel. If that exceeds
//   maxWatts the whole frame is scaled down. It is an estimate (the strip's
//   rating is for all channels at 255), not a measurement.
//
// RAM: NeoPixelBus double-buffers: 2 × 3 B × (pixels + tail) per output.
// =============================================================================

#include <Arduino.h>
#include <NeoPixelBus.h>
#include "config.h"
#include "Color.h"
#include "ArenaLayout.h"

class LedOutput {
public:
    // (Re)create the buses for the layout's per-output pixel counts.
    // Old buses are blanked first so shortened chains don't keep stale colors.
    void configure(const ArenaLayout& layout);

    void setBrightness(uint8_t b)                { _brightness = b; }
    void setGamma(bool on)                       { _gamma = on; }
    void setPowerLimit(float maxWatts, float wattsPerPixel) {
        _maxWatts = maxWatts; _wattsPerPixel = wattsPerPixel;
    }
    // "RGB","RBG","GRB","GBR","BRG","BGR" (case-insensitive). False if invalid.
    bool setColorOrder(const char* order);
    const char* colorOrder() const;

    // Write a logical frame (layout.total() pixels) and start transmission.
    void show(const RGB* logical, const ArenaLayout& layout);

    float   watts() const     { return _watts; }       // after limiting
    bool    limited() const   { return _limited; }
    uint8_t brightness() const { return _brightness; }

private:
    using BusA = NeoPixelBus<NeoRgbFeature, NeoEsp32Rmt0Ws2811Method>;
    using BusB = NeoPixelBus<NeoRgbFeature, NeoEsp32Rmt1Ws2811Method>;

    BusA*   _busA = nullptr;
    BusB*   _busB = nullptr;
    uint8_t _brightness    = LED_DEFAULT_BRIGHTNESS;
    bool    _gamma         = LED_DEFAULT_GAMMA;
    float   _maxWatts      = LED_DEFAULT_MAX_WATTS;
    float   _wattsPerPixel = LED_DEFAULT_WATTS_PER_PX;
    uint8_t _order         = 2;   // index into ORDERS (GRB)
    float   _watts         = 0;
    bool    _limited       = false;
    uint8_t _gammaLut[256];
    bool    _lutReady      = false;

    void buildGammaLut();
    inline RGB process(const RGB& c) const;
};

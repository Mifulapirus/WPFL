#pragma once
// =============================================================================
// LedOutput.h — Push a logical frame out to the WS2811 data line
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// PIPELINE per pixel (logical → wire):
//   brightness scale → gamma (optional) → power limit → color-order swap
//   → written at its chain position (sections in list order, reversal applied).
//
// HARDWARE: ESP32-C3 SPI2 (GP-SPI) + GDMA, MOSI routed to PIN_LED_DATA
//   (Rotato J5) through the GPIO matrix; no clock or CS pin.
//   Each WS2811 bit is sent as 4 SPI bits at LED_SPI_HZ (see config.h). The
//   frame starts with LED_RESET_US of low (latch) and ends with
//   LED_TAIL_BLANK_PIXELS black pixels.
//
//   Why not RMT: on the C3 an RMT channel buffers only 48 bits (2 pixels) and
//   the driver refills it from a non-IRAM interrupt. WiFi or a flash write
//   delays that interrupt, the RMT wraps around and resends stale bits →
//   random bright flashes and garbage past the end of the chain. With DMA the
//   whole frame is linked up front and nothing on the CPU can disturb it.
//
// POWER LIMIT: estimated watts = Σ(r+g+b)/765 × wattsPerPixel. If that exceeds
//   maxWatts the whole frame is scaled down. It is an estimate (the strip's
//   rating is for all channels at 255), not a measurement.
//
// RAM: one static DMA buffer, 12 B per pixel (LED_MAX_PIXELS + tail) + reset.
// =============================================================================

#include <Arduino.h>
#include <driver/spi_master.h>
#include "config.h"
#include "Color.h"
#include "ArenaLayout.h"

class LedOutput {
public:
    // Set up the SPI bus on first call, then blank the old chain length so a
    // shortened chain doesn't keep stale colors past its new end.
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
    // Returns immediately; the next call waits for the previous frame first.
    void show(const RGB* logical, const ArenaLayout& layout);

    float   watts() const     { return _watts; }       // after limiting
    bool    limited() const   { return _limited; }
    uint8_t brightness() const { return _brightness; }

private:
    spi_device_handle_t _spi = nullptr;
    bool     _inFlight      = false;
    uint16_t _pixels        = 0;      // chain length currently configured
    uint8_t  _brightness    = LED_DEFAULT_BRIGHTNESS;
    bool     _gamma         = LED_DEFAULT_GAMMA;
    float    _maxWatts      = LED_DEFAULT_MAX_WATTS;
    float    _wattsPerPixel = LED_DEFAULT_WATTS_PER_PX;
    uint8_t  _order         = 0;      // index into ORDERS (RGB)
    float    _watts         = 0;
    bool     _limited       = false;
    uint8_t  _gammaLut[256];
    bool     _lutReady      = false;

    bool begin();
    void buildGammaLut();
    inline RGB process(const RGB& c) const;
    void encodePixel(uint16_t pos, const uint8_t wire[3]);
    void blank(uint16_t from, uint16_t to);
    void waitIdle();
    void transmit(uint16_t pixels);
};

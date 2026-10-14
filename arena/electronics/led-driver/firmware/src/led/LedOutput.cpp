// =============================================================================
// LedOutput.cpp — WS2811 output via SPI + DMA (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "LedOutput.h"
#include <soc/spi_struct.h>

// Wire byte k carries logical channel ORDERS[o].map[k] (0=R, 1=G, 2=B).
struct ColorOrder { const char* name; uint8_t map[3]; };
static const ColorOrder ORDERS[] = {
    {"RGB", {0, 1, 2}}, {"RBG", {0, 2, 1}}, {"GRB", {1, 0, 2}},
    {"GBR", {1, 2, 0}}, {"BRG", {2, 0, 1}}, {"BGR", {2, 1, 0}},
};

// ── SPI encoding ─────────────────────────────────────────────────────────────
// 4 SPI bits per WS2811 bit → one SPI byte carries two WS2811 bits.
//   0 → 1000, 1 → 1110   (MSB first)
static const uint8_t BIT_PAIR[4] = {0x88, 0x8E, 0xE8, 0xEE};
static const uint8_t SPI_PER_PIXEL = 12;   // 3 color bytes × 4 SPI bytes
static const uint16_t RESET_BYTES = (uint32_t)LED_RESET_US * (LED_SPI_HZ / 8) / 1000000UL;
static const size_t   BUF_BYTES   = RESET_BYTES + (size_t)SPI_PER_PIXEL * (LED_MAX_PIXELS + LED_TAIL_BLANK_PIXELS);

// Static (not heap) and DMA-capable: internal RAM, word aligned. The reset
// prefix stays zero forever; pixel data starts right after it.
static DMA_ATTR uint8_t s_buf[(BUF_BYTES + 3) & ~3u];
static uint8_t* const   s_px = s_buf + RESET_BYTES;

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

bool LedOutput::begin() {
    spi_bus_config_t bus = {};
    bus.mosi_io_num     = PIN_LED_DATA;
    bus.miso_io_num     = -1;
    bus.sclk_io_num     = -1;
    bus.quadwp_io_num   = -1;
    bus.quadhd_io_num   = -1;
    bus.max_transfer_sz = sizeof(s_buf);
    esp_err_t err = spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) {
        Serial.printf("[LED] SPI bus init failed: %s\n", esp_err_to_name(err));
        return false;
    }
    spi_device_interface_config_t dev = {};
    dev.clock_speed_hz = LED_SPI_HZ;
    dev.mode           = 0;
    dev.spics_io_num   = -1;
    dev.queue_size     = 1;
    err = spi_bus_add_device(SPI2_HOST, &dev, &_spi);
    if (err != ESP_OK) {
        Serial.printf("[LED] SPI device add failed: %s\n", esp_err_to_name(err));
        _spi = nullptr;
        return false;
    }
    // MOSI idles HIGH out of reset (ctrl.d_pol = 1) and the IDF driver never
    // changes it. WS2811 needs the line low between frames to latch (and a high
    // idle would merge into the next frame's first bit). Applied at the next
    // transaction's config sync.
#if CONFIG_IDF_TARGET_ESP32C3
    GPSPI2.ctrl.d_pol = 0;
#endif   // classic ESP32 has no such bit; MOSI idles low in mode 0
    return true;
}

void LedOutput::configure(const ArenaLayout& layout) {
    if (!_lutReady) buildGammaLut();
    if (!_spi && !begin()) return;
    waitIdle();

    // Blank everything the old or the new chain covers, plus the tail.
    const uint16_t n = max(_pixels, layout.total());
    blank(0, n + LED_TAIL_BLANK_PIXELS);
    transmit(n + LED_TAIL_BLANK_PIXELS);
    _pixels = layout.total();
    Serial.printf("[LED] Output: %u px on GPIO%u (SPI DMA, %u Hz)\n", _pixels, PIN_LED_DATA, LED_SPI_HZ);
}

inline RGB LedOutput::process(const RGB& c) const {
    RGB o = color::scale(c, _brightness);
    if (_gamma) o = RGB(_gammaLut[o.r], _gammaLut[o.g], _gammaLut[o.b]);
    return o;
}

void LedOutput::encodePixel(uint16_t pos, const uint8_t wire[3]) {
    uint8_t* d = s_px + (size_t)pos * SPI_PER_PIXEL;
    for (uint8_t k = 0; k < 3; k++) {
        const uint8_t v = wire[k];
        *d++ = BIT_PAIR[v >> 6];
        *d++ = BIT_PAIR[(v >> 4) & 3];
        *d++ = BIT_PAIR[(v >> 2) & 3];
        *d++ = BIT_PAIR[v & 3];
    }
}

void LedOutput::blank(uint16_t from, uint16_t to) {
    memset(s_px + (size_t)from * SPI_PER_PIXEL, BIT_PAIR[0], (size_t)(to - from) * SPI_PER_PIXEL);
}

void LedOutput::waitIdle() {
    if (!_inFlight) return;     // a 72 px frame takes ~3 ms; usually long done
    spi_transaction_t* done;
    spi_device_get_trans_result(_spi, &done, portMAX_DELAY);
    _inFlight = false;
}

void LedOutput::transmit(uint16_t pixels) {
    // The buffer belongs to the DMA until waitIdle() returns.
    static spi_transaction_t t;
    t = {};
    t.length    = (RESET_BYTES + (size_t)pixels * SPI_PER_PIXEL) * 8;   // bits
    t.tx_buffer = s_buf;
    if (spi_device_queue_trans(_spi, &t, portMAX_DELAY) == ESP_OK) _inFlight = true;
}

void LedOutput::show(const RGB* logical, const ArenaLayout& layout) {
    if (!_spi) return;
    waitIdle();

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

    // Pass 2: encode every section at its chain position.
    const uint8_t* m = ORDERS[_order].map;
    for (uint8_t s = 0; s < layout.numSections(); s++) {
        const SectionCfg& sec = layout.section(s);
        const uint16_t base = layout.start(s);
        const RGB* src = logical + base;
        for (uint16_t i = 0; i < sec.count; i++) {
            RGB o = process(src[i]);
            if (limit != 255) o = color::scale(o, limit);
            const uint8_t ch[3]   = {o.r, o.g, o.b};
            const uint8_t wire[3] = {ch[m[0]], ch[m[1]], ch[m[2]]};
            encodePixel(base + (sec.reversed ? sec.count - 1 - i : i), wire);
        }
    }
    blank(total, total + LED_TAIL_BLANK_PIXELS);
    transmit(total + LED_TAIL_BLANK_PIXELS);
}

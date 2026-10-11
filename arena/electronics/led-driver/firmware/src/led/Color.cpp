// =============================================================================
// Color.cpp — Tiny RGB helpers (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include "Color.h"

namespace color {

struct NamedColor { const char* name; RGB c; };

// Tuned for RGB LEDs (pure 255,255,0 looks greenish on most strips).
static const NamedColor NAMED[] = {
    {"off",    {0, 0, 0}},
    {"black",  {0, 0, 0}},
    {"white",  {255, 255, 255}},
    {"warm",   {255, 160, 60}},
    {"red",    {255, 0, 0}},
    {"orange", {255, 106, 0}},
    {"yellow", {255, 200, 0}},
    {"green",  {0, 255, 0}},
    {"cyan",   {0, 255, 255}},
    {"blue",   {0, 0, 255}},
    {"purple", {160, 0, 255}},
    {"pink",   {255, 40, 120}},
};

static int hexNibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

bool parse(const char* s, RGB& out) {
    if (!s || !*s) return false;
    for (const auto& n : NAMED) {
        if (strcasecmp(s, n.name) == 0) { out = n.c; return true; }
    }
    if (*s == '#') s++;
    size_t len = strlen(s);
    if (len == 6) {
        int v[6];
        for (int i = 0; i < 6; i++) { v[i] = hexNibble(s[i]); if (v[i] < 0) return false; }
        out = RGB(v[0] << 4 | v[1], v[2] << 4 | v[3], v[4] << 4 | v[5]);
        return true;
    }
    if (len == 3) {
        int v[3];
        for (int i = 0; i < 3; i++) { v[i] = hexNibble(s[i]); if (v[i] < 0) return false; }
        out = RGB(v[0] * 17, v[1] * 17, v[2] * 17);
        return true;
    }
    return false;
}

void toHex(const RGB& c, char out[8]) {
    snprintf(out, 8, "#%02x%02x%02x", c.r, c.g, c.b);
}

RGB scale(const RGB& c, uint8_t s) {
    return RGB((uint16_t)c.r * s / 255, (uint16_t)c.g * s / 255, (uint16_t)c.b * s / 255);
}

RGB blend(const RGB& a, const RGB& b, uint8_t t) {
    uint16_t it = 255 - t;
    return RGB((a.r * it + b.r * t) / 255, (a.g * it + b.g * t) / 255, (a.b * it + b.b * t) / 255);
}

RGB wheel(uint8_t hue) {
    uint8_t region = hue / 43;
    uint8_t rem    = (hue - region * 43) * 6;
    uint8_t q = 255 - rem, t = rem;
    switch (region) {
        case 0:  return RGB(255, t, 0);
        case 1:  return RGB(q, 255, 0);
        case 2:  return RGB(0, 255, t);
        case 3:  return RGB(0, q, 255);
        case 4:  return RGB(t, 0, 255);
        default: return RGB(255, 0, q);
    }
}

uint8_t breath8(uint8_t x) {
    uint16_t tri = x < 128 ? x * 2 : (255 - x) * 2;  // 0…254
    return (uint8_t)((tri * tri) / 254);             // ease-in/out
}

uint32_t hash32(uint32_t x) {
    x ^= x >> 16; x *= 0x7feb352d;
    x ^= x >> 15; x *= 0x846ca68b;
    x ^= x >> 16;
    return x;
}

}  // namespace color

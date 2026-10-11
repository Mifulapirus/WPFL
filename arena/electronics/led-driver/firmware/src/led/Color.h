#pragma once
// =============================================================================
// Color.h — Tiny RGB helpers (no heap, integer math — the C3 has no FPU)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.

#include <Arduino.h>

struct RGB {
    uint8_t r = 0, g = 0, b = 0;
    constexpr RGB() = default;
    constexpr RGB(uint8_t r_, uint8_t g_, uint8_t b_) : r(r_), g(g_), b(b_) {}
    bool operator==(const RGB& o) const { return r == o.r && g == o.g && b == o.b; }
    bool operator!=(const RGB& o) const { return !(*this == o); }
};
// Frames are memcpy'd as packed r,g,b triplets (preview stream, binary input).
static_assert(sizeof(RGB) == 3, "RGB must be exactly 3 bytes");

namespace color {

constexpr RGB BLACK{0, 0, 0};
constexpr RGB WHITE{255, 255, 255};

// Parse "#rrggbb", "rrggbb", "#rgb" or a name (red, orange, yellow, green,
// blue, cyan, purple, pink, white, warm, off/black). Returns false if invalid.
bool parse(const char* s, RGB& out);

// "#rrggbb" into out (needs 8 bytes incl. NUL).
void toHex(const RGB& c, char out[8]);

// c × s / 255
RGB scale(const RGB& c, uint8_t s);

// Linear mix: t = 0 → a, t = 255 → b
RGB blend(const RGB& a, const RGB& b, uint8_t t);

// Fully saturated hue wheel, 0–255.
RGB wheel(uint8_t hue);

// Smooth 0 → 255 → 0 over x = 0…255 (eased triangle, used for "breathe").
uint8_t breath8(uint8_t x);

// Cheap deterministic hash (sparkle effect).
uint32_t hash32(uint32_t x);

}  // namespace color

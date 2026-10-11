#pragma once
// Minimal Arduino shim so the pure-logic LED modules (Color, ArenaLayout,
// LedEngine) compile and run on a PC. Not used by the firmware build.
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <strings.h>
#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <math.h>
#include <algorithm>
#include <functional>
#include <string>

using std::min;
using std::max;

inline uint32_t& fakeMillis() { static uint32_t t = 0; return t; }
inline uint32_t millis() { return fakeMillis(); }

#ifndef constrain
#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))
#endif

inline size_t strlcpy(char* dst, const char* src, size_t size) {
    size_t len = strlen(src);
    if (size) {
        size_t n = len >= size ? size - 1 : len;
        memcpy(dst, src, n);
        dst[n] = '\0';
    }
    return len;
}

struct SerialShim {
    template <typename... A> void printf(const char* f, A... a) { ::printf(f, a...); }
    void println(const char* s = "") { ::puts(s); }
};
static SerialShim Serial __attribute__((unused));

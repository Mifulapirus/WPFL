#pragma once
// =============================================================================
// Button.h — Debounced active-LOW push button (internal pull-up)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
// Events from update():
//   PRESSED — debounced press (fires on the way down: lowest latency)
//   SHORT   — released before BTN_LONG_PRESS_MS
//   LONG    — still held at BTN_LONG_PRESS_MS (fires once per press)
// =============================================================================

#include <Arduino.h>
#include "config.h"

class Button {
public:
    enum Event : uint8_t { NONE, PRESSED, SHORT, LONG };

    void begin(uint8_t pin) {
        _pin = pin;
        pinMode(_pin, INPUT_PULLUP);
        _stable = _raw = digitalRead(_pin) == LOW;
    }

    Event update(uint32_t now) {
        bool down = digitalRead(_pin) == LOW;
        if (down != _raw) { _raw = down; _changed_ms = now; }
        if (now - _changed_ms >= BTN_DEBOUNCE_MS && _raw != _stable) {
            _stable = _raw;
            if (_stable) { _pressed_ms = now; _longFired = false; return PRESSED; }
            if (!_longFired) return SHORT;
            return NONE;
        }
        if (_stable && !_longFired && now - _pressed_ms >= BTN_LONG_PRESS_MS) {
            _longFired = true;
            return LONG;
        }
        return NONE;
    }

private:
    uint8_t  _pin        = 0;
    bool     _raw        = false;
    bool     _stable     = false;
    bool     _longFired  = false;
    uint32_t _changed_ms = 0;
    uint32_t _pressed_ms = 0;
};

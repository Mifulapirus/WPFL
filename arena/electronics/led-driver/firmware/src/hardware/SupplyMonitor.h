#pragma once
// =============================================================================
// SupplyMonitor.h — Board supply voltage (Rotato battery-sense divider)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
//
// Ported from Rotato's BatteryMonitor, reduced to "what voltage is on the
// battery input". Useful when the board is fed from a 24 V → 12 V buck into
// its battery terminal: a sagging reading points at a PSU/wiring problem.
//
// CIRCUIT: V_in ── R1 (39K) ── GPIO0 ── R2 (10K) ── GND   → V_in = V_adc × 4.9
//   !! Max safe V_in ≈ 15 V. 24 V here puts 4.9 V on GPIO0 and damages it.
//
// Reads ~0 V when the board is powered over USB-C only — reported as null.
// =============================================================================

#include <Arduino.h>
#include "config.h"

class SupplyMonitor {
public:
    void  begin();
    void  update();                     // call every SUPPLY_READ_MS
    float voltage() const { return _voltage; }
    bool  present() const { return _voltage > 1.0f; }

private:
    float   _samples[SUPPLY_NUM_SAMPLES] = {};
    uint8_t _index   = 0;
    float   _voltage = 0.0f;
    float   read() const;
};

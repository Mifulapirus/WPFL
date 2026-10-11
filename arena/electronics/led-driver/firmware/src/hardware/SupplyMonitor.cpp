// =============================================================================
// SupplyMonitor.cpp — Board supply voltage (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.

#include "SupplyMonitor.h"

float SupplyMonitor::read() const {
#ifdef HAS_SUPPLY_MONITOR
    int raw = analogRead(PIN_SUPPLY_ADC);
    return ((float)raw / (float)SUPPLY_ADC_BITS) * SUPPLY_ADC_VREF * SUPPLY_R_RATIO;
#else
    return 0.0f;
#endif
}

void SupplyMonitor::begin() {
#ifdef HAS_SUPPLY_MONITOR
    analogSetPinAttenuation(PIN_SUPPLY_ADC, ADC_11db);
    pinMode(PIN_SUPPLY_ADC, INPUT);
#endif
    float sum = 0;
    for (uint8_t i = 0; i < SUPPLY_NUM_SAMPLES; i++) { _samples[i] = read(); sum += _samples[i]; }
    _voltage = sum / SUPPLY_NUM_SAMPLES;
    Serial.printf("[Supply] %.2f V on battery input%s\n", _voltage,
                  present() ? "" : " (not connected — USB powered?)");
}

void SupplyMonitor::update() {
    _samples[_index] = read();
    _index = (_index + 1) % SUPPLY_NUM_SAMPLES;
    float sum = 0;
    for (uint8_t i = 0; i < SUPPLY_NUM_SAMPLES; i++) sum += _samples[i];
    _voltage = sum / SUPPLY_NUM_SAMPLES;
}

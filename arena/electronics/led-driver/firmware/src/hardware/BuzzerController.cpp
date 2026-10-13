// =============================================================================
// BuzzerController.cpp — Non-Blocking Buzzer Sound Sequences (Implementation)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.

#include "BuzzerController.h"

#ifdef HAS_BUZZER

// "Charge!" bugle call: G4 C5 E5 G5 … E5 G5 (held)
static const BeepStep SEQ_STARTUP[] = {
    {392, 90}, {0, 30}, {523, 90}, {0, 30}, {659, 90}, {0, 30}, {784, 180},
    {0, 60}, {659, 90}, {0, 30}, {784, 400}
};
static const BeepStep SEQ_TICK[]    = { {880, 120} };
static const BeepStep SEQ_GO[]      = { {1568, 600} };
static const BeepStep SEQ_CONFIRM[] = { {1568, 60}, {0, 40}, {1568, 60} };
static const BeepStep SEQ_ERROR[]   = { {220, 200}, {0, 100}, {220, 400} };

#define SEQ(s) playSequence(s, sizeof(s) / sizeof(BeepStep))

void BuzzerController::begin() {
    ledcSetup(LEDC_CH_BUZZER, 1000, 8);
    ledcAttachPin(PIN_BUZZER, LEDC_CH_BUZZER);
    toneOff();
    Serial.println("[Buzzer] Initialized.");
}

void BuzzerController::beepStartup() { SEQ(SEQ_STARTUP); }
void BuzzerController::beepTick()    { SEQ(SEQ_TICK); }
void BuzzerController::beepGo()      { SEQ(SEQ_GO); }
void BuzzerController::beepConfirm() { SEQ(SEQ_CONFIRM); }
void BuzzerController::beepError()   { SEQ(SEQ_ERROR); }

void BuzzerController::update() {
    if (_stepIndex >= _sequenceLength) return;
    uint32_t now = millis();
    if (now - _stepStart_ms < _sequence[_stepIndex].duration_ms) return;

    _stepIndex++;
    _stepStart_ms = now;
    if (_stepIndex < _sequenceLength && _sequence[_stepIndex].freq_hz > 0) {
        toneOn(_sequence[_stepIndex].freq_hz);
    } else {
        toneOff();
    }
}

void BuzzerController::playSequence(const BeepStep* steps, uint8_t length) {
    if (!_enabled) return;
    _sequence       = steps;
    _sequenceLength = length;
    _stepIndex      = 0;
    _stepStart_ms   = millis();
    if (steps[0].freq_hz > 0) toneOn(steps[0].freq_hz); else toneOff();
}

void BuzzerController::toneOn(uint16_t freq_hz) { ledcWriteTone(LEDC_CH_BUZZER, freq_hz); }
void BuzzerController::toneOff()                { ledcWriteTone(LEDC_CH_BUZZER, 0); }

#endif  // HAS_BUZZER

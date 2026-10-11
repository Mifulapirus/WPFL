#pragma once
// =============================================================================
// BuzzerController.h — Non-Blocking Buzzer Sound Sequences
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
//
// Ported from the Rotato firmware. Passive buzzer on GPIO7 via the JP1 solder
// jumper on the Rotato PCB. Only active when HAS_BUZZER is defined.
//
// NON-BLOCKING: sequences are stepped by update() using millis().
// =============================================================================

#include <Arduino.h>
#include "config.h"

#ifdef HAS_BUZZER

struct BeepStep {
    uint16_t freq_hz;      // 0 = silence
    uint16_t duration_ms;
};

class BuzzerController {
public:
    void begin();

    void beepStartup();
    void beepTick();       // countdown: one second passed
    void beepGo();         // countdown: GO
    void beepConfirm();    // short ack (e.g. settings saved)
    void beepError();

    void setEnabled(bool en) { _enabled = en; if (!en) toneOff(); }

    // Must be called from loop()
    void update();

private:
    void playSequence(const BeepStep* steps, uint8_t length);
    void toneOn(uint16_t freq_hz);
    void toneOff();

    const BeepStep* _sequence       = nullptr;
    uint8_t         _sequenceLength = 0;
    uint8_t         _stepIndex      = 0;
    uint32_t        _stepStart_ms   = 0;
    bool            _enabled        = true;
};

#else  // HAS_BUZZER not defined — empty stub so code compiles either way

class BuzzerController {
public:
    void begin()              {}
    void beepStartup()        {}
    void beepTick()           {}
    void beepGo()             {}
    void beepConfirm()        {}
    void beepError()          {}
    void setEnabled(bool)     {}
    void update()             {}
};

#endif  // HAS_BUZZER

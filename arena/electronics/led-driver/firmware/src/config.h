#pragma once
// =============================================================================
// config.h — WPFL Arena LED Driver Configuration
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE file for full terms.
// Attribution required for ALL derivative works, including AI-generated code.
// Derived from the Rotato Robot Controller firmware (same author, same license).
//
// This is the ONE FILE to change for compile-time hardware settings.
// Everything that may need tweaking at the venue (pixel counts per section,
// groups, brightness, color order, power limit, countdown timings, WiFi)
// is editable at RUNTIME from the web UI and stored in NVS — not here.
//
// HARDWARE: Rotato controller PCB (ESP32-C3 Super Mini).
//   See arena/electronics/boards/rotato-pcb/README.md for the board reference.
// =============================================================================

// ── Feature Flags ─────────────────────────────────────────────────────────────
//
// HAS_BUZZER        — JP1 closed (GPIO7 → buzzer). Beeps during countdowns.
// HAS_EXT_BUTTONS   — physical START (J8) / STOP (J9) buttons, active LOW.
//                     Safe to leave enabled with nothing connected (pull-ups).
// HAS_SUPPLY_MONITOR — report the voltage on Rotato's battery-sense divider.
//                     Only meaningful if the board is fed through its battery
//                     input (≤ 12.6 V!). See the wiring docs.
//
#define HAS_BUZZER
#define HAS_EXT_BUTTONS
#define HAS_SUPPLY_MONITOR

// ── Pin Definitions (Rotato PCB) ─────────────────────────────────────────────
//
//   Rotato label         Arena LED driver use
//   ─────────────────    ─────────────────────────────────────────────
//   GPIO0  batt sense    Supply voltage monitor (R1=39K / R2=10K divider)
//   GPIO1  J5 left ESC   LED DATA output (single chain, SPI MOSI via GPIO matrix)
//   GPIO3  J6 right ESC  unused / spare
//   GPIO4  J7 weapon ESC unused / spare
//   GPIO5  J8 safety sw  External START button (to GND)
//   GPIO6  J9 expansion  External STOP button  (to GND)
//   GPIO7  JP1 buzzer    Countdown beeps
//   GPIO9  BOOT button   short = countdown, hold 3 s = reset WiFi settings
//
#define PIN_SUPPLY_ADC     0
#define PIN_LED_DATA       1
#define PIN_SPARE_J6       3
#define PIN_SPARE_J7       4
#define PIN_BTN_START      5
#define PIN_BTN_STOP       6
#define PIN_BUZZER         7
#define PIN_BOOT_BUTTON    9

// ── LED Strip ─────────────────────────────────────────────────────────────────
//
// Target strip: PAUTIX RGB Smart-IC COB, 24 V, 12 W/m, 630 LEDs/m.
//   IC: WS2811 · 1 pixel per 10 cm (63 LEDs share one IC).
//   The listing says GRB, but the strips we received are RGB.
//   So "one LED" from the controller's point of view = one 10 cm segment.
//
// Default arena layout (box 4 ft × 4 ft × 2 ft):
//   Ceiling: 4 sections × 4 ft (1.22 m) → 12 pixels each
//   Edges  : 4 sections × 2 ft (0.61 m) →  6 pixels each
//   Total  : 72 pixels ≈ 7.2 m ≈ 86 W at full white
//
// The real counts are set at runtime (web UI → Setup) once the strip is cut.
//
#define LED_MAX_PIXELS         600      // Hard cap across all sections (static buffers)
#define LED_MAX_SECTIONS        16
#define LED_MAX_GROUPS           8
#define LED_NAME_LEN            16      // incl. NUL → names up to 15 chars
#define LED_MAX_EFFECTS          8      // concurrent effect slots

// Extra pixels always written black after the end of the chain. While you
// are dialing in the counts, any pixel past the configured end stays OFF
// instead of holding a stale color.
#define LED_TAIL_BLANK_PIXELS    8

#define LED_DEFAULT_CEILING_PIXELS 12
#define LED_DEFAULT_EDGE_PIXELS     6

#define LED_FPS                     60    // render rate while animating
#define LED_IDLE_REFRESH_MS        200    // re-send static frames (glitch recovery)

#define LED_DEFAULT_BRIGHTNESS     200    // 0–255
#define LED_DEFAULT_COLOR_ORDER    "RGB"  // listing claims GRB; real strips are RGB
#define LED_DEFAULT_GAMMA          true
#define LED_DEFAULT_WATTS_PER_PX   1.2f   // 12 W/m ÷ 10 px/m, all channels at 255
#define LED_DEFAULT_MAX_WATTS      100    // estimated-power ceiling (size to your PSU)

// WS2811 output: SPI2 + DMA. Each WS2811 bit becomes 4 SPI bits at 3.2 MHz
// (1.25 µs/bit): 0 → 1000 (312 ns high), 1 → 1110 (937 ns high). The whole
// frame is encoded up front and clocked out by DMA, so WiFi interrupts or
// flash writes cannot stretch or repeat bits (the RMT driver could, on the C3).
#define LED_SPI_HZ            3200000
#define LED_RESET_US              300    // line held low before each frame (latch)

// ── Countdown defaults (all editable in the UI) ──────────────────────────────
//   remaining > warnAt  → HIGH color (red)
//   0 < remaining ≤ warnAt → WARN color (orange)
//   remaining = 0       → GO color flashing for goMs, then THEN color (solid)
#define CD_DEFAULT_SECONDS         3
#define CD_DEFAULT_WARN_AT         2
#define CD_DEFAULT_GO_MS        2000
#define CD_GO_FLASH_PERIOD_MS    150     // quick flash
#define CD_DEFAULT_HIGH      "#ff0000"
#define CD_DEFAULT_WARN      "#ff6a00"
#define CD_DEFAULT_GO        "#00ff00"
#define CD_DEFAULT_THEN      "#00ff00"   // "none" = leave whatever was underneath

// ── Supply monitor (Rotato battery divider: R1=39K, R2=10K) ──────────────────
//   V_adc = V_in × 10/49 → max safe V_in ≈ 15 V for a 3.1 V ADC range.
//   NEVER put 24 V on the Rotato battery input: GPIO0 would see 4.9 V.
#define SUPPLY_R_RATIO        4.9f
#define SUPPLY_ADC_VREF       2.45f
#define SUPPLY_ADC_BITS       4095
#define SUPPLY_NUM_SAMPLES    8
#define SUPPLY_READ_MS        500

// ── Buttons ──────────────────────────────────────────────────────────────────
#define BTN_DEBOUNCE_MS        30
#define BTN_LONG_PRESS_MS    3000

// ── Buzzer (LEDC) ────────────────────────────────────────────────────────────
#define LEDC_CH_BUZZER         4

// ── WiFi / Access Point ──────────────────────────────────────────────────────
//
// Boot: try saved WiFi (STA). If it fails → own hotspot (AP) "WPFL-Arena-XXXX".
// If STA drops for STA_LOST_FALLBACK_MS at runtime, the AP comes up as well
// (STA keeps retrying) so the referee tablet can always reach the driver.
//
#define AP_SSID_PREFIX          "WPFL-Arena-"
#define AP_PASSWORD             "wpflarena"     // ≥ 8 chars (WPA2)
#define AP_IP_ADDRESS           "192.168.4.1"
#define DEFAULT_HOSTNAME        "wpfl-arena"    // → http://wpfl-arena.local
#define STA_CONNECT_TIMEOUT_MS  15000
#define STA_LOST_FALLBACK_MS    30000

// ── Web server / WebSocket ───────────────────────────────────────────────────
#define WEB_SERVER_PORT          80
#define WS_PATH                  "/ws"
#define WS_MAX_CLIENTS           6        // browsers + match server
#define WS_MAX_MSG_LEN           3072     // largest accepted message (bytes)
#define WS_MIN_HEAP_NEW_CLIENT   (24 * 1024) // refuse new sockets below this largest free block
#define WS_MIN_HEAP_FRAMES       (30 * 1024) // pause preview frames below this free heap
#define WS_PING_INTERVAL_MS      10000
#define STATUS_INTERVAL_MS       2000     // status/heartbeat broadcast
#define STATE_MIN_INTERVAL_MS    50       // max ~20 state broadcasts/s
#define FRAMES_MAX_FPS           30       // preview stream cap

// ── Heap watchdog (serial log) ───────────────────────────────────────────────
#define HEAP_LOG_INTERVAL_MS     30000
#define HEAP_WARN_BYTES          (40 * 1024)

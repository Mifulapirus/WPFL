# Rotato PCB — board reference

The **Rotato** controller board is a small robot-controller PCB built around an **ESP32-C3 Super Mini**, designed
for the Asmbly *Democratic Robot 2026* workshop. WPFL reuses it as a general-purpose arena controller, starting
with the [arena LED driver](../../led-driver/).

- Source project: [github.com/Mifulapirus/Rotato](https://github.com/Mifulapirus/Rotato) (firmware, original `config.h`)
- Project page: [thehomelab.dev/projects/rotato](https://thehomelab.dev/projects/rotato)
- Author: Angel Hernandez — [www.thehomelab.dev](https://www.thehomelab.dev)

> The information below was copied from the Rotato firmware (`src/config.h`, `README.md`, `AI_CONTEXT.md`) — it is
> what the firmware assumes about the board. Rotato's PCB design files (schematic / Gerbers) are **not** in that
> repository; when they are published, add them to this folder. Items marked **⚠ verify** are not documented in
> Rotato and must be checked on the physical board before relying on them.

---

## MCU

| | |
|---|---|
| Module | ESP32-C3 Super Mini (RISC-V, single core, 160 MHz, **no FPU**) |
| RAM | 400 KB SRAM, ~320 KB usable heap region (`ESP.getHeapSize()` ≈ 327 680 B) |
| Flash | 4 MB |
| Radio | 2.4 GHz WiFi 802.11 b/g/n + BLE 5 |
| USB | Native USB-Serial/JTAG on the USB-C port (`ARDUINO_USB_CDC_ON_BOOT=1`), 115200 baud log |
| Peripherals used | SPI2 + GDMA (LED data), LEDC (PWM), ADC1 |

## GPIO / connector map

| GPIO | Rotato connector | Rotato use | WPFL LED-driver use |
|---|---|---|---|
| GPIO0 | — (on-board divider) | Battery voltage sense (ADC) | Supply voltage monitor |
| GPIO1 | **J5** | Left wheel ESC signal | **LED data output A** |
| GPIO3 | **J6** | Right wheel ESC signal | spare |
| GPIO4 | **J7** | Weapon ESC signal | spare |
| GPIO5 | **J8** | Safety kill-switch (short to GND) | **START** button (to GND) |
| GPIO6 | **J9** | Expansion | **STOP** button (to GND) |
| GPIO7 | **JP1** (solder jumper) | Passive buzzer | Countdown beeps |
| GPIO9 | on-module BOOT button | Hold 3 s → reset WiFi | Short = countdown · hold 3 s = forget WiFi |

Strapping pins to avoid for new uses: **GPIO2, GPIO8, GPIO9** (boot mode). GPIO9 is fine as an *input* button.

### Connectors J5–J7 (servo-style headers)

Rotato drives RC ESCs through these: 50 Hz, 1000–2000 µs pulses. For the LED driver only the **signal** and **GND**
pins are used. **⚠ verify:** pin order and what the centre (+V) pin is tied to (battery, 5 V rail, or ESC BEC
input). **Never connect the LED strip's 24 V to any header pin.**

## Power

| | |
|---|---|
| Designed input | 2S (6.0–8.4 V) or 3S (9.0–12.6 V) LiPo on the battery terminal |
| Battery sense | R1 = 39 kΩ (top), R2 = 10 kΩ (bottom) → `V_adc = V_in × 10/49` → `V_in = V_adc × 4.9` |
| ADC | 12-bit, 11 dB attenuation (~0–3.1 V usable), calibrated ratio stored in NVS |
| Logic | 3.3 V (ESP32-C3 module regulator, fed from 5 V) |

> ⚠ **24 V must not go into the battery terminal.** The divider would put 24 / 4.9 = **4.9 V on GPIO0** (absolute
> max ≈ 3.6 V), and the on-board regulator's input rating is not documented (**⚠ verify**). Feed the board either
> with **5 V on USB-C** or with **≤ 12.6 V on the battery terminal** (e.g. a 24 V → 12 V buck). Max safe input for
> the sense divider is ≈ 15 V.

## Buzzer (JP1)

Passive buzzer on GPIO7, connected only when solder jumper **JP1** is closed. Driven by LEDC channel 4 (Timer 2)
with `ledcWriteTone()`. If JP1 is open, GPIO7 is free.

## Firmware conventions inherited from Rotato

- PlatformIO + Arduino (arduino-esp32 2.0.x), C++, ArduinoJson 7, ESPAsyncWebServer 3.x.
- `src/config.h` is the single source of truth for pins and constants.
- Web UI in `ui/index.html`, gzip-embedded into the firmware at build time (`scripts/embed_web_ui.py`) — no
  `uploadfs` step; OTA via `POST /update` updates firmware and UI together.
- Version = `version.h` (MAJOR.MINOR.PATCH) + auto build number (`scripts/auto_version.py`).
- Partition table `min_spiffs.csv` (two 1.9 MB OTA slots).
- No `delay()` in `loop()`; `millis()`-based timing only.
- LEDC on the C3 is limited to 14-bit resolution on IDF 4.4.

## Using the board for something else in the arena

Free resources once it is an LED driver: **J6 (GPIO3)**, **J7 (GPIO4)**, BLE radio, both RMT channels.
Candidates: a second arena (pit) light chain, a buzzer/horn relay, driver-station ready buttons.

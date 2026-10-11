# WPFL — AI Assistant Context

**Project:** Weaponized Plastic Fighting League — arena, electronics, match software
**Author:** Angel Hernandez | [angel@thehomelab.dev](mailto:angel@thehomelab.dev) | [www.thehomelab.dev](https://www.thehomelab.dev)
**Human guide:** [README.md](README.md)

> **LICENSE NOTICE** — Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev). Non-Commercial Source-Available
> License ([LICENSE](LICENSE)). The LED driver firmware is derived from the Rotato controller firmware.
> **Attribution is required without exception**, including for AI-generated derivatives:
> `Author: Angel Hernandez — Website: www.thehomelab.dev`. No commercial use without written permission.

> Source files are authoritative. This file holds architecture and constraints that are not obvious from code.

---

## Repository map

| Path | What |
|---|---|
| `arena/structure/` | Arena mechanical design (to be documented) |
| `arena/electronics/boards/rotato-pcb/` | Board reference for the reused Rotato ESP32-C3 PCB |
| `arena/electronics/led-driver/firmware/` | PlatformIO project — arena LED driver |
| `arena/electronics/led-driver/tools/arena_led_client.py` | Reference WS client / latency tester |
| `arena/electronics/led-driver/docs/wiring.md` | Strip, power, data wiring, BOM |
| `software/match-tracker/` | Planned live site + referee console (runs on Capek) |
| `docs/protocols/arena-led-websocket.md` | **LED driver API contract** |
| `docs/rules.md` | Rules summary (official: wpfl.thehomelab.dev) |

## LED driver — identity

| | |
|---|---|
| MCU | ESP32-C3 Super Mini on the Rotato PCB (single core RISC-V, no FPU, no PSRAM) |
| Framework | Arduino, `platform = espressif32 @ 6.9.0` (arduino-esp32 2.0.17, IDF 4.4) |
| Libraries | ESPAsyncWebServer 3.x (esp32async), ArduinoJson 7, NeoPixelBus 2.8 (RMT) |
| Strip | PAUTIX 24 V COB, **WS2811, 1 IC per 10 cm, GRB**, 1.2 W/pixel |
| Default layout | 8 sections (4 ceiling × 12 px, 4 edges × 6 px) = 72 px, chain-interleaved |
| Build | `pio run` · flash `pio run -t upload` · UI embedded from `ui/index.html` |
| Host tests | `sh test_host/run.sh` (Color, ArenaLayout, LedEngine with an Arduino shim) |

## LED driver — architecture

```
main.cpp ── buttons, loop → wifi.update, web.update, controller.update, buzzer.update
app/ArenaController     protocol, sessions(auth/subscriptions), settings (NVS), ONE FreeRTOS mutex,
                        render scheduling, broadcasts, deferred NVS saves + reboots
led/ArenaLayout         sections/groups (NVS blob), target resolution → SectionMask (uint16)
led/LedEngine           base RGB buffer + ≤8 effect slots (Fx enum), countdown, render()
led/LedOutput           brightness → gamma → power limit → color order → NeoPixelBus (RMT ch0/ch1)
connectivity/WiFiManager      STA + fallback AP(+STA), mDNS, static IP, token, scan (custom class)
connectivity/WebServerManager HTTP + WS transport only: reassembly, client limits, OTA
hardware/                     BuzzerController, SupplyMonitor (ported from Rotato), Button
```

Layering: fill/pixels/normal effects **trim** the touched sections out of all effects; `overlay` effects stack.

## Critical constraints

1. **Never call into `WebServerManager`/`AsyncWebSocket` while holding the controller mutex.** The library fires
   `WS_EVT_CONNECT` with its client-list lock held and our handler takes the mutex → lock-order deadlock.
   Build JSON under the lock, send after unlocking (see `sendFrames`, scan results, `_clientCount` cache).
2. Network callbacks run on the AsyncTCP task. Anything slow (NVS writes, `LedOutput::configure`, reboots,
   WiFi scans) is flagged and done in `loop()`.
3. No `delay()` in `loop()` except the trailing `vTaskDelay(1)` yield.
4. **ArduinoJson 7:** a `const char[N]` is stored as a *literal* (pointer + N-1 length). Cast fixed-size name
   buffers: `obj["name"] = (const char*)cfg.name;`. `const char*` is copied.
5. Arduino defines a `bit()` macro — don't name variables/lambdas `bit`.
6. Everything sized by pixel count is static (`LED_MAX_PIXELS`); keep the heap for WiFi/TCP/WS.
7. All pins and compile-time constants in `src/config.h`; runtime-tunable values go in NVS settings instead.
8. The C3 has 2 RMT TX channels → max 2 LED outputs.
9. 24 V must never reach the Rotato battery terminal (GPIO0 divider → 4.9 V).

## NVS keys

| Namespace | Key | Type | Owner |
|---|---|---|---|
| `leds` | `layout` | blob `LayoutCfg` (magic `0xA7E1`) | ArenaLayout |
| `leds` | `settings` | blob `LedSettings` (magic `0x5E72`) | ArenaController |
| `net` | `ssid` `pass` `static` `ip` `gw` `mask` `dns` | String/Bool | WiFiManager |
| `dev` | `host` `ap_ssid` `ap_pass` `token` | String | WiFiManager |

Changing the shape of `LayoutCfg`/`LedSettings` → bump its magic (old blobs then fall back to defaults).

## Documentation maintenance

| Change | Update |
|---|---|
| WebSocket/HTTP message added or changed | `docs/protocols/arena-led-websocket.md` (+ `PROTOCOL_VERSION` if breaking) |
| NVS key added/renamed | NVS table above |
| New module/folder | Repository map / architecture above + nearest README |
| Pins/constants | `src/config.h` only |
| Operator-visible feature | `arena/electronics/led-driver/README.md` |

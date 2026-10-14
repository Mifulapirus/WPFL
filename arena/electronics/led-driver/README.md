# WPFL Arena LED Driver

Arena lighting for the Weaponized Plastic Fighting League, running on a **Rotato PCB** (ESP32-C3 Super Mini).
It drives the arena's 24 V addressable COB strip, serves a control page from the ESP itself, and exposes a
low-latency **WebSocket API** so the match tracker on Capek can run the lights automatically.

| | |
|---|---|
| Hardware | [Rotato PCB](../boards/rotato-pcb/README.md) + PAUTIX 24 V WS2811 COB strip ([wiring](docs/wiring.md)) |
| Firmware | [`firmware/`](firmware/) — PlatformIO, Arduino (arduino-esp32 2.0.17), C++ |
| API | [WebSocket protocol v1](../../../docs/protocols/arena-led-websocket.md) |
| Test client | [`tools/arena_led_client.py`](tools/arena_led_client.py) |

## Features

- **Per-pixel control** (1 pixel = one 10 cm WS2811 segment), **sections** and **groups**, all sized at runtime —
  cut the strip, then dial in the counts from your phone. Up to 16 sections / 600 pixels on one data line.
- **Competition buttons:** STOP (red), PAUSE (yellow), FIGHT (green), **COUNTDOWN** (breathing red → fast-flashing
  yellow → flashing green GO → green), 10 s incapacitation count, robot **Fault** and **Wins** per side, work light, rainbow.
- **Effects:** blink, breathe, rainbow, chase, sparkle, progress bar, identify — on any target, optionally as
  timed overlays that fall back to what was showing.
- **Live preview** of the arena in the web page (mirrors the real LEDs).
- **WebSocket API** for the match server; also HTTP `POST /api/cmd`. Optional control token.
- **Match-server uplink:** the driver dials out to the [match tracker](../../../software/match-tracker/) over `wss://`
  (Settings → Match server), so it works from any network with internet.
- **WiFi:** joins the venue network (DHCP or static IP), falls back to its own hotspot, mDNS
  `http://wpfl-arena.local`, WiFi power-save off for latency.
- **Physical START/STOP buttons** (J8/J9) and BOOT-button countdown — work with no WiFi at all.
- **Buzzer** beeps on each countdown second and GO (Rotato JP1).
- **Power limiter** (estimated watts), gamma correction, selectable color order, OTA updates.
- **Heap watch:** free / minimum-ever / largest block in the UI, in every `status` message, and on serial.

## Quick start

```sh
cd arena/electronics/led-driver/firmware
pio run -t upload          # build + flash over USB-C (UI is embedded, no uploadfs)
pio device monitor         # 115200 baud: boot log, IP, heap
```

1. Join WiFi **`WPFL-Arena-XXXX`**, password **`wpflarena`** → open **<http://192.168.4.1>**.
2. **Control → STOP.** Arena should go red. If it goes green, Settings → *Color order* → try `GRB`.
3. **Setup → Identify sections.** Each section shows its own color, first pixel white. Use **− / +** next to each
   section until each block ends exactly at its corner ("Apply count changes instantly" is on). Tick **Rev** for
   pieces mounted backwards. **Save layout**.
4. **Settings → Network:** scan, pick the venue/Capek network, *Save & reboot*. Find it again at
   `http://wpfl-arena.local` or the IP on the serial log. If it can't join, the hotspot comes back.
5. Optional: Settings → Device → **Control token** so spectators on the same WiFi can't touch the lights.
6. Match tracker: Settings → **Match server** → URL `wss://wpfl-asmbly.thehomelab.dev/led`, key = the server's
   `LED_KEY`, Connect on. Status shows *Connected* once the server accepts it.

Later updates: build, then Settings → System → *Update firmware* with `firmware/bin/wpfl-arena-led-<ver>.bin`.

## During a match

| Button | Does |
|---|---|
| **STOP** / **PAUSE** / **FIGHT** | Whole arena red / yellow / green |
| **COUNTDOWN** | `3` red, breathing → `2`,`1` yellow, flashing fast → **GO** flashing green 2 s → solid green (times and colors editable in Settings) |
| **10 s COUNT** | Rule E.4 incapacitation count: yellow → red for the last 3 s → red |
| **Fault** (red/blue) | That robot's side blinks yellow for 3 s, then returns to the previous scene |
| **Wins** (red/blue) | Arena turns the winner's color with a 6 s sparkle |
| OFF · WHITE · RAINBOW | Lights off, work light, idle show |

"Red"/"blue" sides are the groups `red` (west half) and `blue` (east half) — re-assign them in Setup to match
where each robot actually starts. The physical START/STOP buttons and the BOOT button work at any time.

## Driving it from the match tracker

```python
# pip install websockets
import asyncio, json, websockets
async def main():
    async with websockets.connect("ws://wpfl-arena.local/ws") as ws:
        await ws.send(json.dumps({"type": "countdown", "label": "start"}))
asyncio.run(main())
```

See the [protocol](../../../docs/protocols/arena-led-websocket.md) for every command and the latency checklist,
and `tools/arena_led_client.py ping --count 200` to measure round-trip time.

## Firmware layout

```
firmware/
├── platformio.ini            board, pinned platform + libs, build scripts
├── ui/index.html             web UI (gzip-embedded at build time)
├── scripts/                  auto_version, embed_web_ui, copy_firmware (from Rotato)
├── test_host/                PC-side unit tests for the LED logic (run.sh)
└── src/
    ├── config.h              ALL pins and compile-time constants
    ├── version.h             firmware + protocol version
    ├── main.cpp              setup/loop, buttons
    ├── app/ArenaController   protocol, sessions, settings, mutex, deferred saves/reboots
    ├── led/ArenaLayout       sections, groups, targets, logical→physical map (NVS)
    ├── led/LedEngine         base buffer + effect slots + countdown
    ├── led/LedOutput         SPI + DMA output, color order, gamma, power limit
    ├── led/Color             RGB helpers
    ├── connectivity/         WiFiManager (STA/AP/mDNS), WebServerManager (HTTP/WS/OTA), Uplink (wss:// to the match server)
    └── hardware/             BuzzerController, SupplyMonitor (from Rotato), Button
```

## Memory budget

The C3 has ~320 KB of heap region and no PSRAM. Everything sized by the LED count is **static** (allocated at
link time) so it can't fragment the heap; the heap is left for WiFi, TCP and WebSockets.

| Item | Size | Where |
|---|---|---|
| Base + output frame (600 px max) | 3.6 KB | static |
| Preview frame + hex scratch | 3.6 KB | static |
| WebSocket reassembly buffer | 3 KB | static |
| Layout + 8 effect slots + sessions | ~1 KB | static |
| SPI DMA buffer (600 px max) | 12 B × (600 + 8) + 120 B reset → **7.4 KB** | static |
| JSON documents | 1–4 KB, freed after each message | heap, transient |
| Per WebSocket client | a few KB + send queue (capped at 16 messages) | heap |

Build report: **RAM 65 KB static (20 %)**, flash 1.10 MB (56 % of one OTA slot — TLS for the uplink), UI 12.6 KB gzipped.
The uplink's TLS session takes ~30–40 KB of heap while connected.

Guards: max 6 sockets; new sockets refused when the largest free block < 24 KB; preview frames paused when free
heap < 30 KB; slow clients get messages dropped instead of queued; messages > 3 KB rejected; a serial warning
when free heap < 40 KB. Watch **Heap min ever** in Settings → System during a full event day — that is the
number that tells you how close it came.

## Troubleshooting

| Symptom | Check |
|---|---|
| Colors swapped (red shows green) | Settings → Color order (our strips are `RGB` despite the listing; try `GRB`) |
| Random flicker / wrong pixels | Firmware ≥ 0.2 (SPI output — older RMT builds glitched under WiFi load). Then: level shifter, common GND, short data lead, 330 Ω resistor |
| First pixel OK, rest dead | DIN/DO direction — arrows on the strip must point away from the controller |
| Last pixels of a run stay dark | Count too low for that section (Setup) |
| Pixels after the end stay lit | Count too high; the driver blanks 8 pixels past each chain's end |
| Can't find `wpfl-arena.local` | mDNS blocked on that network — use the IP (serial log / router) or set a static IP |
| "auth required" | A control token is set; the page asks for it once and remembers it |
| Lights fade when everything is white | Power limiter (Settings → Max watts) — the status shows `LIMITED` |

## Tests

```sh
cd firmware && pio pkg install && sh test_host/run.sh     # needs a host g++ (C++14)
```

86 checks covering layout validation, target resolution, countdown timing, overlays, layering and slot limits.

---

Author: **Angel Hernandez** — [www.thehomelab.dev](https://www.thehomelab.dev). Derived from the
[Rotato](https://github.com/Mifulapirus/Rotato) controller firmware. Non-Commercial Source-Available License — see
[LICENSE](../../../LICENSE).

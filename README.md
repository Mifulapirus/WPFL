# WPFL — Weaponized Plastic Fighting League

Everything behind the **Weaponized Plastic Fighting League** events: the arena, its electronics, the live
match-tracking software, and event documentation.

🔗 **Rules & event info:** [wpfl.thehomelab.dev](https://wpfl.thehomelab.dev/) ·
Next event: **Weaponized Plastic @ Asmbly — October 24, 2026** (1 kg, 3D-printed plastic combat robots)

**Author:** Angel Hernandez — [www.thehomelab.dev](https://www.thehomelab.dev)

> **AI assistants:** read [`AI_CONTEXT.md`](AI_CONTEXT.md) first.

---

## Repository map

```
WPFL/
├── arena/                         The physical arena (4 ft × 4 ft × 2 ft box)
│   ├── structure/                 Frame, floor, polycarbonate walls: CAD, drawings, cut lists, BOM
│   └── electronics/               Everything powered in/around the arena
│       ├── boards/
│       │   └── rotato-pcb/        Reference for the Rotato ESP32-C3 board we reuse
│       └── led-driver/            ★ Arena LED driver: firmware, web UI, wiring, test client
├── software/
│   └── match-tracker/             Live match tracking website + referee console (wpfl-asmbly.thehomelab.dev)
├── docs/
│   ├── rules.md                   Event rules summary (official: wpfl.thehomelab.dev)
│   └── protocols/                 Interfaces between components
│       └── arena-led-websocket.md   LED driver ⇄ match tracker / UI
├── AI_CONTEXT.md                  Lean technical context for AI assistants
└── LICENSE                        Non-commercial source-available license
```

### Conventions

- **One folder per thing you can build or deploy**, each with its own `README.md` (what it is, how to build it,
  how to use it).
- **Interfaces live in [`docs/protocols/`](docs/protocols/)**, not inside one component — both sides of a
  connection read the same spec.
- Firmware projects are self-contained PlatformIO projects (`platformio.ini` at their root).
- Reusable boards get a reference page under `arena/electronics/boards/`.

## Components

| Component | Status | Where |
|---|---|---|
| Arena LED driver | 🟢 firmware v0.2 — bench testing | [`arena/electronics/led-driver`](arena/electronics/led-driver/) |
| Rotato PCB reference | 📄 documented | [`arena/electronics/boards/rotato-pcb`](arena/electronics/boards/rotato-pcb/) |
| Arena structure | ⚪ to document | [`arena/structure`](arena/structure/) |
| Match tracker (Capek-Web) | 🟡 v0.1 first pass — Swiss, referee console, LED link | [`software/match-tracker`](software/match-tracker/) |

## How the pieces talk

```
 Referee tablet ─┐                                     LED driver (ESP32-C3) ─► 72 px COB strip
 Spectator view ─┼─► Match tracker on Capek-Web ◄─wss── │  dials out from the venue WiFi (no shared LAN needed)
 Brackets/scores ┘     (live site, referee console)      ├─ own web UI + WebSocket API on the LAN
                                                         └─ START / STOP buttons (offline fallback)
```

---

## License

Copyright (c) 2026 **Angel Hernandez** — [www.thehomelab.dev](https://www.thehomelab.dev)

Released under a **Non-Commercial Source-Available License** (same terms as
[Rotato](https://github.com/Mifulapirus/Rotato), from which the LED driver firmware is derived):
attribution required (`Angel Hernandez — www.thehomelab.dev`), no commercial use without written permission,
derivatives under the same license. See [LICENSE](LICENSE).

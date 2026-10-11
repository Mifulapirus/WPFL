# Arena electronics

| Folder | What |
|---|---|
| [`led-driver/`](led-driver/) | Arena LED driver — firmware, web UI, wiring, test client |
| [`boards/rotato-pcb/`](boards/rotato-pcb/) | Reference for the Rotato ESP32-C3 board used as the arena controller |

## System overview

```
            ┌──────────── 24 V PSU (≥ 5 A) ── 5 A fuse ──┬──────────── 24 V / GND bus ──► 8 strip pieces
120 V AC ───┤                                            │
            │                                            └─ 24→5 V (USB-C) or 24→12 V buck ─► Rotato PCB
            │                                                                                 │
            │                                    data (J5, via 74AHCT125) ◄───────────────────┤
            │                                    START/STOP buttons (J8/J9) ──────────────────┤
            │                                                                                 │
            └─ venue WiFi ◄────────────── WebSocket ──── match tracker on Capek ◄─────────────┘
```

Adding a new device? Give it its own folder here (`<device>/firmware`, `<device>/docs`, `README.md`), and put
its network interface in [`docs/protocols/`](../../docs/protocols/).

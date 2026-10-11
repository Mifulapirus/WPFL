# Match tracker (planned)

Live match-tracking website and referee console, hosted on **Capek**. It will:

- show brackets, the current match, a 2-minute match timer and results to spectators (live);
- give the referee a console to start matches, call pauses, flag **faults per robot**, run the 10 s
  incapacitation count and declare winners;
- drive the arena lights automatically through the LED driver's WebSocket API.

## LED integration plan

- Keep one persistent WebSocket to `ws://wpfl-arena.local/ws` (or the driver's static IP); reconnect with back-off
  and re-send the current scene after reconnecting.
- Map match events to commands (see [protocol §7](../../docs/protocols/arena-led-websocket.md#7-recipes-for-the-match-tracker)):

| Match event | LED command |
|---|---|
| Robots placed / waiting | `solid yellow` (label `ready`) |
| Start | `countdown` (driver times it; ends solid green) |
| Pause / unstick | `solid yellow` (label `pause`) |
| Fault on robot X | `effect blink` overlay on group `red`/`blue`, 3 s |
| Incapacitated count | `countdown seconds:10` on that robot's side group |
| Last 30 s | `effect progress` on `ceiling`, or a short overlay blink |
| End / winner | `solid <winner color>` + `sparkle` overlay |
| Between matches | `effect rainbow` |

- Send time-critical commands without `id`; use `id` + ack for anything you want confirmed.
- Use `arena_led_client.py` ([`arena/electronics/led-driver/tools`](../../arena/electronics/led-driver/tools/)) as
  the reference implementation and latency tester.
- If you set a control token on the driver, send `{"type":"auth","token":…}` right after connecting.

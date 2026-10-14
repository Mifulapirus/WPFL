# Arena LED Driver — WebSocket API (protocol v1)

This is the contract between the **arena LED driver** (ESP32-C3 on a Rotato PCB, firmware in
[`arena/electronics/led-driver/firmware`](../../arena/electronics/led-driver/firmware)) and anything that drives
it: the built-in web UI, the match tracker on Capek, or the reference client
[`arena_led_client.py`](../../arena/electronics/led-driver/tools/arena_led_client.py).

> **Source of truth:** `src/app/ArenaController.cpp`. If you change a message there, update this file and bump
> `PROTOCOL_VERSION` in `src/version.h` when clients have to change too.

---

## 1. Connecting

| | |
|---|---|
| WebSocket | `ws://wpfl-arena.local/ws` (mDNS), `ws://<ip>/ws`, or `ws://192.168.4.1/ws` in hotspot mode |
| Uplink | Or the driver dials **out** to a server you run — see [§8](#8-uplink-the-driver-connects-to-a-server) |
| Max clients | 6. Extra sockets, or sockets opened while heap is low, are closed with code **1013** (try again later) |
| Max message | 3072 bytes |
| Keep-alive | The driver pings every 10 s; standard clients answer automatically |

On connect the driver immediately sends **`config`**, **`state`** and **`status`** (in that order). After that:

- `state` — whenever something visible changes (at most every 50 ms)
- `status` — every 2 s (heartbeat, includes heap and WiFi info)
- `config` — whenever layout or settings change (from any client)

### Optional token

If a control token is set (Settings → Device), every command that changes something needs an authenticated
socket. Read-only commands (`ping`, `auth`, `get_*`, `subscribe`) always work.

```json
→ {"type":"auth","token":"s3cret"}
← {"type":"auth","ok":true}
```

---

## 2. Concepts

| Term | Meaning |
|---|---|
| **pixel** | One addressable unit. On the PAUTIX COB strip: one WS2811 IC = one **10 cm segment** (63 LEDs). |
| **section** | A physical piece of strip, e.g. `ceil_n` (12 px), `edge_ne` (6 px) or `floor_e` (12 px). Ceiling and floor sections run clockwise seen from above; edges run top → bottom. |
| **group** | A named set of sections. Defaults: `ceiling`, `edges`, `floor`, `red` (west half), `blue` (east half). |
| **target** | What a command acts on: `"all"` (default when omitted), a group, a section, a comma list `"ceil_n,edge_ne"`, or an array `["red","ceil_n"]`. |
| **logical index** | Pixel number with sections concatenated in list order. Used by `pixels` and binary frames. |
| **base layer** | Static colors. Set by `solid`, `off`, `pixel`, `pixels`, binary frames. |
| **effects** | Up to 8 animations drawn on top of the base, each on its own target, in the order they were added. |
| **label** | Free text describing the current scene (`"fight"`, `"pause"`…). Shown in UIs, never interpreted. |

### Layering rules

- `solid` / `off` / pixel writes on sections S **remove S from every effect** — the new color is what you see.
- A normal effect on S also removes S from every older effect.
- An effect with `"overlay": true` is stacked on top and removes nothing. Give it a `duration` and, when it ends,
  whatever was below shows again. Use this for temporary alerts (robot fault, pin warning…).
- `countdown` is an effect (non-overlay). When its GO phase ends it can write a `then` color into the base.

---

## 3. Message envelope

Every message is a JSON object with a `"type"`. Add an `"id"` (any JSON value) to get a reply that echoes it:

```json
→ {"type":"solid","color":"red","id":42}
← {"type":"ack","ok":true,"cmd":"solid","id":42}
```

Without `id`, successful commands get **no reply** (lowest latency, fire-and-forget). Errors are always reported:

```json
← {"type":"error","error":"unknown target","cmd":"solid","id":42}
```

### Colors

`"#rrggbb"`, `"#rgb"`, `[r,g,b]`, or a name: `off black white warm red orange yellow green cyan blue purple pink`.

---

## 4. Commands (client → driver)

### Lights

| type | fields | notes |
|---|---|---|
| `solid` | `color`, `target?`, `label?` | Base fill. |
| `off` | `target?`, `label?` | Same as `solid` black. |
| `effect` | `fx`, `target?`, `color?` (white), `color2?` (black), `period?` ms, `duration?` ms (0 = forever), `overlay?`, `value?` (0–1, progress), `label?` | `fx`: `blink` `breathe` `rainbow` `chase` `sparkle` `progress` `identify` (also `solid`/`off`). |
| `countdown` | `target?`, `seconds?`, `warnAt?`, `goMs?`, `high?`, `warn?`, `go?`, `then?` (color or `"none"`), `style?` (`"pulse"` or `"solid"`), `label?` | Missing fields use the saved defaults (3 s, warn at 2 s, GO flash 2000 ms, red/yellow/green, then green, style pulse). |
| `cancel` | `target?` | Stop effects (and countdowns) on the target; base stays. |
| `brightness` | `value` 0–255 | Global, saved. |
| `pixel` | `index`, `color`, `target?` (one section → index is inside it), `clear?` | Base layer. `clear:true` blacks out everything first. |
| `pixels` | `hex` (`"ff0000 00ff00…"` without spaces), `start?`, `target?` (one section) | Base layer, logical order. |
| `identify` | `on` (default true) | Setup aid: each section its own hue, first pixel white. |

**Countdown timeline** (defaults): `3` red → `2` yellow → `1` yellow → **GO** green flashing (150 ms) for 2 s → solid
green. "Red" lasts while remaining time > `warnAt`; "yellow" from `warnAt` down to 0. When the GO phase ends the
`state.label` becomes `"go"`.

`style`: `"pulse"` (default) makes the red phase **breathe** (1 s per breath, brightest on each whole second, in step
with the beeps) and the yellow phase **flash very fast** (50 ms on / 50 ms off). `"solid"` keeps both steady (the
10 s count uses this). The GO flash is the same in both styles.

### Session

| type | fields | reply |
|---|---|---|
| `ping` | `t?` | `{"type":"pong","t":…,"ms":<driver millis>}` |
| `auth` | `token` | `{"type":"auth","ok":bool}` |
| `get_state` / `get_status` / `get_config` | — | the corresponding message |
| `subscribe` | `frames` (bool), `fps?` 1–30 | start/stop binary preview frames for this socket |

### Configuration

| type | fields | notes |
|---|---|---|
| `set_layout` | `sections:[{name,count,rev?}]`, `groups?:[{name,sections:[names]}]` | Applied immediately (identify pattern shown), saved after 1.5 s. Names: `a-z 0-9 _ -`, ≤ 15 chars. One data output: list order = chain order. A legacy `out` field is ignored. |
| `reset_layout` | — | Back to the default 8-section layout. |
| `set_settings` | `settings:{…}` (any subset, see `config.settings`) | Saved after 1.5 s. |
| `wifi_scan` | — | Reply arrives as `{"type":"wifi_scan","networks":[{ssid,rssi,secure}]}`. |
| `set_wifi` | `ssid`, `pass?` (omit = keep), `static?:{enabled,ip,gateway,mask,dns}` | **Reboots.** |
| `forget_wifi` | — | **Reboots** into hotspot mode. |
| `set_device` | `hostname`, `apSsid?`, `apPass?` (omit/empty = keep) | **Reboots.** |
| `set_token` | `token` (empty = disable) | Other sockets must re-auth. |
| `set_uplink` | `enabled`, `url` (`wss://…` or `ws://…`), `key?` (omit = keep) | Saved to NVS, link restarts. See §8. |
| `reboot` / `factory_reset` | — | `factory_reset` wipes WiFi, device, layout and LED settings. |

### Binary input — stream pixels

For custom animations computed on the server:

```
byte 0     0x01
byte 1-2   start index (big-endian, logical)
byte 3…    r,g,b triplets
```

Writes the base layer (cancels effects on the touched sections). Needs auth if a token is set. Max 3072 bytes
per message (~1000 pixels).

---

## 5. Messages (driver → client)

### `state`

```json
{"type":"state","label":"countdown","brightness":200,"pixels":96,
 "effects":[{"fx":"countdown","mask":1023,"overlay":false}],
 "countdown":{"remainingMs":1400,"secondsLeft":2,"phase":"warn","mask":1023,"style":"pulse"}}
```

`mask` = bit *i* set → section *i* of `config.layout.sections`. `countdown` is `null` when none is running.
`phase`: `high` | `warn` | `go`. `style`: `pulse` | `solid`. Effects with a duration include `leftMs`.

### `status` (every 2 s)

```json
{"type":"status","fw":"0.1.0.12","proto":1,"uptime":5321,"reset":"power_on",
 "heap":{"free":183000,"min":171000,"maxBlock":110580,"total":327680},
 "wifi":{"mode":"sta","ip":"192.168.1.50","ssid":"Asmbly","rssi":-58,"host":"wpfl-arena","apSsid":"WPFL-Arena-A3F2"},
 "clients":2,"fps":60,"watts":41.3,"limited":false,"supplyV":null,"pixels":96,"auth":false,"uplink":"connected"}
```

`reset`: why the chip last restarted (`power_on`, `software`, `panic`, `task_wdt`, `int_wdt`, `brownout`; `unknown` also covers a reset over USB, e.g. after flashing). `watts` is an estimate after brightness/gamma/limit. `supplyV` is `null` when nothing is wired to the battery input.
`wifi.mode`: `sta`, `ap`, or `ap+sta` (fallback hotspot up while retrying the network).
`uplink`: `off`, `waiting` (no WiFi network yet), `connecting`, `connected`.

### `config`

```json
{"type":"config","fw":"0.1.0.12","proto":1,
 "layout":{"sections":[{"name":"ceil_n","count":12,"rev":false,"start":0}, …],
           "groups":[{"name":"ceiling","sections":["ceil_n","ceil_e","ceil_s","ceil_w"]}, …],"total":96},
 "settings":{"brightness":200,"colorOrder":"RGB","gamma":true,"maxWatts":100,"wattsPerPixel":1.2,
             "bootScene":"rainbow","buzzer":true,
             "countdown":{"seconds":3,"warnAt":2,"goMs":2000,"high":"#ff0000","warn":"#ffc800","go":"#00ff00","then":"#00ff00"}},
 "device":{"hostname":"wpfl-arena","apSsid":"WPFL-Arena-A3F2","tokenSet":false},
 "uplink":{"enabled":true,"url":"wss://wpfl-asmbly.thehomelab.dev/led","keySet":true},
 "wifi":{"ssid":"Asmbly","static":{"enabled":false,"ip":"","gateway":"","mask":"255.255.255.0","dns":""}},
 "limits":{"maxPixels":600,"maxSections":16,"maxGroups":8,"maxEffects":8},
 "bootScenes":["off","white","rainbow","red","yellow","green","blue"]}
```

### Binary `0x02` — preview frames (after `subscribe`)

```
byte 0     0x02
byte 1-2   pixel count (big-endian)
byte 3…    r,g,b per logical pixel (before brightness/gamma)
```

Frames are skipped for a client whose send queue is full, and paused while free heap < 30 KB.

---

## 6. HTTP API (curl, health checks)

| | |
|---|---|
| `GET /api/status` · `/api/state` · `/api/config` | Same JSON as the WebSocket messages |
| `POST /api/cmd` | Body = one command object → reply JSON. Token via header `X-Token`, `?token=`, or a `"token"` field |
| `POST /update` | Multipart firmware `.bin` (OTA). Token via `X-Token` |

```sh
curl -X POST http://wpfl-arena.local/api/cmd -d '{"type":"countdown","seconds":5}'
```

---

## 7. Recipes for the match tracker

```json
{"type":"solid","color":"yellow","label":"pause"}
{"type":"countdown","label":"start"}
{"type":"solid","color":"green","label":"fight"}
{"type":"effect","fx":"blink","target":"red","color":"yellow","period":300,"duration":3000,"overlay":true}
{"type":"countdown","seconds":10,"warnAt":3,"high":"yellow","warn":"red","go":"red","then":"red","style":"solid","label":"10s count"}
{"type":"effect","fx":"progress","target":"ceiling","color":"green","color2":"#200000","value":0.75}
{"type":"solid","color":"red","label":"red wins"}
{"type":"effect","fx":"sparkle","color":"white","color2":"red","period":90,"duration":6000,"overlay":true}
```

### Latency checklist

1. Keep **one persistent socket**; reconnect with a short back-off (the driver may reboot).
2. Send time-critical commands **without `id`** (no ack round-trip to wait for).
3. Let the driver time things itself (`countdown`, effects with `duration`) instead of streaming frames.
4. Make sure TCP_NODELAY is on in your client (Python `asyncio`/`websockets` does this by default). The driver
   sets it on its side and disables WiFi power-save.
5. After a reconnect, re-send the current scene — only the boot scene survives a reboot.
6. Measure: `python arena_led_client.py ping --count 200`.

---

## 8. Uplink: the driver connects to a server

For a server that is **not on the venue network** (the match tracker on Capek-Web), the driver opens the
connection itself, so NAT and firewalls at the venue don't matter.

| | |
|---|---|
| Configure | Driver page → Settings → Match server, or `{"type":"set_uplink","enabled":true,"url":"wss://host/led","key":"…"}` |
| Handshake | `GET <url>` WebSocket upgrade with `Authorization: Bearer <key>` and `User-Agent: wpfl-arena-led` |
| TLS | `wss://` is verified against the Let's Encrypt roots in `src/connectivity/RootCerts.h` (dates not checked — no NTP). `ws://` for LAN tests |
| Session | Exactly like a `/ws` client that is already authenticated: same commands, same replies, same `config`/`state`/`status` pushes. No preview frames |
| Keep-alive | WebSocket ping every 10 s, link dropped after 25 s without pong; reconnects every ~10 s while enabled and WiFi (STA) is up |

Server rules:

- **Wait for the driver's first message** (`config`, sent right after connecting) before sending anything. The driver's
  ESP-IDF 4.4 client can drop a message that arrives in the same TCP segment as the handshake reply.
- On every (re)connect, send the scene for the current match state.
- Accept one driver at a time; a new connection replaces the old one.
- Keep messages ≤ 3072 bytes and unfragmented.

Reference server: [`software/match-tracker/src/led.js`](../../software/match-tracker/src/led.js).

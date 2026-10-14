# Arena LED wiring

## The strip

**PAUTIX RGB Smart-IC COB, 24 V, 12 W/m** ([Amazon B0CW3DNWV8](https://www.amazon.com/dp/B0CW3DNWV8)) — from the listing:

| | |
|---|---|
| IC | **WS2811**, one IC per **10 cm** → **10 pixels/m** (63 LEDs share each IC) |
| Color order | Listing says **GRB** ("G.R.B, NOT R.G.B") — our strips are actually **RGB** (firmware default) |
| Power | 24 V, 12 W/m → **1.2 W per pixel** at full white (≈ 50 mA @ 24 V) |
| Wires | 3: **+24 V**, **DATA** (DIN → DO, one direction only), **GND** |
| Width / cut | 12 mm, cut only at the marked 10 cm points |

So "individually addressable" means **per 10 cm segment**. The 63 LEDs inside one segment always share a color.

## Pixel budget for the 4 × 4 × 2 ft box

| Run | Length | Cut to | Pixels |
|---|---|---|---|
| Ceiling × 4 | 4 ft = 121.9 cm | 120 cm | **12** each |
| Vertical edge × 4 | 2 ft = 61.0 cm | 60 cm | **6** each |
| Floor edge × 2 (E, W) | 4 ft = 121.9 cm | 120 cm | **12** each |
| **Total** | 32 ft | 9.6 m | **96 px ≈ 115 W** max (full white) |

Your real counts go into the web UI (Setup tab) after cutting. Nothing in the firmware needs recompiling.

## Recommended data path (single output, default layout)

The data signal has a direction (DIN → DO), so the chain snakes through every piece. The default layout assumes
the controller sits at the **NW top corner** and this order:

```
 Top view (ceiling), north up.  ● = corner where a vertical edge strip hangs down.

            NW ●───────── ceil_n ────────►● NE
   DIN ──────► ▲                          │
               │                          │
            ceil_w                     ceil_e
               │                          │
               │                          ▼
            SW ●◄──────── ceil_s ─────────● SE

 Chain (one data line, output A / J5):

   DIN@NW → ceil_n → edge_ne ↓↺ → ceil_e → edge_se ↓↺ → ceil_s → edge_sw ↓↺ → ceil_w → edge_nw ↓
          → floor_w (NW→SW) ⇢ floor_e (SE→NE) (end)

   ↓  data runs down the edge strip (top → bottom)
   ↺  data return wire (data + GND, ~2 ft) back up the same edge to the next ceiling piece's DIN
   ⇢  data jumper (data + GND, ~4 ft) along the south floor edge, SW → SE

 Floor level (top view), after edge_nw reaches the floor at NW:

            NW ●                          ● NE
               │                          ▲
            floor_w                    floor_e
               ▼                          │
            SW ●⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢⇢● SE
```

That keeps every jumper short, along a corner post, and out of the robots' reach. Ceiling and floor pieces run
clockwise seen from above (floor pixel *i* sits under ceiling pixel *i*); edges run top → bottom. The path above
lays both floor pieces against that direction, so the default layout has **rev** ticked for `floor_w` and
`floor_e`. If you mount any piece the other way round, toggle **rev** for it in Setup — no rewiring needed.

The floor pieces come last in the chain, so adding them doesn't change any ceiling or edge pixel numbers.

There is a single data output (J5). The order in the Setup list is the order along the chain.

## Power

```
 120 V AC ─► 24 V PSU (≥ 5 A / 120 W) ─► 5 A fuse ─►┬─ 18 AWG power bus (+24 V / GND) around the top perimeter
                                                     │      tap into the +24 V/GND pads at the start of each piece
                                                     │      (10 taps; each piece draws ≤ 0.6 A;
                                                     │       run a +24 V/GND drop down to the floor pieces)
                                                     │
                                                     └─► 24 V → 5 V USB buck ─► Rotato USB-C   (option A, simplest)
                                                         24 V → 12 V buck   ─► Rotato battery terminal (option B)
```

- **Common ground is mandatory:** Rotato GND ↔ PSU GND ↔ strip GND. With option A the buck provides it only if
  its input and output grounds are shared (most non-isolated bucks do) — otherwise add a GND wire.
- **Never feed 24 V into the Rotato battery terminal** (see [board reference](../../boards/rotato-pcb/README.md)).
  Option B (12 V) lets the firmware report the supply voltage (`supplyV`) as a health check.
- Put a **1000 µF / 35 V** electrolytic across +24 V/GND where the bus starts.
- Each strip piece is short; 18 AWG for the bus and 22 AWG for taps is plenty.
- The firmware caps estimated LED power at **100 W** by default (Settings → *Max watts*). Set it to ~80 % of your
  PSU rating. With the floor pieces, full white (≈ 115 W) exceeds 100 W, so the cap dims it slightly. To lift the
  cap, use a ≥ 6.5 A / 150 W PSU and raise *Max watts* to ~120.

## Data signal

```
Rotato J5 signal (GPIO1, 3.3 V) ──[ 74AHCT125 @ 5 V ]──[ 330 Ω ]──► DIN of the first piece
Rotato J5 GND ───────────────────────────────────────────────────► strip GND
```

- WS2811 ICs on 24 V strips want a logic-high around 0.7 × their internal supply. **3.3 V often works but is
  marginal** — a 74AHCT125 (or SN74AHCT1G125) powered from 5 V makes it reliable. Strongly recommended for an event.
- Keep controller → first pixel short (< 1 m). Mount the Rotato board at the NW top corner.
- 330 Ω series resistor near the driver dampens ringing.
- Use only the **signal + GND** pins of J5, never the centre +V pin.

## Alternate board: classic ESP32 dev board (WROOM-32) — test only

Used to compare WiFi range with the Rotato/C3 board. It is **not** on the Rotato PCB, so wire it by hand. Build
and flash with `pio run -e wroom-test -t upload --upload-port COMx` (the plain `pio run` targets the C3 only).

| Function | C3 (Rotato) | WROOM-32 | Notes |
|---|---|---|---|
| LED data out | GPIO1 (J5) | **GPIO23** | Through the 74AHCT125 + 330 Ω, same as above |
| Supply sense (optional) | GPIO0 | **GPIO34** | ADC1, input-only. Same 39 K / 10 K divider; max 15 V at the divider |
| START button (to GND) | GPIO5 (J8) | **GPIO25** | Internal pull-up |
| STOP button (to GND) | GPIO6 (J9) | **GPIO26** | Internal pull-up |
| Buzzer (passive) | GPIO7 (JP1) | **GPIO27** | |
| BOOT button | GPIO9 | **GPIO0** | The board's BOOT button: short = countdown, hold 3 s = forget WiFi |
| Spare | GPIO3, 4 | GPIO16, 17 | Unused |

- GND is common as usual. Power it from USB for the test; it has no battery input.
- **Brownout resets:** a weak USB cable, hub or port makes the board reset in a loop ("Brownout detector was
  triggered") as soon as WiFi starts. Use a short, thick cable straight into the PC, or a phone charger.
- No USB-C native port: Serial goes through the board's CH340 chip, so the build leaves the C3's USB-CDC flags off.
- The supply sense is on GPIO34 (ADC1) on purpose: the ADC2 pins (GPIO0, 2, 4, 12–15, 25–27) can't do analog reads
  while WiFi is on. Using them as plain digital pins (buttons, buzzer) is fine. GPIO0 is also the boot strap pin.

## Optional physical buttons

| Connector | Button | Action |
|---|---|---|
| J8 (GPIO5) | momentary to GND | **START** — default countdown |
| J9 (GPIO6) | momentary to GND | **STOP** — whole arena red |
| BOOT (GPIO9) | on the module | short = countdown, hold 3 s = forget WiFi |

They work even with no WiFi. Internal pull-ups are used, so leaving them unconnected is fine.

## Bill of materials

| Qty | Part |
|---|---|
| 1 | Rotato PCB with ESP32-C3 Super Mini (JP1 closed for the buzzer) |
| 1 | PAUTIX 24 V COB WS2811 strip, 10 m roll (9.6 m used) |
| 1 | 24 V ≥ 5 A power supply |
| 1 | 5 A inline fuse + holder |
| 1 | 24 V → 5 V USB-C buck **or** 24 V → 12 V buck |
| 1 | 74AHCT125 level shifter (+ 0.1 µF decoupling) |
| 1 | 330 Ω resistor, 1000 µF 35 V capacitor |
| ~6 m | 18 AWG red/black (power bus) |
| ~5.5 m | 2-core twisted 22–24 AWG (data return wires + floor jumper) |
| 2 | Momentary buttons (optional START/STOP) |
| — | 12 mm 3-pin strip connectors or solder + heat-shrink |

## First power-up checklist

1. Flash the firmware with **only USB** connected (no 24 V yet).
2. Connect strip GND + data, then 24 V. You should see the boot rainbow.
3. Join WiFi **WPFL-Arena-XXXX** (password `wpflarena`) → <http://192.168.4.1>.
4. Control → **STOP**. If the arena is green instead of red, change *Color order* in Settings (try `GRB`).
5. Setup → **Identify sections**, then fix each section's pixel count until every colored block ends exactly at
   its corner. Use the **pixel probe** to count.
6. Settings → Network → join the venue network (or keep the hotspot). Note the IP / `wpfl-arena.local`.

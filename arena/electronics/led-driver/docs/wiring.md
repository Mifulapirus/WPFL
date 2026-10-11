# Arena LED wiring

## The strip

**PAUTIX RGB Smart-IC COB, 24 V, 12 W/m** ([Amazon B0CW3DNWV8](https://www.amazon.com/dp/B0CW3DNWV8)) — from the listing:

| | |
|---|---|
| IC | **WS2811**, one IC per **10 cm** → **10 pixels/m** (63 LEDs share each IC) |
| Color order | **GRB** ("G.R.B, NOT R.G.B") — firmware default |
| Power | 24 V, 12 W/m → **1.2 W per pixel** at full white (≈ 50 mA @ 24 V) |
| Wires | 3: **+24 V**, **DATA** (DIN → DO, one direction only), **GND** |
| Width / cut | 12 mm, cut only at the marked 10 cm points |

So "individually addressable" means **per 10 cm segment**. The 63 LEDs inside one segment always share a color.

## Pixel budget for the 4 × 4 × 2 ft box

| Run | Length | Cut to | Pixels |
|---|---|---|---|
| Ceiling × 4 | 4 ft = 121.9 cm | 120 cm | **12** each |
| Vertical edge × 4 | 2 ft = 61.0 cm | 60 cm | **6** each |
| **Total** | 24 ft | 7.2 m | **72 px ≈ 86 W** max (full white) |

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

   DIN@NW → ceil_n → edge_ne ↓↺ → ceil_e → edge_se ↓↺ → ceil_s → edge_sw ↓↺ → ceil_w → edge_nw ↓ (end)

   ↓  data runs down the edge strip (top → bottom)
   ↺  data return wire (data + GND, ~2 ft) back up the same edge to the next ceiling piece's DIN
```

That keeps every jumper short, along a corner post, and out of the robots' reach. Ceiling pieces run clockwise seen from above; edges run top → bottom. If you mount any piece the
other way round, tick **rev** for it in Setup — no rewiring needed.

Prefer two chains? Put the ceiling ring on **output A (J5)** and the four edges on **output B (J6)** and set each
section's *Out* column in Setup. Order within each output = order in the Setup list.

## Power

```
 120 V AC ─► 24 V PSU (≥ 5 A / 120 W) ─► 5 A fuse ─►┬─ 18 AWG power bus (+24 V / GND) around the top perimeter
                                                     │      tap into the +24 V/GND pads at the start of each piece
                                                     │      (8 taps; each piece draws ≤ 0.6 A)
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
  PSU rating if you use a smaller supply.

## Data signal

```
Rotato J5 signal (GPIO1, 3.3 V) ──[ 74AHCT125 @ 5 V ]──[ 330 Ω ]──► DIN of the first piece
Rotato J5 GND ───────────────────────────────────────────────────► strip GND
```

- WS2811 ICs on 24 V strips want a logic-high around 0.7 × their internal supply. **3.3 V often works but is
  marginal** — a 74AHCT125 (or SN74AHCT1G125) powered from 5 V makes it reliable. Strongly recommended for an event.
- Keep controller → first pixel short (< 1 m). Mount the Rotato board at the NW top corner.
- 330 Ω series resistor near the driver dampens ringing.
- Use only the **signal + GND** pins of J5/J6, never the centre +V pin.

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
| 1 | PAUTIX 24 V COB WS2811 strip, 10 m roll (7.2 m used) |
| 1 | 24 V ≥ 5 A power supply |
| 1 | 5 A inline fuse + holder |
| 1 | 24 V → 5 V USB-C buck **or** 24 V → 12 V buck |
| 1 | 74AHCT125 level shifter (+ 0.1 µF decoupling) |
| 1 | 330 Ω resistor, 1000 µF 35 V capacitor |
| ~6 m | 18 AWG red/black (power bus) |
| ~4 m | 2-core twisted 22–24 AWG (data return wires) |
| 2 | Momentary buttons (optional START/STOP) |
| — | 12 mm 3-pin strip connectors or solder + heat-shrink |

## First power-up checklist

1. Flash the firmware with **only USB** connected (no 24 V yet).
2. Connect strip GND + data, then 24 V. You should see the boot rainbow.
3. Join WiFi **WPFL-Arena-XXXX** (password `wpflarena`) → <http://192.168.4.1>.
4. Control → **STOP**. If the arena is green instead of red, change *Color order* in Settings (try `RGB`).
5. Setup → **Identify sections**, then fix each section's pixel count until every colored block ends exactly at
   its corner. Use the **pixel probe** to count.
6. Settings → Network → join the venue network (or keep the hotspot). Note the IP / `wpfl-arena.local`.

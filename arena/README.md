# Arena

The WPFL fighting arena: a **4 ft × 4 ft × 2 ft** box with a black plywood floor, 1/4" polycarbonate walls and a
sacrificial black 1×4 pine edge (see [rules](../docs/rules.md#arena-rules-d)).

| Folder | Contents |
|---|---|
| [`structure/`](structure/) | Frame, floor, walls, doors/lids: CAD, drawings, cut lists, assembly notes, BOM |
| [`electronics/`](electronics/) | Power distribution, LED driver, boards, future sensors/buttons |

## Lighting layout

24 ft of 24 V addressable COB strip along the ceiling perimeter and the four vertical edges:

| Sections | Length | Pixels (10 cm each) |
|---|---|---|
| Ceiling N, E, S, W | 4 × 4 ft | 4 × 12 |
| Vertical edges NE, SE, SW, NW | 4 × 2 ft | 4 × 6 |
| **Total** | **24 ft (7.2 m)** | **72** |

Orientation convention used by the LED driver and the match tracker: **north = back wall** (as seen from the
judges' table), ceiling pieces run clockwise seen from above, edges run top → bottom. The **red** robot side is
the west half, **blue** the east half — change the groups in the LED driver if the starting corners differ.

Details: [LED driver](electronics/led-driver/) · [wiring](electronics/led-driver/docs/wiring.md).

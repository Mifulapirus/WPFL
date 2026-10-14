# Event rules — summary for builders of arena systems

**Official rules:** [wpfl.thehomelab.dev/rules](https://wpfl.thehomelab.dev/rules) — *WPFL @ ASMBLY Rules, Rev 4, Oct 13 2026*
(the PDF is served by the match tracker; referees replace it from **/ref → Event → Rules PDF**)
(contact: WeaponizedPlastic@asmbly.org). This page only extracts what matters for the arena, its lights and the
match tracker. **If anything here disagrees with the official document, the official document wins.**

## Event

| | |
|---|---|
| Event | Weaponized Plastic @ Asmbly (Asmbly Makerspace, Austin), run under the WPFL ruleset |
| Date | **Saturday, October 24, 2026** |
| Registration | Aug 26 – Oct 17, 2026 · ~20 robots · free · waitlist |
| Schedule | 10:00 load-in · 11:00–15:00 rolling safety checks · 16:00 brackets announced, doors open, **first fight** · 20:30 event ends · 21:00 doors close |

## Arena (rules §D)

- Approximately **4 ft × 4 ft × 2 ft tall**.
- Floor: plywood, painted black. Walls: **1/4" polycarbonate**.
- Edge lined with a sacrificial 1×4 pine edge, painted black.
- Robots may only be powered on inside the arena (§B.1).

## Robots (rules §C, abbreviated)

1 kg max, must fit a 30 × 30 × 30 cm box, 3D-printed/plastic weapons and bodies, no metal cutting/impact edges
(metal fasteners may not be used as an edge, armor or shield),
battery ≤ 50 V, physical weapon lock, fail-safe on signal loss, easily accessed power switch. Non-plastic armor (cardboard,
foam, balsa…) max 12 mm thick. One exact-replica backup robot allowed; spare parts unlimited. Pre-fight safety
inspection may be enforced.

## Match flow (rules §E) — what the lights and tracker must support

| Rule | Arena system support |
|---|---|
| Each match lasts **2 minutes** | Match timer in the tracker; optional `progress` effect on the ceiling |
| Bracket formats (double elim., Swiss, round robin) | Tracker |
| Forfeit at any time | Tracker; *Wins* button for the other robot |
| Incapacitated → judges start a **10-second countdown**; no movement → forfeit | **10 s COUNT** button / `countdown` with `seconds:10` |
| Pin/hold max **10 seconds** | Tracker can run a 10 s countdown on the pinning robot's side group |
| Both stuck → judge may pause and unstick | **PAUSE** (yellow) |
| Full match → judges decide | Tracker; *Wins* button |
| ≥ 10 min between a competitor's matches | Tracker scheduling (min rest warning) |
| ~3 min arena transition between matches | Idle scene (rainbow) between matches |

## Conduct (§F)

Public, family-friendly event alongside regular makerspace visitors — keep lights free of strobing patterns that
are too aggressive (the GO flash is 150 ms on/off for 2 s; adjust in Settings if needed).

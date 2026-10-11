# Arena structure

Mechanical design of the 4 ft × 4 ft × 2 ft arena.

Suggested contents (add as they become available):

```
structure/
├── cad/            Source CAD (Fusion/FreeCAD/OnShape export links)
├── drawings/       PDFs/DXFs with dimensions, polycarbonate panel cut files
├── bom.md          Materials: plywood floor, 1/4" polycarbonate, 1x4 pine edge, fasteners, paint
└── assembly.md     Build + teardown/transport steps, LED strip mounting points, cable routing
```

Requirements from the rules: plywood floor painted black, 1/4" polycarbonate walls, sacrificial 1×4 pine edge
painted black ([rules §D](../../docs/rules.md#arena-rules-d)).

Notes for the electronics: leave a protected path along the top perimeter for the 24 V power bus and at each
vertical corner for the LED strip + data return wire ([wiring](../electronics/led-driver/docs/wiring.md)).

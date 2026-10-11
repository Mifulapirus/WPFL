#!/usr/bin/env sh
# Build + run the host-side LED logic tests (no ESP32 needed).
# Needs any g++ with C++14. On Windows without one:
#   pio pkg install -g -t platformio/toolchain-gccmingw32
#   export PATH="$HOME/.platformio/packages/toolchain-gccmingw32/bin:$PATH"
# Run once `pio run` (or `pio pkg install`) has fetched ArduinoJson into .pio/.
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/wpfl_test_engine"
g++ -std=gnu++14 -Wall -O1 -Itest_host/shim -Isrc -I.pio/libdeps/arena-led/ArduinoJson/src \
    test_host/test_engine.cpp src/led/Color.cpp src/led/ArenaLayout.cpp src/led/LedEngine.cpp -o "$OUT"
"$OUT"

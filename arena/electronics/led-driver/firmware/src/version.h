#pragma once
// =============================================================================
// version.h — Firmware Semantic Version  (EDIT THIS FILE TO BUMP VERSIONS)
// =============================================================================
// Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
// Non-Commercial Source-Available License — see LICENSE for full terms.
//
//   MAJOR — breaking change (WebSocket protocol change, new board)
//   MINOR — new feature (backward-compatible)
//   PATCH — bug fix
//
// FW_BUILD_NUMBER is auto-incremented on every build by scripts/auto_version.py.
// =============================================================================

#define FW_VERSION_MAJOR  0
#define FW_VERSION_MINOR  2
#define FW_VERSION_PATCH  0

// WebSocket protocol version (docs/protocols/arena-led-websocket.md).
// Bump when a message changes in a way clients must know about.
#define PROTOCOL_VERSION  1

#!/usr/bin/env python3
"""
Reference WebSocket client for the WPFL Arena LED driver (protocol v1).

Use it to test the driver from a laptop, measure latency, and as a starting
point for the match-tracker integration on Capek.
Protocol: docs/protocols/arena-led-websocket.md

    pip install websockets

Examples
    python arena_led_client.py solid red
    python arena_led_client.py solid yellow --target ceiling
    python arena_led_client.py countdown --seconds 5
    python arena_led_client.py effect blink --target red --color yellow --duration 3000 --overlay
    python arena_led_client.py off
    python arena_led_client.py ping --count 100        # round-trip latency stats
    python arena_led_client.py watch                   # print state/status as they arrive
    python arena_led_client.py raw '{"type":"get_config"}'

Options --url (default ws://wpfl-arena.local/ws) and --token go before the command.

Copyright (c) 2026 Angel Hernandez (www.thehomelab.dev)
Non-Commercial Source-Available License — see LICENSE.
"""
import argparse
import asyncio
import json
import statistics
import sys
import time

try:
    import websockets
except ImportError:
    sys.exit("This tool needs the 'websockets' package:  pip install websockets")


class ArenaLed:
    """Minimal async client: send a command, await its ack/error by id."""

    def __init__(self, url, token=None):
        self.url, self.token = url, token
        self.ws = None
        self._next_id = 1
        self._pending = {}
        self.on_message = None   # callback(dict) for state/status/config pushes

    async def connect(self):
        # The driver answers WebSocket pings itself; keep the client's short.
        self.ws = await websockets.connect(self.url, ping_interval=5, max_size=2**16)
        self._reader = asyncio.create_task(self._read())
        if self.token:
            reply = await self.request({"type": "auth", "token": self.token})
            if not reply.get("ok"):
                raise RuntimeError("token rejected")

    async def _read(self):
        async for raw in self.ws:
            if isinstance(raw, bytes):
                continue   # 0x02 preview frames (only if subscribed)
            msg = json.loads(raw)
            fut = self._pending.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)
            elif self.on_message:
                self.on_message(msg)

    async def request(self, cmd, timeout=2.0):
        """Send a command with an id and wait for the matching reply."""
        cid = self._next_id
        self._next_id += 1
        fut = asyncio.get_running_loop().create_future()
        self._pending[cid] = fut
        await self.ws.send(json.dumps({**cmd, "id": cid}))
        return await asyncio.wait_for(fut, timeout)

    async def send(self, cmd):
        """Fire-and-forget (lowest latency: no reply unless there is an error)."""
        await self.ws.send(json.dumps(cmd))

    async def close(self):
        await self.ws.close()


async def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="ws://wpfl-arena.local/ws")
    p.add_argument("--token")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("solid"); s.add_argument("color"); s.add_argument("--target")
    s = sub.add_parser("off"); s.add_argument("--target")
    s = sub.add_parser("countdown")
    s.add_argument("--seconds", type=float); s.add_argument("--warn-at", type=float); s.add_argument("--target")
    s.add_argument("--style", choices=("pulse", "solid"))
    s = sub.add_parser("effect"); s.add_argument("fx")
    for a in ("--target", "--color", "--color2"):
        s.add_argument(a)
    s.add_argument("--period", type=int); s.add_argument("--duration", type=int)
    s.add_argument("--value", type=float); s.add_argument("--overlay", action="store_true")
    s = sub.add_parser("ping"); s.add_argument("--count", type=int, default=50)
    sub.add_parser("watch")
    s = sub.add_parser("raw"); s.add_argument("json")
    args = p.parse_args()

    led = ArenaLed(args.url, args.token)
    await led.connect()
    try:
        if args.cmd == "ping":
            rtts = []
            for i in range(args.count):
                t0 = time.perf_counter()
                await led.request({"type": "ping", "t": i})
                rtts.append((time.perf_counter() - t0) * 1000)
                await asyncio.sleep(0.02)
            rtts.sort()
            print(f"{len(rtts)} pings  min {rtts[0]:.1f}  median {statistics.median(rtts):.1f}  "
                  f"p95 {rtts[int(len(rtts) * 0.95) - 1]:.1f}  max {rtts[-1]:.1f} ms")
        elif args.cmd == "watch":
            led.on_message = lambda m: print(json.dumps(m))
            await asyncio.Event().wait()
        else:
            if args.cmd == "raw":
                cmd = json.loads(args.json)
            elif args.cmd == "solid":
                cmd = {"type": "solid", "color": args.color}
            elif args.cmd == "off":
                cmd = {"type": "off"}
            elif args.cmd == "countdown":
                cmd = {"type": "countdown"}
                if args.seconds is not None: cmd["seconds"] = args.seconds
                if args.warn_at is not None: cmd["warnAt"] = args.warn_at
                if args.style is not None: cmd["style"] = args.style
            else:
                cmd = {"type": "effect", "fx": args.fx, "overlay": args.overlay}
                for k in ("color", "color2", "period", "duration", "value"):
                    if getattr(args, k) is not None:
                        cmd[k] = getattr(args, k)
            if getattr(args, "target", None):
                cmd["target"] = args.target
            print(json.dumps(await led.request(cmd)))
    finally:
        await led.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

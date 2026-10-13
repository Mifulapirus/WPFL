# WPFL Match Tracker

Live brackets, fight control and arena lights for WPFL events. Runs on **Capek-Web** at
**<https://wpfl-asmbly.thehomelab.dev>**.

| Page | Who | What |
|---|---|---|
| **`/`** | Everyone | Live fight, up next, results, ranking, Swiss bracket, standings, **robot battlecards** (trading cards that flip over: robot on the front, team and fight log on the back), final podium, past events |
| **`/ref`** | Referees (password) | Fight console, bracket editor, robots, event settings, arena LED link |
| **`/obs`** | TV / stream crew | Broadcast graphics for OBS: **fight bar** (`/obs/fight`), **bracket** (`/obs/bracket`), **ranking** (`/obs/ranking`) — see below |

Status: **first pass** (v0.1) — Swiss format end to end, live fight control, LED link tested against the real driver.

## How it fits together

```
 Spectator phones ─┐  https / wss://…/ws (read-only)
 Big screen ───────┼───────────────────────────────┐
 Referee tablet ───┘  …/ws + login cookie           ▼
                                        ┌──────────────────────────┐
                                        │ Match tracker (Capek-Web)│  nginx (TLS) → node :3110 (PM2)
                                        │ data/events/*.json       │
                                        └────────────▲─────────────┘
                     wss://…/led  (Bearer LED_KEY)    │  the driver dials OUT,
                     ┌────────────────────────────────┘  so NAT at the venue is fine
                     │
        Arena LED driver (ESP32-C3, venue WiFi) ──► 72 px strip
```

- The **server is the source of truth**: fight phase, match clock (server time), counts, results. Browsers only render
  what it pushes and extrapolate the clock between pushes.
- The **LED driver connects out** to the server (`wss://…/led`) — it does not need to be on the same network as anything.
  The server sends it the same [protocol v1](../../docs/protocols/arena-led-websocket.md) commands the driver's own
  web page uses. If the link drops, the driver keeps the last scene and its physical START/STOP buttons still work;
  when it reconnects the server re-sends the current scene.

## Running an event (referee guide)

**Events.** Each event holds everything: name, date, start time, location, registration link, note, banner, match
settings, robots and bracket. The picker at the top of the referee page chooses the event the **Bracket** and **Robots**
tabs edit; the **Fight** tab always runs the live event.

| Status | Public page shows | Referee action |
|---|---|---|
| **Draft** | nothing of it | **Publish** when the info is ready (robots/bracket can come later) |
| **Published** | the **next upcoming event**: banner, date · time · location, note, **countdown**, registration link, and the robots' **battlecards** once it has robots; other published events under "Also coming up" | **Start event** on the day |
| **Live** (one at a time) | the live event: fight, queue, ranking, Swiss rounds, standings, battlecards, final podium | **End event** when done (or *Back to upcoming* if started by mistake) |
| **Past** | read-only page (`/?archive=<id>`), linked under past events | Restore (comes back as a draft) · Download · ✕ Delete |

1. **Event → + New event**, fill in the details (the start time drives the countdown), add a banner, **Publish**.
2. **Robots** (with that event picked) → **Import registrations** from the Google Form sheet, or **Copy robots from**
   another event. Imported: robot name, builder/team, robot description (public battlecard) and the rules checklist
   (referees only) — **email, phone and timestamps are never imported**. Each robot has a card **front** (robot photo +
   description) and a **back** (team or action photo + team description; the fight log is added automatically) — both
   texts max 220 characters. Viewers click a card to turn it over. **Card** off hides a robot's
   battlecard from viewers (it still fights and shows in brackets); **Card preview** shows the cards as viewers will
   see them (hidden ones marked; ✎ jumps to that robot's row).
3. **Bracket → Generate round 1** whenever you like (before or during the event). Edit pairings, swap corners (⇄) or
   reorder (▲▼) if needed.
4. On the day: **Event → Start event**. The public page switches from the countdown to the live event.
5. **Fight** tab, for each fight:
   - **Load next** → arena turns **yellow** (robots in, ready).
   - **START** → 3-2-1 countdown on the lights and screens, then the 2:00 clock runs.
   - **PAUSE** (yellow) / **STOP** (red, emergency) freeze the clock; **RESUME** counts down again.
   - **RED/BLUE FAULT** → that half blinks yellow for 3 s (logged on the fight).
   - **RED/BLUE 10 s** (incapacitated) or **PIN** (hold limit) → 10 s countdown on that robot's half.
   - 30 s left → ceiling blinks white. Time → arena red, **"Time — judges"**.
   - Declare the winner: **KO / JUDGES / FORFEIT** → winner's color + sparkle; result saved, standings update.
   - When the queue is empty the Fight tab offers **Generate round N** (or **Add round N** after the planned rounds).
6. When the last round is decided, viewers get the champion, podium and final ranking automatically.
7. **Event → End event** saves it to Past events; the public page goes back to the next upcoming event.

Mistakes: **Bracket → Edit → Reset** clears a result; **Result…** records one by hand; **Add a fight** creates extra or
exhibition fights (exhibitions don't count). The fight queue warns when a robot rested less than the minimum.
Standings: wins → Buchholz (sum of opponents' wins) → fewer losses → name.

## Broadcast graphics (OBS)

Three live pages for the stream, each an OBS **Browser** source at **1920 × 1080** (keep "Shutdown source when not
visible" off). They follow the same `/ws` feed as the public page, so they change the instant the referee does
something, and they reload themselves after a deploy. `/obs` is the hand-off page for the crew: links with copy
buttons, the options, and live previews.

| Page | Background | What it shows |
|---|---|---|
| `/obs/fight` | transparent | Lower-third scorebug: red and blue robot (photo or monogram, name, team, record, rank, faults), match clock, 3-2-1 countdown, KO / pin count over the robot's picture, winner. Between fights: the next fight ("Up next"); hidden when nothing is queued |
| `/obs/bracket` | dark | Swiss rounds as columns: every pairing, winner ✓ and method, LIVE / NEXT marks, placeholders for rounds not paired yet |
| `/obs/ranking` | dark | Standings: position (gold/silver/bronze), robot, team, W, L, KO, Buchholz; LIVE / NEXT / OUT / CHAMPION tags; rows slide to their new place after a result |

Options (query string): `bg=transparent|dark|green` (any page; green = chroma key) · fight: `pos=top`, `idle=hide`,
`demo=1` (loops a fake fight through every state, for building scenes before event day) · bracket: `rounds=N` (most
columns, default 5) · ranking: `top=N`, `cols=1|2`.

They show the **live** event, or the next published one before it starts. Robots whose battlecard is hidden show a
monogram instead of a photo (same public allow-list as the viewer). Fonts are the event site's Anton and Krona One
(SIL OFL), served from `public/fonts/`.

## Run locally

```sh
cd software/match-tracker
npm install
cp .env.example .env          # set REFEREE_PASSWORD and LED_KEY
npm run dev                   # http://127.0.0.1:3110  (referee: /ref)
npm test                      # pairing + fight state machine (node:test, no extra deps)
```

To test the lights on a LAN, set `HOST=0.0.0.0`, then on the driver: Settings → Match server → URL
`ws://<your-pc-ip>:3110/led`, key = `LED_KEY`, Connect on.

## Deploy on Capek-Web

Live at `/srv/apps/wpfl-match-tracker`, run by **PM2** as `angel` (like the other `/srv/apps` services) on
`127.0.0.1:3110`, behind nginx + Let's Encrypt.

**Updates** (from `software/match-tracker` on a machine with `ssh angel@capek-web`):

```sh
sh deploy/deploy.sh      # copies code, npm ci, pm2 reload, health check — data/ and .env on the server stay as they are
```

Server-side files:

| | |
|---|---|
| `/srv/apps/wpfl-match-tracker/.env` | `REFEREE_PASSWORD`, `LED_KEY`, `PORT=3110`, `TRUST_PROXY=1` (chmod 600) |
| `/srv/apps/wpfl-match-tracker/data/events/*.json` | One file per event (draft/published/live) (+ `.bak`); deleted ones in `events/trash/` |
| `/srv/apps/wpfl-match-tracker/data/archive/*.json` | Past events, one file each (`<date>-<time>-<name>.json`) |
| `/srv/apps/wpfl-match-tracker/data/media/` | Uploaded banners and robot photos (served at `/media/<random>.webp`) |
| `pm2 logs wpfl-match-tracker` | Logs (logins, LED link connects/drops) |
| `/etc/nginx/sites-available/wpfl-asmbly.thehomelab.dev.conf` | From `deploy/nginx-wpfl-asmbly.conf`, TLS added by certbot |

**First install** (already done — kept for a rebuild):

```sh
ssh angel@capek-web 'mkdir -p /srv/apps/wpfl-match-tracker'
#   create /srv/apps/wpfl-match-tracker/.env from .env.example (chmod 600)
sh deploy/deploy.sh                                   # starts it under PM2 and runs `pm2 save`
ssh -t angel@capek-web 'sudo cp /srv/apps/wpfl-match-tracker/deploy/nginx-wpfl-asmbly.conf /etc/nginx/sites-available/wpfl-asmbly.thehomelab.dev.conf &&
  sudo ln -sf /etc/nginx/sites-available/wpfl-asmbly.thehomelab.dev.conf /etc/nginx/sites-enabled/ &&
  sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d wpfl-asmbly.thehomelab.dev --redirect'
```

Generate a new LED key with `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` (then set
it on the driver too). Change the referee password: edit `.env`, `pm2 restart wpfl-match-tracker` (sessions stay valid;
delete `data/.session-secret` as well to sign everyone out). Docker alternative: `docker compose up -d`.

### Connect the arena lights

On the LED driver (its own page, e.g. `http://wpfl-arena.local`): **Settings → Match server**

| Field | Value |
|---|---|
| Connect | on |
| URL | `wss://wpfl-asmbly.thehomelab.dev/led` |
| Key | the server's `LED_KEY` |

The driver needs WiFi with internet (venue network or a phone hotspot — not its own hotspot mode). The referee
console shows **LEDs online · NN ms** in the top bar once it is connected; Event → Arena LED driver has details
and manual scene buttons.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `REFEREE_PASSWORD` | — (required, ≥ 6 chars) | Shared referee password |
| `LED_KEY` | empty = LED link off | Shared secret for the driver uplink (≥ 16 chars) |
| `HOST` / `PORT` | `127.0.0.1` / `3110` | Keep on localhost behind nginx |
| `TRUST_PROXY` | `0` | `1` behind nginx (real client IPs for login rate limiting) |
| `DATA_DIR` | `data` | Where `events/`, `archive/` and `media/` live |
| `SESSION_SECRET` | auto-generated in `DATA_DIR` | Change to sign every referee out |
| `SESSION_HOURS` | `14` | Referee login lifetime |

## Security

- Referee sessions: HMAC-signed, expiring cookie — `HttpOnly`, `SameSite=Strict`, `Secure` behind HTTPS. Logins are
  rate limited (10 failures / 10 min / IP). Referee WebSockets must come from the same origin.
- The public side is read-only: viewers get state, never commands. Robots are sent through an allow-list
  (`publicRobot`: name, builder, team, card texts and photos) — referee notes and the rules checklist stay private, and
  contact details from the registration form are never stored at all.
- The LED link requires `Authorization: Bearer <LED_KEY>` (constant-time compare) and the driver verifies the server's
  certificate against the Let's Encrypt roots.
- Strict CSP (no inline scripts or styles), no third-party assets. Pages can't be framed, except the `/obs/*`
  graphics by our own `/obs` page (`frame-ancestors 'self'`).

## Code map

```
server.js            HTTP routes, login, /ws (browsers) and /led (driver) sockets, command dispatch
src/tournament.js    robots, Swiss pairing, standings, fight edits (pure functions, unit tested)
src/live.js          the fight in the arena: phases, server clock, counts, LED scene per phase (unit tested)
src/led.js           driver uplink: auth, readiness, ping/RTT, state mirror
src/auth.js          password, session cookie, rate limit
src/importer.js      registration sheet/CSV import (header-based column mapping, private columns dropped)
src/media.js         banner uploads (magic-byte check, random names)
src/store.js         data/events/<id>.json per event (atomic, debounced) + data/archive/ (past events) + v1 migration
public/              index.html + js/viewer.js (public), ref.html + js/ref.js (referee), js/live.js (shared), css/
                     obs*.html + js/obs*.js + css/obs.css (broadcast graphics), fonts/
deploy/              deploy.sh, PM2 ecosystem, nginx site
```

### Browser protocol (`/ws`)

Server → client: `{"type":"state","serverNow":ms,"data":…}` on connect and after every change. Viewers get
`{mode:'live', event, robots, rounds, fights, standings, queue, live, upcoming, archives}` or
`{mode:'upcoming', next:{…same event shape}|null, upcoming, archives}`; referees get `{liveId, events, byId, archives}` + `led`.
on connect and after every change (referee sockets also every 5 s for LED link stats).
Client → server: `{"type":"time","t":ms}` (clock sync) and, referees only, `{"type":"cmd","op":"…","args":{…},"id":n}` →
`{"type":"reply","id":n,"ok":true}` or `{"type":"reply","id":n,"error":"…"}` (sent after the resulting state).
Ops: `event.update`, `robot.add|update|remove|photo`, `round.generate|delete`, `fight.add|update|swap|move|remove|result|reset`,
`live.load|start|pause|stop|fault|count|cancelCount|end|unload`, `led.scene`, `event.create|update|status|delete|image`, `archive.restore|delete`, `robots.import|copyFrom`.
Commands carry `ev` (the event id); `live.*` always act on the live event.
Read-only JSON: `GET /api/state`, `GET /api/archive` (past events), `GET /api/archive/<id>`; referees:
`GET /api/archive/<id>/export` (full file incl. notes).

---

Author: **Angel Hernandez** — [www.thehomelab.dev](https://www.thehomelab.dev). Non-Commercial Source-Available License — see
[LICENSE](../../LICENSE).

# Velocity OGFN

**Velocity OGFN** is an open-source Fortnite backend emulator with a desktop launcher. It emulates Epic's Fortnite web services locally so a Fortnite build you already own can boot to the lobby against your own server — auth, profiles/locker, hotfixes, friends, party (XMPP), and more.

> ⚠️ **Legal / usage note:** This project only implements a backend API. It does **not** include, distribute, or help you obtain Fortnite game files. Use it only with builds you legally own.

---

## Download for friends (easiest)

**Pre-built Windows installer (recommended):**

1. Go to **[GitHub Releases](https://github.com/forevershy/Velocity-OGFN/releases)** and download **Velocity-Setup-1.0.0.exe** (or the portable `.exe`).
2. Run the installer.
3. Open **Velocity** → complete onboarding (pick a username).
4. **Settings → Game connection** → click **Set up connection** (run as Administrator when prompted).
5. **Library** → add your Fortnite build folder → verify → select → **Run Game**.

Everyone needs their **own legally-owned Fortnite build**. To play together, use the **same season/build** and point joiners at the host IP in Settings.

See [DISTRIBUTE.md](./DISTRIBUTE.md) for hosting vs joining.

---

## Clone from GitHub (developers)

```bash
git clone https://github.com/forevershy/Velocity-OGFN.git
cd Velocity-OGFN
```

**Windows:** double-click `setup.bat` (or run `.\setup.ps1`).

**Manual setup:**

```bash
npm install
cd launcher && npm install && cd ..
copy config\config.example.json config\config.json   # if config.json is missing
npm start                                            # backend only
cd launcher && npm start                             # desktop launcher
```

Edit `config/config.json` to set your owner username, MOTD, and optional gameserver paths.

**Build an installer to share:**

```bash
cd launcher
npm run dist          # Velocity-Setup-1.0.0.exe
npm run dist:portable # single portable exe
```

Output is in `launcher/dist/`.

---

## Features

- **Web control panel** — a Nova/Reboot-style dashboard at `/panel` (server status, online players, cosmetic granting, V-Bucks, MOTD editor, hotfix editor, settings)
- **OAuth / Account** — login, token verify/kill, account & display-name lookup
- **MCP profiles** — `athena` (BR locker with default skins) and `common_core` (V-Bucks), with equip / favorite / mark-seen operations
- **Version & Timeline** — auto-detects season/build from the client `User-Agent`
- **Cloudstorage** — system **hotfixes** (`.ini`) + per-user `ClientSettings.Sav` persistence
- **Content pages** — MOTD / news / login message / dynamic backgrounds
- **Lightswitch** — reports Fortnite as `UP`
- **Friends / Storefront / Matchmaking** — stubbed so the client stops erroring
- **XMPP** — WebSocket XMPP server (RFC 7395 framing, SASL PLAIN, resource bind, presence, MUC party chat, direct party v2 messages)

## Requirements

- [Node.js](https://nodejs.org/) 18+ (tested on v22)
- A Fortnite build (**not provided**)

## Quick start (backend only)

```bash
npm start
```

You should see:

```
[BACKEND] OGFN HTTP backend listening on http://0.0.0.0:3551
[XMPP] XMPP (WebSocket) server listening on ws://0.0.0.0:80
```

## Desktop launcher

OGFN ships with a **Nova-style desktop launcher** (Electron) in `launcher/`. It has an onboarding flow (pick username → notification preference → accept terms), then a main screen with a sidebar, a live announcement banner (pulled from your MOTD), a settings panel, and a big **Launch** button.

```bash
cd launcher
npm install      # first time only (downloads Electron)
npm start
```

In the launcher's **Settings** (gear icon) you:

- set your **username**,
- **Browse** to your `FortniteClient-Win64-Shipping.exe`,
- optionally add extra launch args,
- toggle **auto-start the backend** (so launching also boots the OGFN server for you).

Pressing **Launch** starts the backend (if enabled), waits for it to come up, then spawns the game with the proper auth args pointed at your OGFN account.

> Velocity includes **hosts redirect + local HTTPS certs** via Settings → Game connection. Run that once as Administrator so the game reaches your local backend.

## Control panel

Open **http://127.0.0.1:3551/panel** in your browser (visiting `/` redirects here). From the panel you can:

- **Dashboard** — live players online, known accounts, uptime, ports, toggles
- **Players** — see XMPP-connected clients and every known account
- **Cosmetics** — grant any item template (e.g. `AthenaCharacter:CID_028_Athena_Commando_F`) or set V-Bucks for an account
- **Message of the Day** — edit the in-game news message
- **Hotfixes** — edit / create cloudstorage `.ini` files live
- **Settings** — toggle matchmaking

The panel talks to the backend over `/ogfn-panel/api/*`.

> Note: accounts appear after a client (or the game) logs in at least once. Profiles are in-memory, so grants/V-Bucks reset on restart until you add persistence.

For auto-restart on file changes during development:

```bash
npm run dev
```

## Configuration

Edit `config/config.json`:

| Key | Description |
| --- | --- |
| `server.port` | HTTP backend port (default `3551`) |
| `server.xmppPort` | XMPP WebSocket port (default `80`) |
| `bEnableMatchmaking` | If `false`, matchmaking is rejected (lobby-only). If `true`, points clients at `matchmaker.*` |
| `message.enabled` / `message.text` | The in-game MOTD / news message |

> On Windows, port `80` may require running the terminal as Administrator, or it may conflict with IIS/other software. Change `xmppPort` if needed.

## How a client connects

A Fortnite build talks to Epic over HTTPS. To point it here you need a launcher/proxy that:

1. **Redirects** requests for `*.ol.epicgames.com`, `account-public-service`, `fortnite-public-service`, etc. to `http://127.0.0.1:3551`.
2. **Bypasses SSL pinning** (most old-build launchers ship a DLL that does this).
3. **Points XMPP** at `ws://127.0.0.1:80`.

Then launch `FortniteClient-Win64-Shipping.exe` with the usual auth args (e.g. `-AUTH_LOGIN=` / `-AUTH_PASSWORD=` / `-epicapp=Fortnite -epicenv=Prod -epicportal`). Any username works — OGFN derives a stable account id from it.

## Project structure

```
OGFN/
├─ index.js               # Express app + route auto-loader + boots XMPP
├─ config/config.json     # Server config
├─ routes/                # HTTP route modules (auto-loaded)
│  ├─ auth.js             #   OAuth / account
│  ├─ mcp.js              #   MCP profile operations
│  ├─ core.js             #   version, timeline, lightswitch, features
│  ├─ content.js          #   content pages (MOTD / news)
│  ├─ cloudstorage.js     #   hotfixes + user settings
│  ├─ friends.js          #   friends service
│  ├─ storefront.js       #   item shop / affiliate
│  ├─ matchmaking.js      #   matchmaking tickets/sessions
│  ├─ party.js            #   party HTTP endpoints
│  └─ panel-api.js        #   admin panel API (/ogfn-panel/api/*)
├─ panel/                 # web control panel (static SPA)
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ launcher/              # Electron desktop launcher (Nova-style)
│  ├─ main.js             #   main process (window, IPC, launch logic)
│  ├─ preload.js          #   context bridge
│  └─ renderer/           #   onboarding + launcher UI (+ bg.svg)
├─ structs/profiles.js    # athena + common_core profile templates
├─ xmpp/
│  ├─ xmpp.js             # WebSocket XMPP server (presence/party/MUC)
│  └─ parser.js           # minimal stanza parser
├─ cloudstorage/
│  ├─ system/             # hotfix .ini files (e.g. DefaultGame.ini)
│  └─ user/               # per-account saved settings
└─ utils/                 # logger, helpers, error shapes
```

## Extending it

- **Hotfixes:** drop `.ini` files into `cloudstorage/system/` — they're served to the client at runtime.
- **New MCP ops:** add a `case` in `routes/mcp.js`.
- **Grant cosmetics:** edit `DEFAULT_COSMETICS` in `structs/profiles.js`.
- **Item shop:** populate `catalogEntries` in `routes/storefront.js`.
- **Persistence:** profiles are in-memory today; swap `structs/profiles.js`'s `store` for a JSON file or database to persist across restarts.

## Disclaimer

Not affiliated with, endorsed by, or connected to Epic Games. "Fortnite" is a trademark of Epic Games, Inc. Provided as-is under the MIT license.

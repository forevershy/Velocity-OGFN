# Velocity — share this installer with friends

## For you (host)

1. Install **Velocity-Setup-1.0.0.exe** (or run the portable `.exe`).
2. Open **Settings** → keep **Host server** selected.
3. Note your **LAN IP** shown in settings (e.g. `192.168.1.50:3551`).
4. Allow **ports 3551 and 80** through Windows Firewall (and port-forward both on your router if friends connect from outside your home network).
5. Add your Fortnite build in **Library** → verify → select → **Run Game**.

Share the same **Velocity installer** with friends. They still need their **own legally-owned Fortnite build** and a way to redirect game traffic to your server IP (SSL bypass / redirect — same as any OGFN setup).

## Friends & joining lobbies

1. **Everyone joins the same backend** — friends use **Settings → Join friend's server** with your IP.
2. **Add each other in-game** — Social tab → search username → Add Friend (requests auto-accept on this server).
3. **Invite to party** — from the friends list, invite them; they get a party popup via XMPP.
4. **Join lobby** — when a friend is in an open party, use **Join** on their profile (party is joinable in the lobby).

Both players must be **online on the same backend** and using the **same Fortnite build** for party/lobby join to work.

## For your friends (join)

1. Install Velocity from the file you sent them.
2. **Settings** → **Join friend's server** → enter your IP, e.g. `192.168.1.50:3551`.
3. Add the **same season/build** in Library (everyone must match).
4. **Run Game**.

## What the installer includes

- Velocity desktop launcher (onboarding, library, mods, cosmetics)
- Bundled backend server (starts automatically in host mode)
- No separate Node.js install required

## Build the installer yourself

```bash
cd launcher
npm install
npm run dist
```

Output: `launcher/dist/Velocity-Setup-1.0.0.exe`

Portable (no install): `npm run dist:portable` → `Velocity-Portable-1.0.0.exe`

## Important

- Velocity does **not** include Fortnite game files. Do not distribute copyrighted builds.
- Everyone needs the **same build version** to play together.
- True online play also requires redirecting Epic HTTPS traffic to the host IP — the launcher handles auth and server startup, not SSL pinning bypass.

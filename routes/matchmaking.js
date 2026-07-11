const express = require("express");
const app = express.Router();
const crypto = require("crypto");

const config = require("../config/config.json");
const { makeToken, nowIso } = require("../utils/functions");
const { setPresence } = require("../structs/playerPresence");
const { noteAccountQueued } = require("../matchmaker/matchmaker");
const {
  setAccountContext,
  getSession,
  createSession,
  makeId,
  setLastQueuedAccount,
} = require("../structs/matchSessions");

let lastMatchmakingAccount = null;

function gs() {
  return config.gameserver || { ip: "127.0.0.1", port: 7777, playlist: "Playlist_DefaultSolo", region: "NAE" };
}

function mm() {
  return config.matchmaker || { ip: "127.0.0.1", port: 80 };
}

function serviceUrl() {
  const { ip, port } = mm();
  if (!port || port === 80) return `ws://${ip}`;
  return `ws://${ip}:${port}`;
}

function toPlaylistName(bucketId) {
  const lower = String(bucketId || "").toLowerCase();
  if (lower.includes("playlist_defaultsolo")) return "Playlist_DefaultSolo";
  if (lower.includes("playlist_defaultduo")) return "Playlist_DefaultDuo";
  if (lower.includes("playlist_defaultsquad")) return "Playlist_DefaultSquad";
  const match = String(bucketId || "").match(/playlist_([a-z0-9_]+)/i);
  if (!match) return gs().playlist || "Playlist_DefaultSolo";
  const words = match[1].split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `Playlist_${words.join("")}`;
}

function regionFromBucket(bucketId) {
  const parts = String(bucketId || "").split(":");
  for (const part of parts) {
    if (/^[A-Z]{3,4}$/.test(part)) return part;
  }
  return gs().region || "NAE";
}

function buildUniqueIdFromBucket(bucketId) {
  const parts = String(bucketId || "").split(":");
  // Season 4 style: 4148992:0:NAE:playlist_defaultsolo
  if (parts.length >= 2 && /^\d+$/.test(parts[0])) return parts[0];
  // Newer style may embed the id deeper in the bucket string.
  return parts[2] || parts[0] || "0";
}

function sessionPayload(sessionId, req) {
  const stored = getSession(sessionId);
  const accountId = stored?.accountId || lastMatchmakingAccount;
  const ctx = accountId ? require("../structs/matchSessions").getAccountContext(accountId) : {};
  const buildUniqueId =
    stored?.buildUniqueId ||
    ctx.buildUniqueId ||
    req.cookies?.currentbuildUniqueId ||
    req.headers["x-build-unique-id"] ||
    "0";
  const playlist = stored?.playlist || ctx.playlist || gs().playlist || "Playlist_DefaultSolo";
  const region = stored?.region || ctx.region || gs().region || "NAE";
  const ownerId = (stored?.ownerId || makeId("owner")).toUpperCase();
  const sessionKey = (stored?.sessionKey || makeId("sessionkey")).toUpperCase();

  if (stored) {
    require("../structs/matchSessions").touchSession(sessionId, { ownerId, sessionKey });
  }

  return {
    id: sessionId,
    ownerId,
    ownerName: `[DS]velocity-${sessionId.slice(0, 8)}`,
    serverName: `[DS]velocity-${sessionId.slice(0, 8)}`,
    serverAddress: gs().ip,
    serverPort: Number(gs().port),
    maxPublicPlayers: 100,
    openPublicPlayers: 99,
    maxPrivatePlayers: 0,
    openPrivatePlayers: 0,
    attributes: {
      REGION_s: region,
      GAMEMODE_s: "FORTATHENA",
      ALLOWBROADCASTING_b: true,
      SUBREGION_s: region,
      DCID_s: `VELOCITY-${ownerId.slice(0, 16)}`,
      tenant_s: "Fortnite",
      MATCHMAKINGPOOL_s: "Any",
      STORMSHIELDDEFENSETYPE_i: 0,
      HOTFIXVERSION_i: 0,
      PLAYLISTNAME_s: playlist,
      SESSIONKEY_s: sessionKey,
      TENANT_s: "Fortnite",
      BEACONPORT_i: 15009,
    },
    publicPlayers: [],
    privatePlayers: [],
    totalPlayers: 1,
    allowJoinInProgress: false,
    shouldAdvertise: false,
    isDedicated: false,
    usesStats: false,
    allowInvites: false,
    usesPresence: false,
    allowJoinViaPresence: true,
    allowJoinViaPresenceFriendsOnly: false,
    buildUniqueId,
    lastUpdated: nowIso(),
    started: false,
  };
}

// ---- Matchmaking session ticket ----
app.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/:accountId", (req, res) => {
  if (!config.bEnableMatchmaking) {
    return res.status(400).json({
      errorCode: "errors.com.epicgames.common.matchmaking_disabled",
      errorMessage: "Matchmaking is disabled on this OGFN server (lobby-only mode).",
      numericErrorCode: 1000,
    });
  }

  const accountId = req.params.accountId;
  const bucketId = req.query.bucketId || "";
  const buildUniqueId = buildUniqueIdFromBucket(bucketId);
  const playlist = toPlaylistName(bucketId);
  const region = regionFromBucket(bucketId);

  lastMatchmakingAccount = accountId;
  setLastQueuedAccount(accountId);
  setPresence(accountId, "matchmaking");
  setAccountContext(accountId, { buildUniqueId, playlist, region, bucketId });
  noteAccountQueued(accountId, { buildUniqueId, playlist, region, bucketId });

  require("../structs/gameserver")
    .ensureGameserver({ playlist })
    .then((gs) => {
      if (!gs.ok && !gs.skipped) {
        require("../utils/logger").matchmaker(`Gameserver prewarm failed: ${gs.reason || "unknown"}`);
      }
    })
    .catch(() => {});

  res.cookie("currentbuildUniqueId", buildUniqueId);

  res.json({
    serviceUrl: serviceUrl(),
    ticketType: "mms-player",
    payload: "69=",
    signature: "420=",
  });
});

app.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => {
  res.json({
    accountId: req.params.accountId,
    sessionId: req.params.sessionId,
    key: crypto.randomBytes(32).toString("base64"),
  });
});

// ---- Session details ----
app.get("/fortnite/api/matchmaking/session/findPlayer/:accountId", (req, res) => {
  setPresence(req.params.accountId, "matchmaking");
  return res.status(200).end();
});

app.get("/fortnite/api/matchmaking/session/:sessionId", (req, res) => {
  if (!getSession(req.params.sessionId)) {
    const accountId = lastMatchmakingAccount;
    const ctx = accountId ? require("../structs/matchSessions").getAccountContext(accountId) : {};
    createSession({
      sessionId: req.params.sessionId,
      accountId,
      playlist: ctx.playlist || gs().playlist,
      region: ctx.region || gs().region,
      buildUniqueId: ctx.buildUniqueId || req.cookies?.currentbuildUniqueId || "0",
    });
  }
  res.json(sessionPayload(req.params.sessionId, req));
});

app.post("/fortnite/api/matchmaking/session/:sessionId/join", (req, res) => {
  const accountId = lastMatchmakingAccount;
  if (accountId) setPresence(accountId, "in_match", req.params.sessionId);
  return res.status(204).end();
});

app.post("/fortnite/api/matchmaking/session/matchMakingRequest", (req, res) => {
  res.json([]);
});

module.exports = app;

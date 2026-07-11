const RPC = require("discord-rpc");

// Create a Discord application at https://discord.com/developers/applications
// Upload a 512×512 image as Rich Presence asset key "velocity".
const DEFAULT_CLIENT_ID = "1430000000000000000";

let client = null;
let ready = false;
let loginPromise = null;
let launcherStart = Date.now();
let gameStart = null;

function resolveClientId(cfg) {
  const id = String(cfg?.discordClientId || process.env.VELOCITY_DISCORD_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
  return id && id !== "1430000000000000000" ? id : "";
}

function init(cfg) {
  const clientId = resolveClientId(cfg);
  if (cfg?.discordPresence === false || !clientId) return false;

  if (loginPromise) return true;

  RPC.register(clientId);
  client = new RPC.Client({ transport: "ipc" });

  loginPromise = new Promise((resolve) => {
    client.on("ready", () => {
      ready = true;
      resolve(true);
    });
    client.on("error", () => {
      ready = false;
    });
    // If Discord quits or restarts, reset so the refresh loop reconnects.
    client.on("disconnected", () => {
      ready = false;
      client = null;
      loginPromise = null;
    });
    client.login({ clientId }).catch(() => {
      ready = false;
      client = null;
      loginPromise = null;
      resolve(false);
    });
  });

  return true;
}

async function setActivity(activity) {
  if (!client || !loginPromise) return;
  await loginPromise;
  if (!ready) return;
  try {
    await client.setActivity(activity);
  } catch {
    /* Discord closed or disconnected */
  }
}

function seasonSubtitle(cfg) {
  const id = cfg?.selectedVersion;
  if (!id) return "Velocity Launcher";
  const version = (cfg.versions || []).find((v) => v.id === id);
  if (!version?.seasonId) return "Velocity Launcher";
  const seasons = {
    c1s1: "v1.11 · Chapter 1",
    c1s2: "v2.5 · Chapter 1",
    c1s3: "v3.5 · Chapter 1",
    c1s4: "v4.5 · Chapter 1",
    c1s5: "v5.41 · Chapter 1",
    c1s6: "v6.31 · Chapter 1",
    c1s7: "v7.40 · Chapter 1",
    c1s8: "v8.51 · Chapter 1",
    c1s9: "v9.41 · Chapter 1",
    c1sx: "v10.40 · Chapter 1",
    c2s1: "v11.31 · Chapter 2",
    c2s2: "v12.41 · Chapter 2",
    c2s3: "v13.40 · Chapter 2",
    c2s4: "v14.60 · Chapter 2",
  };
  return seasons[version.seasonId] || "Velocity Launcher";
}

const VIEW_LABELS = {
  home: "Home",
  library: "Library",
  changelog: "News",
  cosmetics: "Cosmetics",
};

async function updateLauncherPresence(cfg, view = "home") {
  if (cfg?.discordPresence === false) return;
  const viewLabel = VIEW_LABELS[view] || "Home";
  await setActivity({
    details: "In the Launcher",
    state: `${viewLabel} · ${seasonSubtitle(cfg)}`,
    startTimestamp: launcherStart,
    largeImageKey: "velocity",
    largeImageText: "Velocity",
    instance: false,
  });
}

async function updateInGamePresence(cfg, backendState) {
  if (cfg?.discordPresence === false) return;
  if (!gameStart) gameStart = Date.now();

  if (backendState === "in_match") {
    await setActivity({
      details: "In a Match",
      state: seasonSubtitle(cfg),
      startTimestamp: gameStart,
      largeImageKey: "velocity",
      largeImageText: "Velocity",
      smallImageKey: "fortnite",
      smallImageText: "OG Fortnite",
    });
    return;
  }

  if (backendState === "matchmaking") {
    await setActivity({
      details: "Matchmaking",
      state: seasonSubtitle(cfg),
      startTimestamp: gameStart,
      largeImageKey: "velocity",
      largeImageText: "Velocity",
    });
    return;
  }

  await setActivity({
    details: "In Lobby",
    state: seasonSubtitle(cfg),
    startTimestamp: gameStart,
    largeImageKey: "velocity",
    largeImageText: "Velocity",
    smallImageKey: "fortnite",
    smallImageText: "OG Fortnite",
  });
}

function clearGameSession() {
  gameStart = null;
}

async function destroy() {
  if (!client) return;
  try {
    await client.destroy();
  } catch {
    /* ignore */
  }
  client = null;
  ready = false;
  loginPromise = null;
}

module.exports = {
  init,
  destroy,
  updateLauncherPresence,
  updateInGamePresence,
  clearGameSession,
  resolveClientId,
};

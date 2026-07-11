const crypto = require("crypto");
const WebSocket = require("ws");

const config = require("../config/config.json");
const log = require("../utils/logger");
const { setPresence } = require("../structs/playerPresence");
const { createSession, getLastQueuedAccount } = require("../structs/matchSessions");
const { isPortOpen, waitForPort } = require("../structs/gameserver");

function gsPort() {
  return Number(config.gameserver?.port || 7777);
}

function gsHost() {
  return config.gameserver?.ip || "127.0.0.1";
}

function send(ws, name, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ name, payload }));
}

function onConnection(ws, req) {
  const protocol = (ws.protocol || req?.headers?.["sec-websocket-protocol"] || "").toLowerCase();
  if (protocol.includes("xmpp")) {
    ws.close();
    return;
  }

  const ticketId = crypto.createHash("md5").update(`ticket:${Date.now()}`).digest("hex");
  const matchId = crypto.createHash("md5").update(`match:${Date.now()}`).digest("hex");
  let session = null;
  let aborted = false;
  const timers = [];

  function schedule(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  ws.on("close", () => {
    aborted = true;
    timers.forEach(clearTimeout);
  });
  ws.on("error", () => {
    aborted = true;
    timers.forEach(clearTimeout);
  });

  schedule(() => send(ws, "StatusUpdate", { state: "Connecting" }), 200);
  schedule(
    () =>
      send(ws, "StatusUpdate", {
        state: "Waiting",
        totalPlayers: 1,
        connectedPlayers: 1,
      }),
    800
  );
  schedule(
    () =>
      send(ws, "StatusUpdate", {
        state: "Queued",
        ticketId,
        queuedPlayers: 0,
        estimatedWaitSec: 10,
        status: {},
      }),
    1500
  );

  schedule(async () => {
    if (aborted) return;

    const queuedId = getLastQueuedAccount();
    const ctx = queuedId ? require("../structs/matchSessions").getAccountContext(queuedId) : {};

    send(ws, "StatusUpdate", {
      state: "Queued",
      ticketId,
      queuedPlayers: 0,
      estimatedWaitSec: 30,
      status: { message: "Starting gameserver..." },
    });

    const gsResult = await require("../structs/gameserver").ensureGameserver({
      playlist: ctx.playlist,
    });

    if (aborted) return;

    const port = gsPort();
    const host = gsHost();
    let ready = await isPortOpen(port, host);

    if (!ready) {
      ready = await waitForPort(port, host, gsResult.ok ? 90000 : 15000);
    }

    if (!ready) {
      const reason =
        gsResult.reason ||
        "Gameserver did not start on port 7777. Set your build in Velocity Settings and ensure Reboot DLL is installed for Chapter 1.";
      log.matchmaker(`Matchmaking failed: ${reason}`);
      send(ws, "StatusUpdate", {
        state: "Failed",
        ticketId,
        queuedPlayers: 0,
        estimatedWaitSec: 0,
        status: { errorCode: "GAMESERVER_START_FAILED", errorMessage: reason },
      });
      await new Promise((r) => setTimeout(r, 800));
      try {
        ws.close(4000, reason.slice(0, 120));
      } catch {
        /* ignore */
      }
      return;
    }

    send(ws, "StatusUpdate", { state: "SessionAssignment", matchId });

    const accountId = getLastQueuedAccount();
    const accountCtx = accountId ? require("../structs/matchSessions").getAccountContext(accountId) : {};
    session = createSession({
      accountId,
      matchId,
      playlist: accountCtx.playlist,
      region: accountCtx.region,
      buildUniqueId: accountCtx.buildUniqueId,
    });
    if (accountId) setPresence(accountId, "in_match", session.id);

    await new Promise((r) => setTimeout(r, 600));
    if (aborted) return;

    send(ws, "Play", {
      matchId,
      sessionId: session.id,
      joinDelaySec: 1,
    });
    log.matchmaker(`Play -> session ${session.id.slice(0, 8)} @ ${host}:${port}`);
  }, 2200);
}

function attach(server, label) {
  const wss = new WebSocket.Server({ noServer: true });
  wss.on("connection", (ws, req) => onConnection(ws, req));
  return (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws._request = request;
      wss.emit("connection", ws, request);
    });
  };
}

function start(httpsServer, httpServer) {
  const handler = attach(null, "shared");
  const { registerMatchmaker } = require("../ws/router");
  registerMatchmaker(handler);
  log.matchmaker(`Matchmaker ready (ws://matchmaking-service-prod.ol.epicgames.com via :80 portproxy -> :8080)`);

  if (config.matchmaker?.dedicatedPort) {
    const dedicated = new WebSocket.Server({
      host: config.server?.host || "0.0.0.0",
      port: config.matchmaker.dedicatedPort,
    });
    dedicated.on("connection", (ws, req) => onConnection(ws, req));
    dedicated.on("listening", () => {
      log.matchmaker(`Dedicated matchmaker on ws://127.0.0.1:${config.matchmaker.dedicatedPort}`);
    });
  }
}

function noteAccountQueued(accountId, ctx) {
  if (accountId) require("../structs/matchSessions").setAccountContext(accountId, ctx);
}

module.exports = { start, noteAccountQueued };

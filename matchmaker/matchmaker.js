const crypto = require("crypto");
const WebSocket = require("ws");

const config = require("../config/config.json");
const log = require("../utils/logger");
const { setPresence } = require("../structs/playerPresence");
const { createSession, setAccountContext, getLastQueuedAccount } = require("../structs/matchSessions");

const MM_PORT = parseInt(process.env.VELOCITY_MM_PORT || String(config.matchmaker?.port || 80), 10);

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
  let accountId = null;
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
    1000
  );
  schedule(
    () =>
      send(ws, "StatusUpdate", {
        state: "Queued",
        ticketId,
        queuedPlayers: 0,
        estimatedWaitSec: 30,
        status: {},
      }),
    2000
  );

  // Start gameserver early, wait until port 7777 is up, THEN assign session + Play.
  schedule(async () => {
    if (aborted) return;
    const queuedId = getLastQueuedAccount();
    const ctx = queuedId ? require("../structs/matchSessions").getAccountContext(queuedId) : {};

    send(ws, "StatusUpdate", {
      state: "Queued",
      ticketId,
      queuedPlayers: 0,
      estimatedWaitSec: 45,
      status: { message: "Starting gameserver..." },
    });

    const gsResult = await require("../structs/gameserver").ensureGameserver({
      playlist: ctx.playlist,
    });

    if (aborted) return;

    if (!gsResult.ok && !gsResult.skipped) {
      log.matchmaker(`Gameserver ensure failed: ${gsResult.reason || "unknown"}`);
      send(ws, "StatusUpdate", {
        state: "Queued",
        ticketId,
        queuedPlayers: 0,
        estimatedWaitSec: 0,
        status: { error: gsResult.reason || "Gameserver failed to start" },
      });
      // Do not send Play — that causes Network Connection Lost on a dead :7777.
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 2000);
      return;
    }

    send(ws, "StatusUpdate", { state: "SessionAssignment", matchId });

    accountId = getLastQueuedAccount();
    const accountCtx = accountId ? require("../structs/matchSessions").getAccountContext(accountId) : {};
    session = createSession({
      accountId,
      matchId,
      playlist: accountCtx.playlist,
      region: accountCtx.region,
      buildUniqueId: accountCtx.buildUniqueId,
    });
    if (accountId) setPresence(accountId, "in_match", session.id);

    await new Promise((r) => setTimeout(r, 800));
    if (aborted) return;

    send(ws, "Play", {
      matchId,
      sessionId: session.id,
      joinDelaySec: 1,
    });
    log.matchmaker(`Assigned session ${session.id.slice(0, 8)} -> ${config.gameserver?.ip}:${config.gameserver?.port}`);
  }, 2500);
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
  log.matchmaker(`Matchmaker ready (ws://${config.matchmaker?.ip || "127.0.0.1"}:${MM_PORT} via portproxy)`);

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
  if (accountId) setAccountContext(accountId, ctx);
}

module.exports = { start, noteAccountQueued };

const WebSocket = require("ws");
const xmlbuilder = require("xmlbuilder");
const { v4: uuid } = require("uuid");

const config = require("../config/config.json");
const log = require("../utils/logger");
const { parseStanza } = require("./parser");
const { setOnline, clearPresence } = require("../structs/playerPresence");
const { ensureSessionDisplayName } = require("../utils/accounts");

const DOMAIN = "prod.ol.epicgames.com";
const MUC_DOMAIN = "muc.prod.ol.epicgames.com";
const WS_PORT = parseInt(process.env.VELOCITY_WS_PORT || "8080", 10);

// Connected clients: jid (bare, accountId@domain) -> client
const clients = new Map();
// MUC rooms: roomName -> Set of jids
const rooms = new Map();

function onClientConnect(ws) {
  const client = {
    ws,
    accountId: null,
    displayName: null,
    resource: null,
    jid: null,
    authenticated: false,
    presence: null,
    joinedMUCs: [],
  };

  ws.on("message", (data) => handleStanza(client, data.toString()));
  ws.on("close", () => cleanup(client));
  ws.on("error", () => cleanup(client));
}

function attachWss(server, label) {
  const wss = new WebSocket.Server({ noServer: true });
  wss.on("connection", onClientConnect);

  const { registerXmpp } = require("../ws/router");
  registerXmpp((request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  log.xmpp(`XMPP (${label}) ready`);
  return wss;
}

function start(httpsServer, httpServer) {
  const { attachUpgradeRouter } = require("../ws/router");

  if (httpsServer) {
    attachWss(httpsServer, "WSS on HTTPS");
    attachUpgradeRouter(httpsServer, "HTTPS");
  }

  if (httpServer) {
    attachWss(httpServer, `WS on :${WS_PORT}`);
    attachUpgradeRouter(httpServer, `HTTP :${WS_PORT}`);
    log.xmpp(`XMPP (WebSocket) sharing HTTP API port ${WS_PORT} (game uses :80 via portproxy)`);
    return;
  }

  const plain = new WebSocket.Server({ port: WS_PORT, host: config.server.host }, () => {
    log.xmpp(`XMPP (WebSocket) on ws://${config.server.host}:${WS_PORT} (game uses :80 via portproxy)`);
  });
  plain.on("connection", onClientConnect);
}

function send(client, xml) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(xml);
}

function sendRaw(client, xml) {
  send(client, xml);
}

function handleStanza(client, raw) {
  const stanza = parseStanza(raw);
  if (!stanza) return;

  switch (stanza.name) {
    case "open":
      return onOpen(client);
    case "auth":
      return onAuth(client, stanza);
    case "iq":
      return onIq(client, stanza);
    case "presence":
      return onPresence(client, stanza);
    case "message":
      return onMessage(client, stanza);
    case "close":
      return client.ws.close();
    default:
      break;
  }
}

function onOpen(client) {
  // Respond to the RFC 7395 framing open.
  send(
    client,
    xmlbuilder
      .create("open")
      .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-framing")
      .attribute("from", DOMAIN)
      .attribute("id", uuid())
      .attribute("version", "1.0")
      .attribute("xml:lang", "en")
      .toString()
  );

  if (!client.authenticated) {
    // Advertise SASL PLAIN.
    send(
      client,
      xmlbuilder
        .create("stream:features")
        .attribute("xmlns:stream", "http://etherx.jabber.org/streams")
        .element("mechanisms")
        .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-sasl")
        .element("mechanism", "PLAIN")
        .up()
        .up()
        .element("ver")
        .attribute("xmlns", "urn:xmpp:features:rosterver")
        .up()
        .toString()
    );
  } else {
    // Post-auth: advertise bind + session.
    send(
      client,
      xmlbuilder
        .create("stream:features")
        .attribute("xmlns:stream", "http://etherx.jabber.org/streams")
        .element("bind")
        .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-bind")
        .up()
        .element("session")
        .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-session")
        .up()
        .toString()
    );
  }
}

function onAuth(client, stanza) {
  // Payload is base64 of \0username\0password. Username = accountId.
  try {
    const decoded = Buffer.from(stanza.text || "", "base64").toString("utf8");
    const parts = decoded.split("\u0000");
    // parts[0] is authzid (often empty), parts[1] is user, parts[2] is pass.
    client.accountId = parts[1] || parts[0] || uuid().replace(/-/g, "");
  } catch {
    client.accountId = uuid().replace(/-/g, "");
  }

  client.authenticated = true;
  send(
    client,
    xmlbuilder.create("success").attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-sasl").toString()
  );
}

function onIq(client, stanza) {
  const id = stanza.attrs.id || uuid();

  if (stanza.raw.includes("<bind")) {
    // Resource bind.
    const resMatch = stanza.raw.match(/<resource[^>]*>([^<]*)<\/resource>/);
    client.resource = resMatch ? resMatch[1] : uuid();
    client.jid = `${client.accountId}@${DOMAIN}/${client.resource}`;
    clients.set(bareJid(client), client);
    client.displayName = ensureSessionDisplayName(client.accountId);
    setOnline(client.accountId, client.displayName);

    try {
      const { getUserParty } = require("../structs/partyService");
      const { pushPresenceToFriends } = require("../structs/socialNotify");
      const party = getUserParty(client.accountId);
      if (party) pushPresenceToFriends(client.accountId, party);
    } catch {
      /* party module optional at boot */
    }

    return send(
      client,
      xmlbuilder
        .create("iq")
        .attribute("to", client.jid)
        .attribute("id", id)
        .attribute("type", "result")
        .element("bind")
        .attribute("xmlns", "urn:ietf:params:xml:ns:xmpp-bind")
        .element("jid", client.jid)
        .up()
        .up()
        .toString()
    );
  }

  if (stanza.raw.includes("<session")) {
    log.xmpp(`Client bound: ${client.accountId?.slice(0, 8)} (${client.resource})`);
    return send(
      client,
      xmlbuilder.create("iq").attribute("to", client.jid).attribute("from", DOMAIN).attribute("id", id).attribute("type", "result").toString()
    );
  }

  // Roster / ping / everything else: acknowledge with empty result.
  return send(
    client,
    xmlbuilder
      .create("iq")
      .attribute("to", client.jid || `${client.accountId}@${DOMAIN}`)
      .attribute("from", DOMAIN)
      .attribute("id", id)
      .attribute("type", "result")
      .toString()
  );
}

function onPresence(client, stanza) {
  const to = stanza.attrs.to;
  const type = stanza.attrs.type;

  if (type === "unavailable" && to && to.includes(MUC_DOMAIN)) {
    return leaveRoom(client, to.split("@")[0]);
  }

  if (to && (isMucJoin(stanza) || to.includes(MUC_DOMAIN))) {
    const room = to.split("@")[0];
    return joinRoom(client, room);
  }

  client.presence = stanza.raw;
  broadcastPresence(client);
}

function onMessage(client, stanza) {
  const to = stanza.attrs.to;
  if (!to || !client.jid) return;

  const body = extractBody(stanza.raw);
  const type = stanza.attrs.type;

  if (type === "chat" && body) {
    if (body.length >= 300) return;
    const receiver = findByBareJid(to.split("/")[0]);
    if (!receiver || receiver.accountId === client.accountId) return;
    send(
      receiver,
      xmlbuilder
        .create("message")
        .attribute("to", receiver.jid)
        .attribute("from", client.jid)
        .attribute("xmlns", "jabber:client")
        .attribute("type", "chat")
        .element("body", body)
        .up()
        .toString()
    );
    return;
  }

  if ((type === "groupchat" || to.includes(MUC_DOMAIN)) && body) {
    if (body.length >= 300) return;
    const room = to.split("@")[0];
    const members = rooms.get(room);
    if (!members || !members.has(bareJid(client))) return;

    for (const jid of members) {
      const member = clients.get(jid);
      if (!member) continue;
      send(
        member,
        xmlbuilder
          .create("message")
          .attribute("to", member.jid)
          .attribute("from", getMUCmember(room, client.displayName, client.accountId, client.resource))
          .attribute("xmlns", "jabber:client")
          .attribute("type", "groupchat")
          .element("body", body)
          .up()
          .toString()
      );
    }
    return;
  }

  if (body && isJSON(body) && stanza.attrs.id) {
    const receiver = findByBareJid(to.split("/")[0]) || findByAccountId(to.split("@")[0].split("/")[0]);
    if (receiver) {
      send(
        receiver,
        xmlbuilder
          .create("message")
          .attribute("from", client.jid)
          .attribute("id", stanza.attrs.id)
          .attribute("to", receiver.jid)
          .attribute("xmlns", "jabber:client")
          .element("body", body)
          .up()
          .toString()
      );
    }
    return;
  }

  const targetId = to.split("@")[0].split("/")[0];
  const target = findByAccountId(targetId);
  if (target) send(target, stanza.raw);
}

// ---- MUC helpers ----
function joinRoom(client, room) {
  if (!client.jid || !client.accountId) return;
  if (client.joinedMUCs.includes(room)) return;

  if (!rooms.has(room)) rooms.set(room, new Set());
  const members = rooms.get(room);
  if (members.has(bareJid(client))) return;

  members.add(bareJid(client));
  client.joinedMUCs.push(room);

  const selfFrom = getMUCmember(room, client.displayName, client.accountId, client.resource);
  const selfNick = selfFrom.replace(`${room}@${MUC_DOMAIN}/`, "");

  send(
    client,
    xmlbuilder
      .create("presence")
      .attribute("to", client.jid)
      .attribute("from", selfFrom)
      .attribute("xmlns", "jabber:client")
      .element("x")
      .attribute("xmlns", "http://jabber.org/protocol/muc#user")
      .element("item")
      .attribute("nick", selfNick)
      .attribute("jid", client.jid)
      .attribute("role", "participant")
      .attribute("affiliation", "none")
      .up()
      .element("status")
      .attribute("code", "110")
      .up()
      .element("status")
      .attribute("code", "100")
      .up()
      .element("status")
      .attribute("code", "170")
      .up()
      .element("status")
      .attribute("code", "201")
      .up()
      .up()
      .toString()
  );

  for (const jid of members) {
    const member = clients.get(jid);
    if (!member) continue;

    const memberFrom = getMUCmember(room, member.displayName, member.accountId, member.resource);
    const memberNick = memberFrom.replace(`${room}@${MUC_DOMAIN}/`, "");

    send(
      client,
      xmlbuilder
        .create("presence")
        .attribute("from", memberFrom)
        .attribute("to", client.jid)
        .attribute("xmlns", "jabber:client")
        .element("x")
        .attribute("xmlns", "http://jabber.org/protocol/muc#user")
        .element("item")
        .attribute("nick", memberNick)
        .attribute("jid", member.jid)
        .attribute("role", "participant")
        .attribute("affiliation", "none")
        .up()
        .up()
        .toString()
    );

    if (member === client) continue;

    send(
      member,
      xmlbuilder
        .create("presence")
        .attribute("from", selfFrom)
        .attribute("to", member.jid)
        .attribute("xmlns", "jabber:client")
        .element("x")
        .attribute("xmlns", "http://jabber.org/protocol/muc#user")
        .element("item")
        .attribute("nick", selfNick)
        .attribute("jid", client.jid)
        .attribute("role", "participant")
        .attribute("affiliation", "none")
        .up()
        .up()
        .toString()
    );
  }

  log.xmpp(`${client.accountId?.slice(0, 8)} joined MUC room ${room}`);
}

function leaveRoom(client, room) {
  const members = rooms.get(room);
  if (!members || !members.has(bareJid(client))) return;

  members.delete(bareJid(client));
  if (members.size === 0) rooms.delete(room);

  const idx = client.joinedMUCs.indexOf(room);
  if (idx !== -1) client.joinedMUCs.splice(idx, 1);

  const selfFrom = getMUCmember(room, client.displayName, client.accountId, client.resource);
  const selfNick = selfFrom.replace(`${room}@${MUC_DOMAIN}/`, "");

  send(
    client,
    xmlbuilder
      .create("presence")
      .attribute("to", client.jid)
      .attribute("from", selfFrom)
      .attribute("xmlns", "jabber:client")
      .attribute("type", "unavailable")
      .element("x")
      .attribute("xmlns", "http://jabber.org/protocol/muc#user")
      .element("item")
      .attribute("nick", selfNick)
      .attribute("jid", client.jid)
      .attribute("role", "none")
      .up()
      .element("status")
      .attribute("code", "110")
      .up()
      .element("status")
      .attribute("code", "100")
      .up()
      .element("status")
      .attribute("code", "170")
      .up()
      .up()
      .toString()
  );
}

function getMUCmember(roomName, displayName, accountId, resource) {
  return `${roomName}@${MUC_DOMAIN}/${encodeURI(displayName || accountId)}:${accountId}:${resource}`;
}

function isMucJoin(stanza) {
  return (
    stanza.raw.includes("http://jabber.org/protocol/muc") ||
    stanza.raw.includes("<muc:x") ||
    (stanza.raw.includes("<x") && stanza.raw.includes("muc"))
  );
}

function extractBody(raw) {
  const match = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return match ? match[1] : "";
}

function isJSON(str) {
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function broadcastPresence(client) {
  const { listFriends } = require("../structs/friendGraph");
  const friends = listFriends(client.accountId);
  const targets =
    friends.length > 0
      ? friends.map((id) => findByAccountId(id)).filter(Boolean)
      : [...clients.values()].filter((other) => other !== client);

  for (const other of targets) {
    if (!client.presence) continue;
    const stanza = client.presence.replace(
      "<presence",
      `<presence from="${client.jid}" to="${other.jid}"`
    );
    send(other, stanza);
  }
}

function bareJid(client) {
  return `${client.accountId}@${DOMAIN}`;
}

function findByAccountId(accountId) {
  for (const [, c] of clients) if (c.accountId === accountId) return c;
  return null;
}

function findByBareJid(bare) {
  return clients.get(bare) || null;
}

function sendXmppMessageToId(body, accountId) {
  const target = findByAccountId(accountId);
  if (!target?.jid) return false;

  const payload = typeof body === "object" ? JSON.stringify(body) : String(body);
  send(
    target,
    xmlbuilder
      .create("message")
      .attribute("from", `xmpp-admin@${DOMAIN}`)
      .attribute("to", target.jid)
      .attribute("id", uuid())
      .attribute("xmlns", "jabber:client")
      .element("body", payload)
      .up()
      .toString()
  );
  return true;
}

function cleanup(client) {
  if (!client.accountId) return;
  clearPresence(client.accountId);

  for (const room of [...client.joinedMUCs]) leaveRoom(client, room);

  clients.delete(bareJid(client));
  for (const [room, members] of rooms) {
    if (members.delete(bareJid(client)) && members.size === 0) rooms.delete(room);
  }
  log.xmpp(`Client disconnected: ${client.accountId.slice(0, 8)}`);
}

function kickClient(accountId, reason) {
  const client = findByAccountId(accountId);
  if (!client) return false;
  try {
    client.ws.close(1000, reason || "Kicked");
  } catch {
    /* ignore */
  }
  cleanup(client);
  return true;
}

module.exports = { start, clients, sendXmppMessageToId, kickClient, findByAccountId, sendRaw };

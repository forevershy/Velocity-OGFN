const log = require("../utils/logger");

let xmppHandler = null;
let matchmakerHandler = null;
const attached = new WeakSet();

function registerXmpp(handler) {
  xmppHandler = handler;
}

function registerMatchmaker(handler) {
  matchmakerHandler = handler;
}

function attachUpgradeRouter(server, label) {
  if (!server || attached.has(server)) return;
  attached.add(server);

  server.on("upgrade", (request, socket, head) => {
    const protocol = (request.headers["sec-websocket-protocol"] || "").toLowerCase();
    const handler = protocol.includes("xmpp") ? xmppHandler : matchmakerHandler;

    if (handler) {
      handler(request, socket, head);
      return;
    }

    socket.destroy();
  });

  log.backend(`WebSocket router attached (${label})`);
}

module.exports = { attachUpgradeRouter, registerXmpp, registerMatchmaker };

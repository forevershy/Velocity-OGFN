const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

const config = require("./config/config.json");
const log = require("./utils/logger");
const { httpsOptions, resolveCertDir } = require("./structs/certs");

// Shared with the Velocity launcher (%AppData%\velocity-app\certs on Windows).
const CERT_DIR = resolveCertDir();

const app = express();

// Fortnite sends some bodies with wrong/absent content-types, so parse raw too.
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  bodyParser.raw({
    type: (req) => {
      const ct = req.headers["content-type"] || "";
      if (ct.includes("json")) return false;
      if (ct.includes("form-urlencoded")) return false;
      return true;
    },
    limit: "50mb",
  })
);

// Simple request logger
app.use((req, res, next) => {
  log.request(`${req.method} ${req.originalUrl}`);
  next();
});

// Auto-load every router in ./routes
const routesDir = path.join(__dirname, "routes");
for (const file of fs.readdirSync(routesDir)) {
  if (!file.endsWith(".js")) continue;
  app.use(require(path.join(routesDir, file)));
  log.backend(`Loaded route module: ${file}`);
}

// Serve the admin panel (Nova/Reboot-style dashboard) at /panel
app.use("/panel", express.static(path.join(__dirname, "panel")));
app.get("/", (req, res) => res.redirect("/panel"));

// Generic error / 404 handler that mimics Epic's error shape
app.use((req, res) => {
  res.status(404).json({
    errorCode: "errors.com.epicgames.common.not_found",
    errorMessage: "Sorry, the resource you were trying to find could not be found.",
    numericErrorCode: 1004,
    originatingService: "any",
    intent: "prod",
  });
});

const { host, port } = config.server;
const httpServer = app.listen(port, host, () => {
  log.backend(`OGFN HTTP backend listening on http://${host}:${port}`);
});
httpServer.on("error", (err) => {
  log.backend(`HTTP listener error on :${port} - ${err.code || err.message}`);
});

// HTTPS for the WinInet redirect method. We bind a high port (8443) here because
// Windows blocks non-admin processes from listening on 443. The launcher's one-
// time setup adds an elevated portproxy so 127.0.0.1:443 -> 8443.
const HTTPS_PORT = parseInt(process.env.VELOCITY_HTTPS_PORT || "8443", 10);
let httpsServer = null;
try {
  httpsServer = https.createServer(httpsOptions(CERT_DIR), app);
  httpsServer.on("error", (err) => {
    log.backend(`HTTPS listener error on :${HTTPS_PORT} - ${err.code || err.message}`);
  });
  httpsServer.listen(HTTPS_PORT, host, () => {
    log.backend(`OGFN HTTPS backend on https://${host}:${HTTPS_PORT} (game uses :443 via portproxy)`);
  });
} catch (err) {
  log.backend(`Could not start HTTPS backend: ${err.message}`);
}

// XMPP (party chat / presence) — WSS on HTTPS, plain WS on the :80 API port.
// Season 4 builds call Epic APIs over HTTP :80 (portproxy -> 8080), not only HTTPS :443.
const HTTP80_PORT = parseInt(process.env.VELOCITY_HTTP_PORT || "8080", 10);
let httpServer80 = null;
try {
  httpServer80 = http.createServer(app);
  httpServer80.on("error", (err) => {
    log.backend(`HTTP listener error on :${HTTP80_PORT} - ${err.code || err.message}`);
  });
  httpServer80.listen(HTTP80_PORT, host, () => {
    log.backend(`OGFN HTTP backend on http://${host}:${HTTP80_PORT} (Season 4 uses :80 via portproxy)`);
  });
} catch (err) {
  log.backend(`Could not start HTTP backend on :${HTTP80_PORT}: ${err.message}`);
}

require("./matchmaker/matchmaker").start(httpsServer, httpServer80);
require("./xmpp/xmpp").start(httpsServer, httpServer80);

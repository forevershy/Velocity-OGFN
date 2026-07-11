const express = require("express");
const app = express.Router();

const { getVersionInfo, nowIso } = require("../utils/functions");
const { isBanned, getBanInfo } = require("../structs/bans");

// ---- Version ----
app.get("/fortnite/api/version", (req, res) => {
  res.json({
    app: "fortnite",
    serverDate: nowIso(),
    overridePropertiesVersion: "unknown",
    cln: "0",
    build: "444",
    moduleName: "Fortnite-Core",
    buildDate: "2020-01-01T00:00:00.000Z",
    version: "++Fortnite+Release-Live-CL-0",
    branch: "Release-Live",
    modules: {},
  });
});

// Season 4+ builds call this on the ak.epicgames.com shard before cloud storage.
app.get("/fortnite/api/v2/versioncheck/:platform", (req, res) => {
  res.json({ type: "NO_UPDATE" });
});

// ---- Waiting room (skip queue) ----
app.get("/waitingroom/api/waitingroom", (req, res) => res.status(204).end());

// ---- Platform restrictions / access (required for login on Season 4+ builds) ----
// LawinServer returns plain text "true" via POST â€” JSON breaks older WinInet clients.
function allowPlatformPlay(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.send(true);
}

app.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/*", allowPlatformPlay);
app.get("/fortnite/api/game/v2/tryPlayOnPlatform/account/:accountId", allowPlatformPlay);
app.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/:accountId", allowPlatformPlay);

app.post("/fortnite/api/game/v2/grant_access/:accountId", (req, res) => res.status(204).end());
app.post("/fortnite/api/game/v2/grant_access/*", (req, res) => res.status(204).end());

function accountIdFromRequest(req) {
  const fromBody = req.body?.accountId || req.body?.[0]?.accountId;
  if (fromBody) return String(fromBody);
  const match = req.originalUrl.match(/account\/([a-f0-9]{32})/i);
  return match ? match[1] : null;
}

app.post("/fortnite/api/accesscontrol/status", (req, res) => {
  const accountId = accountIdFromRequest(req);
  const banned = accountId ? isBanned(accountId) : false;
  res.json({ play: !banned, isBanned: banned });
});

app.post("/fortnite/api/storeaccess/v1/request_access/:accountId", (req, res) => res.status(204).end());

// Social ban check
app.get("/socialban/api/public/v1/*", (req, res) => {
  const match = req.originalUrl.match(/([a-f0-9]{32})/i);
  const accountId = match ? match[1] : null;
  const ban = accountId ? getBanInfo(accountId) : null;
  if (ban) {
    return res.json({
      bans: [{ banReason: ban.reason, bannedAt: ban.bannedAt }],
      warnings: [],
    });
  }
  res.json({ bans: [], warnings: [] });
});

// ---- Enabled features ----
app.get("/fortnite/api/game/v2/enabled_features", (req, res) =>
  res.json(["Login", "Eula", "Storefront", "MOTD", "VerticalOverscroll"])
);

// ---- Receipts / entitlements ----
app.get("/fortnite/api/receipts/v1/account/:accountId/receipts", (req, res) => res.json([]));
app.get("/entitlement/api/account/:accountId/entitlements", (req, res) => res.json([]));

// ---- Data router / stats (no-op) ----
app.post("/datarouter/api/v1/public/data", (req, res) => res.status(204).end());
app.post("/fortnite/api/statsv2/query", (req, res) => res.json([]));

// ---- Timeline / calendar (controls active events) ----
app.get("/fortnite/api/calendar/v1/timeline", (req, res) => {
  const { season } = getVersionInfo(req);
  const activeUntil = "2099-12-31T23:59:59.999Z";

  res.json({
    channels: {
      "client-matchmaking": {
        states: [],
        cacheExpire: activeUntil,
      },
      "client-events": {
        states: [
          {
            validFrom: "0001-01-01T00:00:00.000Z",
            activeEvents: [
              { eventType: `EventFlag.Season${season}`, activeUntil, activeSince: "2020-01-01T00:00:00.000Z" },
              { eventType: `EventFlag.LobbySeason${season}`, activeUntil, activeSince: "2020-01-01T00:00:00.000Z" },
            ],
            state: {
              activeStorefronts:
                season >= 11
                  ? ["BRWeeklyStorefront", "BRDailyStorefront"]
                  : ["BRWeeklyStorefront", "BRDailyStorefront", "BRSeasonStorefront"],
              eventNamedWeights: {},
              seasonNumber: season,
              seasonTemplateId: `AthenaSeason:athenaseason${season}`,
              matchXpBonusPoints: 0,
              seasonBegin: "2020-01-01T00:00:00Z",
              seasonEnd: activeUntil,
              seasonDisplayedEnd: activeUntil,
              weeklyStoreEnd: activeUntil,
              stwEventStoreEnd: activeUntil,
              stwWeeklyStoreEnd: activeUntil,
              dailyStoreEnd: activeUntil,
            },
          },
        ],
        cacheExpire: activeUntil,
      },
    },
    eventsTimeOffsetHrs: 0,
    cacheIntervalMins: 10,
    currentTime: nowIso(),
  });
});

// ---- Lightswitch (service status) ----
app.get("/lightswitch/api/service/bulk/status", (req, res) => {
  res.json([
    {
      serviceInstanceId: "fortnite",
      status: "UP",
      message: "Fortnite is online",
      maintenanceUri: null,
      overrideCatalogIds: ["a7f138b2e51945ffbfdacc1af0541053"],
      allowedActions: ["PLAY", "DOWNLOAD"],
      banned: false,
      launcherInfoDTO: {
        appName: "Fortnite",
        catalogItemId: "4fe75bbc5a674f4f9b356b5c90567da5",
        namespace: "fn",
      },
    },
  ]);
});

app.get("/lightswitch/api/service/Fortnite/status", (req, res) => {
  res.json({
    serviceInstanceId: "fortnite",
    status: "UP",
    message: "Fortnite is online",
    allowedActions: [],
    banned: false,
    maintenanceUri: null,
  });
});

module.exports = app;

const express = require("express");
const app = express.Router();

const { accountIdFromName } = require("../utils/functions");

app.get("/persona/api/public/account/lookup", (req, res) => {
  const q = String(req.query.q || req.query.displayName || "").trim();
  const displayName = q.includes("@") ? q.split("@")[0] : q || "OGFNPlayer";
  const accountId = accountIdFromName(displayName);
  res.json([{ id: accountId, displayName, externalAuthInfo: [], lastOnline: new Date().toISOString() }]);
});

app.get("/persona/api/public/account/:accountId", (req, res) => {
  const accountId = req.params.accountId;
  res.json({
    id: accountId,
    displayName: `Player_${accountId.slice(0, 6)}`,
    externalAuthInfo: [],
    lastOnline: new Date().toISOString(),
  });
});

module.exports = app;

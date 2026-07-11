const express = require("express");
const app = express.Router();

const { accountIdFromName } = require("../utils/functions");
const { displayNameFor } = require("../utils/accounts");
const { sessions } = require("./auth");

app.get("/persona/api/public/account/lookup", (req, res) => {
  const q = String(req.query.q || req.query.displayName || "").trim();
  const displayName = q.includes("@") ? q.split("@")[0] : q || "OGFNPlayer";
  const accountId = accountIdFromName(displayName);
  res.json([
    {
      id: accountId,
      displayName: displayNameFor(accountId) || displayName,
      externalAuthInfo: [],
      lastOnline: new Date().toISOString(),
    },
  ]);
});

app.get("/persona/api/public/account/:accountId", (req, res) => {
  const accountId = req.params.accountId;
  const session = sessions.get(accountId);
  res.json({
    id: accountId,
    displayName: session?.displayName || displayNameFor(accountId),
    externalAuthInfo: [],
    lastOnline: new Date().toISOString(),
  });
});

module.exports = app;

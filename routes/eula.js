const express = require("express");
const app = express.Router();

const FN_EULA = {
  key: "fn",
  version: 1,
  revision: 1,
  title: "Fortnite End User License Agreement",
  body: "Velocity local server",
  locale: "en",
  status: "ACCEPTED",
};

// Season 4 uses the older "shared" EULA path (LawinServer returns {}).
app.get("/eulatracking/api/shared/agreements/fn*", (req, res) => res.json({}));
app.get("/eulatracking/api/shared/agreements/fn/account/:accountId", (req, res) => res.json({}));

app.get("/eulatracking/api/public/agreements/fn/account/:accountId", (req, res) => res.json([FN_EULA]));
app.get("/eulatracking/api/public/agreements/fn/recent", (req, res) => res.json([FN_EULA]));
app.get("/eulatracking/api/public/agreements/fn/account/:accountId/recent", (req, res) => res.json([FN_EULA]));
app.get("/eulatracking/api/public/agreements/fn/version/:version/account/:accountId", (req, res) =>
  res.json(FN_EULA)
);

app.post("/eulatracking/api/public/agreements/fn/account/:accountId/accept", (req, res) => res.status(204).end());
app.post("/eulatracking/api/public/agreements/fn/version/:version/account/:accountId/accept", (req, res) =>
  res.status(204).end()
);

module.exports = app;

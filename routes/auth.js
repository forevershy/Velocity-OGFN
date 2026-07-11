const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const app = express.Router();

const { accountIdFromName, makeToken, nowIso } = require("../utils/functions");
const { ensureAccountProfiles, applyOwnerPerks } = require("../structs/profiles");
const { stripOwnerTag } = require("../structs/owner");
const { ensureSessionDisplayName } = require("../utils/accounts");
const { isBanned, getBanInfo } = require("../structs/bans");

const sessions = new Map();
const exchangeCodes = new Map();
const tokenSessions = new Map();

const EXCHANGE_STORE =
  process.env.VELOCITY_USER_DATA
    ? path.join(process.env.VELOCITY_USER_DATA, "exchange-codes.json")
    : path.join(__dirname, "..", ".exchange-codes.json");

function loadExchangeCodes() {
  try {
    const raw = JSON.parse(fs.readFileSync(EXCHANGE_STORE, "utf8"));
    const now = Date.now();
    for (const [code, entry] of Object.entries(raw || {})) {
      if (entry?.expiresAt >= now) exchangeCodes.set(code, entry);
    }
  } catch {
    /* first run */
  }
}

function saveExchangeCodes() {
  try {
    const now = Date.now();
    const out = {};
    for (const [code, entry] of exchangeCodes.entries()) {
      if (entry?.expiresAt >= now) out[code] = entry;
    }
    fs.mkdirSync(path.dirname(EXCHANGE_STORE), { recursive: true });
    fs.writeFileSync(EXCHANGE_STORE, JSON.stringify(out));
  } catch {
    /* best effort */
  }
}

function storeExchangeCode(code, displayName) {
  const entry = { displayName, expiresAt: Date.now() + 5 * 60 * 1000 };
  exchangeCodes.set(code, entry);
  saveExchangeCodes();
}

loadExchangeCodes();

function parseBody(req) {
  let body = req.body || {};
  if (Buffer.isBuffer(body)) {
    try {
      body = Object.fromEntries(new URLSearchParams(body.toString("utf8")));
    } catch {
      body = {};
    }
  }
  return body;
}

function extractDisplayName(body) {
  let name =
    body.username ||
    body.email ||
    body.displayName ||
    body.account_id ||
    body.accountId ||
    "OGFNPlayer";
  if (typeof name === "string" && name.includes("@")) name = name.split("@")[0];
  return String(name).trim() || "OGFNPlayer";
}

function revokeAccountSessions(accountId) {
  for (const [token, session] of tokenSessions.entries()) {
    if (session.accountId === accountId) tokenSessions.delete(token);
  }
  for (const [code, entry] of exchangeCodes.entries()) {
    if (accountIdFromName(entry.displayName) === accountId) exchangeCodes.delete(code);
  }
}

function bannedResponse(res, ban) {
  return res.status(403).json({
    errorCode: "errors.com.epicgames.account.account_not_active",
    errorMessage: ban?.reason || "This account has been banned from this server.",
    messageVars: [],
    numericErrorCode: 18007,
    originatingService: "com.epicgames.account.public",
    intent: "prod",
  });
}

function issueTokens(rawDisplayName, res) {
  const username = stripOwnerTag(rawDisplayName);
  const accountId = accountIdFromName(username);
  const ban = getBanInfo(accountId);
  if (ban) return bannedResponse(res, ban);

  const displayName = ensureSessionDisplayName(accountId, username);
  require("../structs/friendGraph").registerAccount(accountId);
  ensureAccountProfiles(accountId);
  applyOwnerPerks(accountId);

  const accessToken = makeToken("eg1");
  const refreshToken = makeToken("eg1");
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  tokenSessions.set(accessToken, { accountId, displayName, username });
  tokenSessions.set(refreshToken, { accountId, displayName, username });

  res.json({
    access_token: accessToken,
    expires_in: 28800,
    expires_at: expires,
    token_type: "bearer",
    refresh_token: refreshToken,
    refresh_expires: 115200,
    refresh_expires_at: new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString(),
    account_id: accountId,
    client_id: "ec684b8c687f479fad8ae3a1b08ab8c5",
    internal_client: true,
    client_service: "fortnite",
    displayName,
    app: "fortnite",
    in_app_id: accountId,
    device_id: accountId,
    product_id: "prod-fn",
    application_id: "fngw",
    acr: "urn:epic:loa:aal1",
    auth_method: "exchange_code",
    merges: [],
    orgs: [],
  });
}

function handleTokenRequest(req, res) {
  const body = parseBody(req);
  const grantType = String(body.grant_type || "password").toLowerCase().replace(/_/g, "");

  if (grantType === "exchangecode") {
    const code = body.exchange_code || body.code || body.token || body.password;
    const entry = code && exchangeCodes.get(code);
    if (entry && entry.expiresAt >= Date.now()) {
      exchangeCodes.delete(code);
      saveExchangeCodes();
      return issueTokens(entry.displayName, res);
    }
    return res.status(400).json({
      errorCode: "errors.com.epicgames.account.oauth.exchange_code_not_found",
      errorMessage: "Sorry the exchange code you supplied is incorrect or has expired.",
      numericErrorCode: 18057,
      originatingService: "com.epicgames.account.public",
      intent: "prod",
    });
  }

  if (grantType === "refreshtoken") {
    const refresh = body.refresh_token || body.token;
    const session = refresh && tokenSessions.get(refresh);
    if (session) return issueTokens(session.displayName, res);
    return issueTokens(extractDisplayName(body), res);
  }

  if (grantType === "clientcredentials") {
    return issueTokens("OGFNPlayer", res);
  }

  if (grantType === "password") {
    return issueTokens(extractDisplayName(body), res);
  }

  // Unknown grant — still log them in for local play.
  return issueTokens(extractDisplayName(body), res);
}

// ---- OAuth token (all common paths) ----
app.post("/account/api/oauth/token", handleTokenRequest);
app.post("/auth/v1/oauth/token", handleTokenRequest);
app.post("/epic/oauth/v1/token", handleTokenRequest);
app.post("/epic/oauth/v2/token", handleTokenRequest);

// ---- Token verify ----
app.get("/account/api/oauth/verify", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^bearer\s+/i, "").trim();
  const session = tokenSessions.get(token);
  const accountId = session?.accountId || "ogfn";
  const displayName = ensureSessionDisplayName(accountId, session?.username || session?.displayName);

  res.json({
    token: token || makeToken("eg1"),
    session_id: makeToken("session"),
    token_type: "bearer",
    client_id: "ec684b8c687f479fad8ae3a1b08ab8c5",
    internal_client: true,
    client_service: "fortnite",
    account_id: accountId,
    expires_in: 28800,
    expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    auth_method: "exchange_code",
    display_name: displayName,
    displayName,
    app: "fortnite",
    in_app_id: accountId,
  });
});

app.delete("/account/api/oauth/sessions/kill/:token", (req, res) => res.status(204).end());
app.delete("/account/api/oauth/sessions/kill", (req, res) => res.status(204).end());

// ---- Exchange code (launcher auto-login) ----
app.get("/account/api/oauth/exchange", (req, res) => {
  let displayName = stripOwnerTag(req.query.username || "OGFNPlayer");
  if (typeof displayName === "string" && displayName.includes("@")) {
    displayName = displayName.split("@")[0];
  }

  const accountId = accountIdFromName(displayName);
  const ban = getBanInfo(accountId);
  if (ban) return bannedResponse(res, ban);

  const code = crypto.randomBytes(16).toString("hex");
  storeExchangeCode(code, displayName);

  res.json({
    expiresInSeconds: 300,
    code,
    creatingClientId: "ec684b8c687f479fad8ae3a1b08ab8c5",
  });
});

app.get("/account/api/public/account/:accountId", (req, res) => {
  const accountId = req.params.accountId;
  const session = sessions.get(accountId);
  const displayName = ensureSessionDisplayName(accountId, session?.username || session?.displayName);

  res.json({
    id: accountId,
    displayName,
    name: displayName,
    email: `${displayName}@ogfn.dev`,
    failedLoginAttempts: 0,
    lastLogin: nowIso(),
    numberOfDisplayNameChanges: 0,
    ageGroup: "UNKNOWN",
    headless: false,
    country: "US",
    lastName: "Server",
    preferredLanguage: "en",
    canUpdateDisplayName: false,
    tfaEnabled: false,
    emailVerified: true,
    minorVerified: false,
    minorExpected: false,
    minorStatus: "NOT_MINOR",
  });
});

app.get("/account/api/public/account", (req, res) => {
  let ids = req.query.accountId || [];
  if (!Array.isArray(ids)) ids = [ids];

  res.json(
    ids.map((accountId) => {
      const displayName = ensureSessionDisplayName(accountId);
      return { id: accountId, displayName, externalAuths: {} };
    })
  );
});

app.get("/account/api/public/account/:accountId/externalAuths", (req, res) => res.json([]));

app.get("/account/api/public/account/:accountId/restrictions", (req, res) => {
  const ban = getBanInfo(req.params.accountId);
  if (ban) {
    return res.json([
      {
        type: "PERMANENT_BAN",
        reason: ban.reason,
        source: "OGFN",
        active: true,
      },
    ]);
  }
  res.json([]);
});

app.get("/account/api/public/account/displayName/:displayName", (req, res) => {
  const username = stripOwnerTag(req.params.displayName);
  const accountId = accountIdFromName(username);
  const displayName = ensureSessionDisplayName(accountId, username);
  ensureAccountProfiles(accountId);
  applyOwnerPerks(accountId);
  res.json({ id: accountId, displayName, externalAuths: {} });
});

module.exports = app;
module.exports.sessions = sessions;
module.exports.tokenSessions = tokenSessions;
module.exports.revokeAccountSessions = revokeAccountSessions;
